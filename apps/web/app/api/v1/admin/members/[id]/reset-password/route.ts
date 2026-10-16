import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { prisma } from '@/lib/prisma';
import { requireActiveAuth, revokeAllTokens } from '@/lib/auth-revocation';
import { generateTemporaryPassword } from '@/lib/api-utils';
import { createAuditLog } from '@/lib/audit';
import { RESET_SCOPE_FIRST_LOGIN, hashResetSecret } from '@/lib/reset-tokens';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';
import { liveIdentityFilter } from '@/lib/rejected-application';

/**
 * Staff-assisted password reset (ADR-036): most members have no email, so
 * forgot-password does not exist for them (and SMS was declined, ADR-003).
 *   - Revokes every session in the same transaction (ADR-031).
 *   - The temporary password is returned once and stored nowhere.
 *   - Admins only, members only (staff go through /api/v1/admin/workers).
 */

function forbidden() {
  return NextResponse.json({ ok: false, error: 'Admins only' }, { status: 403 });
}

function isAdmin(auth: { role?: string | null }): boolean {
  return ['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase());
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireActiveAuth(request);
    if (!isAdmin(auth)) return forbidden();

    const { id } = await context.params;
    const memberId = id?.trim();
    if (!memberId) {
      return NextResponse.json({ ok: false, error: 'Member id is required' }, { status: 400 });
    }

    const body = (await readJsonBody(request).catch(() => null)) as {
      confirmAccountNo?: unknown;
    } | null;

    // Never a rejected application (liveIdentityFilter).
    const member = await prisma.user.findFirst({
      where: { id: memberId, role: 'MEMBER', ...liveIdentityFilter },
      select: { id: true, accountNo: true, nameEn: true, status: true },
    });

    if (!member) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    }

    // Account number typed back, so the wrong member is not silently reset.
    const confirm = typeof body?.confirmAccountNo === 'string' ? body.confirmAccountNo.trim() : '';
    if (!member.accountNo || confirm !== member.accountNo) {
      return NextResponse.json(
        {
          ok: false,
          error: "Type the member's account number to confirm this reset",
        },
        { status: 400 },
      );
    }

    // Suspended members are refused; reactivation is a separate decision.
    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        {
          ok: false,
          error: `This member is ${member.status.toLowerCase()}. Reactivate the account before resetting the password.`,
        },
        { status: 409 },
      );
    }

    const temporaryPassword = generateTemporaryPassword();
    // Hash outside the transaction (bcrypt holds no row lock).
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: member.id }, data: { passwordHash } });

      // Kill every session on the old password.
      await revokeAllTokens(tx, member.id, 'password_change');

      // The first-login marker (hashed, WO-86). Stale markers for the email OR
      // phone are retired first, or the forced change would repeat.
      const full = await tx.user.findUniqueOrThrow({
        where: { id: member.id },
        select: { email: true, phone: true },
      });
      await tx.passwordResetToken.deleteMany({
        where: {
          scope: RESET_SCOPE_FIRST_LOGIN,
          usedAt: null,
          OR: [{ phone: full.phone }, ...(full.email ? [{ email: full.email }] : [])],
        },
      });
      await tx.passwordResetToken.create({
        data: {
          scope: RESET_SCOPE_FIRST_LOGIN,
          tokenHash: hashResetSecret(randomBytes(24).toString('hex')),
          email: full.email,
          phone: full.phone,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
    });

    // Names the account number only.
    await createAuditLog({
      action: 'PASSWORD_RESET',
      entityType: 'USER',
      entityId: member.id,
      userId: auth.id,
      details: `Staff-assisted password reset for ${member.accountNo}`,
      // Details distinguish this from the self-service PASSWORD_RESET.
    });

    return NextResponse.json({
      ok: true,
      data: {
        accountNo: member.accountNo,
        nameEn: member.nameEn,
        // Shown once — read it to the member.
        temporaryPassword,
      },
    });
  } catch (error) {
    const status = routeErrorStatus(error);
    if (status) {
      return NextResponse.json(
        { ok: false, error: routeErrorMessage(error, 'Failed to reset the password') },
        { status },
      );
    }
    console.error('[Admin/Members/ResetPassword] failed:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to reset the password' },
      { status: 500 },
    );
  }
}
