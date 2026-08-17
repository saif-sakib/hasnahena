import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { generateTemporaryPassword } from '@/lib/api-utils';
import { UserRole, UserStatus } from '@prisma/client';
import { createAuditLog } from '@/lib/audit';

const createStaffSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().regex(/^01\d{9}$/, 'Invalid Bangladeshi phone number'),
  role: z.enum(['WORKER', 'ADMIN']),
  assignedArea: z.string().optional(),
  locale: z.enum(['en', 'bn']).optional().default('en'),
});

const updateStaffSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  phone: z.string().regex(/^01\d{9}$/, 'Invalid Bangladeshi phone number'),
  role: z.enum(['WORKER', 'ADMIN']),
  assignedArea: z.string().optional(),
});

const updateStaffStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

const GO_API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:8081';

export async function POST(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (!['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const authorizationHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';

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
        token: `first-login-${randomBytes(24).toString('hex')}`,
        email: created.email,
        phone: created.phone,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    const emailResponse = await fetch(`${GO_API_BASE_URL}/v1/dashboard/admin/workers/welcome-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
      },
      body: JSON.stringify({
        email: created.email || '',
        name: created.nameEn,
        role: created.role === UserRole.ADMIN ? 'ADMIN' : 'WORKER',
        phone: created.phone,
        temporaryPassword: tempPassword,
        locale,
      }),
      cache: 'no-store',
    });

    const emailResult = await emailResponse.json().catch(() => ({} as any));
    if (!emailResponse.ok || !emailResult?.success) {
      const backendMessage = emailResult?.error?.message || emailResult?.message;
      return NextResponse.json(
        { ok: false, error: 'Staff created but failed to send email', details: backendMessage || 'Failed to send staff welcome email from Go backend' },
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

    // Audit log for worker creation
    await createAuditLog({
      action: 'WORKER_CREATED',
      entityType: 'USER',
      entityId: created.id,
      userId: auth.id,
      newValue: { name: created.nameEn, role: created.role, email: created.email },
      details: `Created ${role} account for ${created.nameEn}`,
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

export async function PUT(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (!['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const parsed = updateStaffSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id, name, phone, role, assignedArea } = parsed.data;
    const normalizedPhone = phone.trim();

    // Get old values for audit
    const oldUser = await prisma.user.findUnique({
      where: { id },
      select: { nameEn: true, phone: true, role: true, assignedBranch: true },
    });

    const existingPhone = await prisma.user.findFirst({
      where: {
        phone: normalizedPhone,
        id: { not: id },
      },
      select: { id: true },
    });
    if (existingPhone) {
      return NextResponse.json({ ok: false, error: 'Phone already in use' }, { status: 409 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        nameEn: name.trim(),
        phone: normalizedPhone,
        role: role === 'ADMIN' ? UserRole.ADMIN : UserRole.WORKER,
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

    // Audit log for worker update
    await createAuditLog({
      action: 'WORKER_UPDATED',
      entityType: 'USER',
      entityId: updated.id,
      userId: auth.id,
      oldValue: oldUser || undefined,
      newValue: { name: updated.nameEn, role: updated.role, phone: updated.phone },
      details: `Updated ${role} account for ${updated.nameEn}`,
    });

    return NextResponse.json({
      ok: true,
      data: {
        id: updated.id,
        name: updated.nameEn,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        status: updated.status,
        assignedArea: updated.assignedBranch || '',
        joinDate: updated.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Admin/UpdateStaff] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to update staff account' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (!['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const parsed = updateStaffStatusSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id, status } = parsed.data;

    if (id === auth.id && status === 'INACTIVE') {
      return NextResponse.json({ ok: false, error: 'You cannot deactivate your own account' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({
      where: { id },
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

    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Worker not found' }, { status: 404 });
    }

    if (existing.role !== UserRole.WORKER && existing.role !== UserRole.ADMIN) {
      return NextResponse.json({ ok: false, error: 'Only worker/admin accounts can be updated here' }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        status: status === 'ACTIVE' ? UserStatus.ACTIVE : UserStatus.INACTIVE,
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

    await createAuditLog({
      action: 'USER_STATUS_CHANGED',
      entityType: 'USER',
      entityId: updated.id,
      userId: auth.id,
      oldValue: { status: existing.status },
      newValue: { status: updated.status },
      details: `Updated staff status for ${updated.nameEn} to ${updated.status}`,
    });

    return NextResponse.json({
      ok: true,
      data: {
        id: updated.id,
        name: updated.nameEn,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        status: updated.status,
        assignedArea: updated.assignedBranch || '',
        joinDate: updated.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Admin/UpdateStaffStatus] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to update staff status' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (!['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const id = (url.searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Missing staff id' }, { status: 400 });
    }

    if (id === auth.id) {
      return NextResponse.json({ ok: false, error: 'You cannot delete your own account' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        nameEn: true,
        email: true,
        phone: true,
        role: true,
        status: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Worker not found' }, { status: 404 });
    }

    if (existing.role !== UserRole.WORKER && existing.role !== UserRole.ADMIN) {
      return NextResponse.json({ ok: false, error: 'Only worker/admin accounts can be deleted here' }, { status: 400 });
    }

    const [processedTransactions, approvedLoans, approvedUsers, processedSupportThreads] = await prisma.$transaction([
      prisma.transaction.count({ where: { processedBy: id } }),
      prisma.loan.count({ where: { approvedBy: id } }),
      prisma.user.count({ where: { approvedBy: id } }),
      prisma.supportThread.count({ where: { processedByUserId: id } }),
    ]);

    const referenceCount = processedTransactions + approvedLoans + approvedUsers + processedSupportThreads;

    // If historical references exist, archive (INACTIVE) instead of hard delete.
    if (referenceCount > 0) {
      const archived = await prisma.user.update({
        where: { id },
        data: { status: UserStatus.INACTIVE },
        select: {
          id: true,
          nameEn: true,
          email: true,
          phone: true,
          role: true,
          status: true,
        },
      });

      await createAuditLog({
        action: 'USER_STATUS_CHANGED',
        entityType: 'USER',
        entityId: archived.id,
        userId: auth.id,
        oldValue: { status: existing.status },
        newValue: { status: archived.status },
        details: `Archived staff ${archived.nameEn} due to linked historical records`,
      });

      return NextResponse.json({
        ok: true,
        data: {
          deleted: false,
          archived: true,
          id: archived.id,
          references: {
            processedTransactions,
            approvedLoans,
            approvedUsers,
            processedSupportThreads,
          },
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      if (existing.email || existing.phone) {
        await tx.passwordResetToken.deleteMany({
          where: {
            OR: [
              ...(existing.email ? [{ email: existing.email }] : []),
              ...(existing.phone ? [{ phone: existing.phone }] : []),
            ],
          },
        });
      }
      await tx.notification.deleteMany({ where: { targetUserId: id } });
      await tx.user.delete({ where: { id } });
    });

    await createAuditLog({
      action: 'WORKER_UPDATED',
      entityType: 'USER',
      entityId: id,
      userId: auth.id,
      oldValue: { name: existing.nameEn, role: existing.role },
      newValue: {},
      details: `Deleted staff account ${existing.nameEn}`,
    });

    return NextResponse.json({
      ok: true,
      data: {
        deleted: true,
        archived: false,
        id,
      },
    });
  } catch (error) {
    console.error('[Admin/DeleteStaff] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to delete staff account' }, { status: 500 });
  }
}
