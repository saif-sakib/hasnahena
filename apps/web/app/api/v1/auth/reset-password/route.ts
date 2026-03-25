import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// GET - Validate token
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({
        ok: false,
        error: 'Token is required'
      }, { status: 400 });
    }

    // Find token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetToken) {
      return NextResponse.json({
        ok: false,
        error: 'Invalid or expired token'
      }, { status: 400 });
    }

    // Check if token is expired
    if (resetToken.expiresAt < new Date()) {
      // Delete expired token
      await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
      return NextResponse.json({
        ok: false,
        error: 'Token has expired'
      }, { status: 400 });
    }

    // Check if token was already used
    if (resetToken.usedAt) {
      return NextResponse.json({
        ok: false,
        error: 'Token has already been used'
      }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      valid: true,
      email: resetToken.email,
    });
  } catch (error) {
    console.error('[ResetPassword GET] Error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Failed to validate token'
    }, { status: 500 });
  }
}

// POST - Reset password
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Validate input
    const validation = resetPasswordSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({
        ok: false,
        error: 'Invalid input',
        details: validation.error.flatten()
      }, { status: 400 });
    }

    const { token, password } = validation.data;

    // Find token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetToken) {
      return NextResponse.json({
        ok: false,
        error: 'Invalid or expired token'
      }, { status: 400 });
    }

    // Check if token is expired
    if (resetToken.expiresAt < new Date()) {
      await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
      return NextResponse.json({
        ok: false,
        error: 'Token has expired'
      }, { status: 400 });
    }

    // Check if token was already used
    if (resetToken.usedAt) {
      return NextResponse.json({
        ok: false,
        error: 'Token has already been used'
      }, { status: 400 });
    }

    // Find user
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          ...(resetToken.email ? [{ email: resetToken.email }] : []),
          ...(resetToken.phone ? [{ phone: resetToken.phone }] : []),
        ],
      },
    });

    if (!user) {
      return NextResponse.json({
        ok: false,
        error: 'User not found'
      }, { status: 404 });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update password and mark token as used in a transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    console.log('[ResetPassword] Password reset for user:', user.email || user.phone);

    return NextResponse.json({
      ok: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('[ResetPassword POST] Error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Failed to reset password'
    }, { status: 500 });
  }
}
