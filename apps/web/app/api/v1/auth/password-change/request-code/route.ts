import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto, { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { generatePasswordChangeCodeEmail, sendEmail } from '@/lib/email';

const schema = z.object({
  currentPassword: z.string().min(1),
  locale: z.enum(['en', 'bn']).optional().default('en'),
});

const LOCKOUT_DURATION_MS = 30 * 1000; // 30 seconds
const MAX_ATTEMPTS = 5;

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

    const now = new Date();
    const lockToken = await prisma.passwordResetToken.findFirst({
      where: {
        usedAt: null,
        token: { startsWith: `pwd-change-lock:${auth.id}:` },
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });
    if (lockToken) {
      const remainingTime = Math.max(1, Math.ceil((lockToken.expiresAt.getTime() - now.getTime()) / 1000));
      return NextResponse.json({
        ok: false,
        error: `Too many failed attempts. Try again in ${remainingTime} seconds.`,
        lockedFor: remainingTime
      }, { status: 429 });
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

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      const failureWindowStart = new Date(Date.now() - LOCKOUT_DURATION_MS);
      const recentFailures = await prisma.passwordResetToken.count({
        where: {
          token: { startsWith: `pwd-change-fail:${auth.id}:` },
          createdAt: { gte: failureWindowStart },
        },
      });
      const failedCount = recentFailures + 1;
      await prisma.passwordResetToken.create({
        data: {
          token: `pwd-change-fail:${auth.id}:${randomBytes(6).toString('hex')}`,
          email: user.email,
          phone: user.phone,
          expiresAt: new Date(Date.now() + LOCKOUT_DURATION_MS),
        },
      });
      if (failedCount >= MAX_ATTEMPTS) {
        await prisma.passwordResetToken.create({
          data: {
            token: `pwd-change-lock:${auth.id}:${randomBytes(8).toString('hex')}`,
            email: user.email,
            phone: user.phone,
            expiresAt: new Date(Date.now() + LOCKOUT_DURATION_MS),
          },
        });
        return NextResponse.json({
          ok: false,
          error: 'Too many failed attempts. Account locked for 30 seconds.',
          lockedFor: 30,
        }, { status: 429 });
      }
      return NextResponse.json({
        ok: false,
        error: 'Current password is incorrect',
        attemptsRemaining: MAX_ATTEMPTS - failedCount,
      }, { status: 401 });
    }
    await prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { token: { startsWith: `pwd-change-fail:${auth.id}:` } },
          { token: { startsWith: `pwd-change-lock:${auth.id}:` } },
        ],
      },
    });

    if (!hasFirstLoginMarker) {
      // Current password is mandatory and already validated above for normal flow.
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
        token: `pwd-change-code:${code}:${randomBytes(8).toString('hex')}`,
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
