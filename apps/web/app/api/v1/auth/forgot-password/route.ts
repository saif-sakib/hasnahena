import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail, generatePasswordResetEmail, getAppUrl } from '@/lib/email';
import { z } from 'zod';
import crypto from 'crypto';

const forgotPasswordSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(11).max(14).optional(),
  locale: z.enum(['en', 'bn']).optional().default('en'),
}).refine(data => data.email || data.phone, {
  message: 'Email or phone is required',
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Validate input
    const validation = forgotPasswordSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({
        ok: false,
        error: 'Invalid input',
        details: validation.error.flatten()
      }, { status: 400 });
    }

    const { email, phone, locale } = validation.data;

    // Find user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ],
      },
      select: {
        id: true,
        email: true,
        phone: true,
        nameEn: true,
        status: true,
      },
    });

    if (!user) {
      console.log('[ForgotPassword] User not found:', email || phone);
      return NextResponse.json({
        ok: false,
        error: locale === 'bn' ? 'ব্যবহারকারী পাওয়া যায়নি' : 'User not found',
      }, { status: 404 });
    }

    // Check if user has email (required for password reset via email)
    if (!user.email) {
      console.log('[ForgotPassword] User has no email:', user.phone);
      return NextResponse.json({
        ok: false,
        error: locale === 'bn'
          ? 'এই ব্যবহারকারীর জন্য কোনো ইমেইল সেট নেই'
          : 'No email is set for this user',
      }, { status: 400 });
    }

    // Delete any existing tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { email: user.email },
          { phone: user.phone },
        ],
      },
    });

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save token to database
    await prisma.passwordResetToken.create({
      data: {
        token,
        email: user.email,
        phone: user.phone,
        expiresAt,
      },
    });

    // Generate reset URL
    const appUrl = getAppUrl();
    const resetUrl = `${appUrl}/${locale}/reset-password?token=${token}`;

    // Send email
    const emailContent = generatePasswordResetEmail(resetUrl, locale);
    const emailResult = await sendEmail({
      to: user.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (!emailResult.success) {
      console.error('[ForgotPassword] Failed to send email:', emailResult.error);
      return NextResponse.json({
        ok: false,
        error: locale === 'bn' ? 'রিসেট ইমেইল পাঠানো যায়নি' : 'Failed to send reset email',
        details: emailResult.error,
      }, { status: 500 });
    } else {
      console.log('[ForgotPassword] Email sent to:', user.email);
    }

    return NextResponse.json({
      ok: true,
      message: locale === 'bn'
        ? 'পাসওয়ার্ড রিসেট লিঙ্ক আপনার ইমেইলে পাঠানো হয়েছে।'
        : 'Password reset link sent to your email.',
    });
  } catch (error) {
    console.error('[ForgotPassword] Error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Failed to process request'
    }, { status: 500 });
  }
}
