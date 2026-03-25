import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const isDev = process.env.NODE_ENV === 'development';

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(6, 'Current password is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

export async function PUT(req: Request) {
  try {
    const auth = requireAuth(req);
    const body = await req.json();

    // Validate input
    const validation = passwordChangeSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({
        ok: false,
        error: 'Invalid input',
        details: validation.error.flatten()
      }, { status: 400 });
    }

    const { currentPassword, newPassword } = validation.data;

    // Get user with password hash
    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      return NextResponse.json({ ok: false, error: 'Current password is incorrect' }, { status: 401 });
    }

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await prisma.user.update({
      where: { id: auth.id },
      data: { passwordHash: newPasswordHash },
    });

    return NextResponse.json({
      ok: true,
      message: 'Password changed successfully',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    console.error('[Me/Password PUT] Error:', msg);
    if (msg.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to change password', ...(isDev && { details: msg }) }, { status: 500 });
  }
}
