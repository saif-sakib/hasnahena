import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { generateTemporaryPassword } from '@/lib/api-utils';
import { UserRole, UserStatus } from '@prisma/client';
import { generateMemberApprovalEmail, sendEmail } from '@/lib/email';

const approveSchema = z.object({
  userId: z.string().min(1),
  notes: z.string().optional(),
  locale: z.enum(['en', 'bn']).optional().default('en'),
});

export async function POST(req: Request) {
  try {
    const auth = requireAuth(req);
    if (!['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const parsed = approveSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { userId, locale } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        nameEn: true,
        memberId: true,
        status: true,
        role: true,
      },
    });
    if (!user || user.role !== UserRole.MEMBER) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    }
    if (!user.email) {
      return NextResponse.json(
        { ok: false, error: 'Member email is required before approval' },
        { status: 400 },
      );
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: UserStatus.ACTIVE,
          approvedAt: new Date(),
          approvedBy: auth.id,
          passwordHash,
        },
      });

      const accountExists = await tx.account.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!accountExists) {
        await tx.account.create({
          data: {
            accountNumber: `HN-ACC-${user.memberId || Date.now().toString(36).toUpperCase()}`,
            savingsBalance: BigInt(0),
            loanBalance: BigInt(0),
            isLoanEligible: true,
            maxLoanAmount: BigInt(0),
            userId: user.id,
          },
        });
      }

      await tx.passwordResetToken.create({
        data: {
          token: `first-login-${randomBytes(24).toString('hex')}`,
          email: user.email,
          phone: user.phone,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });

      await tx.notification.create({
        data: {
          type: 'ACCOUNT_ACTIVATED',
          title: 'Account Approved',
          message: 'Your membership has been approved. Please log in and change your password.',
          targetUserId: user.id,
        },
      });
    });

    const emailContent = generateMemberApprovalEmail({
      locale,
      name: user.nameEn || 'Member',
      temporaryPassword,
    });

    const sent = await sendEmail({
      to: user.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (!sent.success) {
      return NextResponse.json(
        { ok: false, error: 'Approved but failed to send email', details: sent.error },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, message: 'Registration approved successfully' });
  } catch (error) {
    console.error('[Admin/ApproveRegistration] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to approve registration' }, { status: 500 });
  }
}
