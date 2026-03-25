import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { generatePasswordChangeCodeEmail, sendEmail } from '@/lib/email';

const schema = z.object({
  currentPassword: z.string().optional(),
  locale: z.enum(['en', 'bn']).optional().default('en'),
});

function createSixDigitCode(): string {
  const value = crypto.randomInt(100000, 1000000);
  return String(value);
}

export async function POST(req: Request) {
  try {
    const auth = requireAuth(req);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    const { currentPassword, locale } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, email: true, phone: true, passwordHash: true },
    });

    if (!user) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    if (!user.email) return NextResponse.json({ ok: false, error: 'Email is required for verification' }, { status: 400 });

    const hasFirstLoginMarker = !!(await prisma.passwordResetToken.findFirst({
      where: {
        usedAt: null,
        expiresAt: { gt: new Date() },
        token: { startsWith: 'first-login-' },
        OR: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      },
      select: { id: true },
    }));

    if (!hasFirstLoginMarker) {
      if (!currentPassword) {
        return NextResponse.json({ ok: false, error: 'Current password is required' }, { status: 400 });
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return NextResponse.json({ ok: false, error: 'Current password is incorrect' }, { status: 401 });
      }
    }

    const code = createSixDigitCode();
    await prisma.passwordResetToken.deleteMany({
      where: {
        token: { startsWith: 'pwd-change-code:' },
        OR: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      },
    });

    await prisma.passwordResetToken.create({
      data: {
        token: `pwd-change-code:${code}:${crypto.randomBytes(8).toString('hex')}`,
        email: user.email,
        phone: user.phone,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const mail = generatePasswordChangeCodeEmail(code, locale);
    const sent = await sendEmail({
      to: user.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    if (!sent.success) {
      return NextResponse.json({ ok: false, error: sent.error || 'Failed to send code' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: 'Verification code sent' });
  } catch (error) {
    console.error('[PasswordChange/RequestCode] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to request code' }, { status: 500 });
  }
}
