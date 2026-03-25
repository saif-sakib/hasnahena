import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { UserRole, UserStatus } from '@prisma/client';
import { generateStaffWelcomeEmail, sendEmail } from '@/lib/email';

const createStaffSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(11).max(14),
  role: z.enum(['WORKER', 'ADMIN']),
  assignedArea: z.string().optional(),
  locale: z.enum(['en', 'bn']).optional().default('en'),
});

function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const auth = requireAuth(req);
    if (!['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const parsed = createStaffSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { name, email, phone, role, assignedArea, locale } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.trim();

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { phone: normalizedPhone }],
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ ok: false, error: 'User with this email/phone already exists' }, { status: 409 });
    }

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const memberId = `STF-${Date.now().toString(36).toUpperCase()}`;

    const created = await prisma.user.create({
      data: {
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        role: role === 'ADMIN' ? UserRole.ADMIN : UserRole.WORKER,
        status: UserStatus.ACTIVE,
        memberId,
        nameEn: name.trim(),
        fatherName: name.trim(),
        motherName: name.trim(),
        assignedBranch: assignedArea?.trim() || null,
      },
      select: {
        id: true,
        nameEn: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        memberId: true,
        createdAt: true,
        assignedBranch: true,
      },
    });

    await prisma.passwordResetToken.create({
      data: {
        token: `first-login-${crypto.randomBytes(24).toString('hex')}`,
        email: created.email,
        phone: created.phone,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    const emailContent = generateStaffWelcomeEmail({
      locale,
      name: created.nameEn,
      role: created.role === UserRole.ADMIN ? 'ADMIN' : 'WORKER',
      email: created.email || '',
      phone: created.phone,
      temporaryPassword: tempPassword,
    });
    const sent = await sendEmail({
      to: created.email || '',
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (!sent.success) {
      return NextResponse.json(
        { ok: false, error: 'Staff created but failed to send email', details: sent.error },
        { status: 500 },
      );
    }

    await prisma.notification.create({
      data: {
        type: 'ACCOUNT_ACTIVATED',
        title: 'Staff Account Created',
        message: `Welcome ${created.nameEn}. Your account has been created. Please change your password after first login.`,
        targetUserId: created.id,
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        id: created.id,
        name: created.nameEn,
        email: created.email,
        phone: created.phone,
        role: created.role,
        status: created.status,
        assignedArea: created.assignedBranch || '',
        joinDate: created.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Admin/CreateStaff] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to create staff account' }, { status: 500 });
  }
}
