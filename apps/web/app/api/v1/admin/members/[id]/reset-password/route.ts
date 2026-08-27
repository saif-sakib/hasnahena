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
 * A member has forgotten their password and cannot receive an email.
 *
 * Why this exists at all
 * ---------------------
 * `forgot-password` sends a link, and **most members of this cooperative have no
 * email address**. Of the register the foundation brought in, a handful had one
 * and two of those were phone numbers typed into the wrong box. For those people
 * the self-service path is not merely inconvenient, it does not exist — and
 * before this route there was no other one. A member who forgot their password
 * was locked out permanently, with the only remedy being somebody with SQL
 * access.
 *
 * SMS was the obvious alternative and was not chosen ([ADR-003](../../../../../../../docs/decisions.md)):
 * it needs a paid gateway, an account, credentials and a spend limit, for a
 * platform whose members walk into the office anyway. What they already do for a
 * withdrawal — turn up, be recognised, be served — is the identity check this
 * borrows.
 *
 * So: an admin resets it at the desk, reads the temporary password to the
 * member, and the application forces a change at first login.
 *
 * What this route is careful about
 * --------------------------------
 * **It revokes every session in the same transaction as the password.** That is
 * [ADR-031](../../../../../../../docs/decisions.md), and the reason is the case
 * this route is *for*: a member asking for a reset may be asking because
 * somebody else has their phone. Changing the password while leaving that
 * session signed in for up to a day answers the wrong half of the problem —
 * SEC-17, in a new place.
 *
 * **The temporary password is returned once and stored nowhere.** It is in the
 * response, the admin reads it out, and the only durable record is the bcrypt
 * hash. The audit row names the account number and never the password, the same
 * way the erasure route names what it erased without preserving it
 * ([ADR-033](../../../../../../../docs/decisions.md)).
 *
 * **Admins only.** A field worker takes deposits and processes withdrawals, and
 * both are reversible by an admin appending a correction. Handing somebody a
 * working password for another person's account is not a money action and is not
 * reversible, so it sits with the same role that can erase a member.
 *
 * **Members only.** Resetting a colleague's password is a different question
 * with a different answer — `PUT /api/v1/admin/workers` already owns staff
 * accounts, and an admin who could reset another admin's password here could
 * take over the account that can erase members.
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

    // `liveIdentityFilter` excludes rejected applications, which hold a password
    // hash nothing can match by design. Issuing one a working password would
    // turn a refused applicant into an account.
    const member = await prisma.user.findFirst({
      where: { id: memberId, role: 'MEMBER', ...liveIdentityFilter },
      select: { id: true, accountNo: true, nameEn: true, status: true },
    });

    if (!member) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    }

    // Typed back by the admin, as the erasure route does. This is reached from a
    // member's own page, so the account number is on the screen in front of
    // them — the point is not secrecy, it is that handing out a password for the
    // wrong member is silent: the right person is still locked out and the wrong
    // one has credentials nobody told them about.
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

    // A suspended member is refused rather than reset. Whoever suspended them
    // did so deliberately, and handing them a fresh password is not the way to
    // reverse it — reactivating the account is, and that is a separate decision
    // with its own audit row.
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
    // Hashed outside the transaction: bcrypt at this cost takes a couple of
    // hundred milliseconds, and holding a row lock through it for no reason is
    // how a pool runs out under a queue of admins.
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: member.id }, data: { passwordHash } });

      // Any live session on the old password dies with it. See the note above:
      // the member may be asking precisely because somebody else has their phone.
      await revokeAllTokens(tx, member.id, 'password_change');

      // The marker whose *existence* is `mustChangePassword`. The secret behind
      // it is never presented — it is hashed on the way in like every other row
      // of this table (WO-86), because a row keyed on something guessable is a
      // row somebody can plant.
      //
      // `FindByIdentifier` reads this by email OR phone, so any stale unused
      // marker for either is retired first: two rows would both satisfy the
      // EXISTS, and the second would keep forcing a password change after the
      // member had already made one.
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

    // Names the account number and nothing else. Never the password, and never
    // the member's contact details — an audit row is permanent and this one only
    // has to answer "who reset whose password, and when".
    await createAuditLog({
      action: 'PASSWORD_RESET',
      entityType: 'USER',
      entityId: member.id,
      userId: auth.id,
      details: `Staff-assisted password reset for ${member.accountNo}`,
      // `PASSWORD_RESET` is shared with the self-service path, so the details
      // line is what distinguishes the two in the audit viewer — one is a member
      // following an emailed link, the other is an admin at the desk.
    });

    return NextResponse.json({
      ok: true,
      data: {
        accountNo: member.accountNo,
        nameEn: member.nameEn,
        // Shown once. Not stored, not emailed, not recoverable — read it to the
        // member before leaving this screen.
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
