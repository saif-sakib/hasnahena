import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { generatePasswordChangedEmail, sendEmail } from '@/lib/email';

const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(6),
  locale: z.enum(['en', 'bn']).optional().default('en'),
});

export async function POST(req: Request) {
  try {
    const auth = requireAuth(req);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    const { code, newPassword, locale } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, email: true, phone: true },
    });
    if (!user) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });

    const tokenRow = await prisma.passwordResetToken.findFirst({
      where: {
        usedAt: null,
        expiresAt: { gt: new Date() },
        token: { startsWith: `pwd-change-code:${code}:` },
        OR: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!tokenRow) {
      return NextResponse.json({ ok: false, error: 'Invalid or expired verification code' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      await tx.passwordResetToken.update({
        where: { id: tokenRow.id },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.updateMany({
        where: {
          usedAt: null,
          token: { startsWith: 'first-login-' },
          OR: [
            ...(user.email ? [{ email: user.email }] : []),
            ...(user.phone ? [{ phone: user.phone }] : []),
          ],
        },
        data: { usedAt: new Date() },
      });
    });

    if (user.email) {
      const mail = generatePasswordChangedEmail(locale);
      await sendEmail({
        to: user.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    }

    return NextResponse.json({ ok: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('[PasswordChange/Confirm] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to change password' }, { status: 500 });
  }
}
