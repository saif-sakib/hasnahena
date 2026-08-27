import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireActiveAuth, revokeAllTokens } from '@/lib/auth-revocation';
import { generateTemporaryPassword } from '@/lib/api-utils';
import { UserRole, UserStatus } from '@prisma/client';
import { createAuditLog } from '@/lib/audit';
import { RESET_SCOPE_FIRST_LOGIN, hashResetSecret } from '@/lib/reset-tokens';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';
import { liveIdentityFilter } from '@/lib/rejected-application';
import {
  NEXT_STAFF_NO_SQL,
  STAFF_NO_ADVISORY_LOCK_SQL,
  formatStaffNo,
} from '@/lib/account-no';

/**
 * WO-72. Staff rows always come back with their branch joined, so no caller has
 * to remember to ask for it and no response can carry a branch id the client
 * then has to resolve on its own.
 */
const STAFF_SELECT = {
  id: true,
  nameEn: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  accountNo: true,
  createdAt: true,
  assignedBranch: { select: { id: true, name: true, code: true } },
} as const;

type BranchSummary = { id: string; name: string; code: string } | null;

function toBranchSummary(branch: BranchSummary): BranchSummary {
  return branch ?? null;
}

/**
 * Resolves the submitted branch id, refusing one that does not exist.
 *
 * `null` and `undefined` both mean "no branch", which is legitimate — an admin
 * account is not assigned to an office. What is never legitimate is an id that
 * names nothing: the previous free-text column accepted anything, which is how
 * a typo became a branch that existed on exactly one row.
 */
async function resolveBranch(branchId: string | null | undefined): Promise<
  { ok: true; id: string | null } | { ok: false; message: string }
> {
  if (branchId === null || branchId === undefined || branchId === '') {
    return { ok: true, id: null };
  }
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) return { ok: false, message: 'Unknown branch' };
  return { ok: true, id: branch.id };
}

/**
 * Creating staff means creating a **worker**.
 *
 * `role` is not a field here, and that is the point rather than an omission. An
 * admin account is made directly in the database: a web form that mints one
 * turns "whoever holds an admin session right now" into "whoever can hold one
 * forever", and it records that escalation in `audit_logs` as routine staff
 * administration. The screen offers no Admin option either
 * (`dashboard/admin/workers`), so the UI and the API say the same thing.
 *
 * The schema used to accept `z.enum(['WORKER', 'ADMIN'])` on both create and
 * update, so a compromised or careless admin session could promote any account —
 * including a member's — in one request.
 */
const createStaffSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().regex(/^01\d{9}$/, 'Invalid Bangladeshi phone number'),
  // WO-72. Was a free string written straight into `users.assignedBranch`, so a
  // typo created a branch that existed on exactly one row and renaming an office
  // left every worker pointing at the old name. It is now a Branch id, validated
  // against the table before the write.
  assignedBranchId: z.string().trim().min(1).nullish(),
  locale: z.enum(['en', 'bn']).optional().default('en'),
});

/** Editing staff cannot change a role either — see the note on create. */
const updateStaffSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  phone: z.string().regex(/^01\d{9}$/, 'Invalid Bangladeshi phone number'),
  // WO-72. Was a free string written straight into `users.assignedBranch`, so a
  // typo created a branch that existed on exactly one row and renaming an office
  // left every worker pointing at the old name. It is now a Branch id, validated
  // against the table before the write.
  assignedBranchId: z.string().trim().min(1).nullish(),
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

    const parsed = createStaffSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { name, email, phone, assignedBranchId, locale } = parsed.data;

    const branch = await resolveBranch(assignedBranchId);
    if (!branch.ok) {
      return NextResponse.json({ ok: false, error: branch.message }, { status: 400 });
    }
    const resolvedBranchId = branch.id;

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.trim();

    // WO-90. Named rather than "email/phone": an admin told that one of two
    // values is taken, without being told which, has to guess. Both are looked
    // at, because both can be taken at once and the second attempt should not
    // be the first time they hear about the second one.
    //
    // `liveIdentityFilter` is load-bearing and was missing until 2026-08-26. A
    // **rejected application** owns nothing — that is the whole point of scoping
    // uniqueness to live rows (owner's ruling) — so a person whose membership
    // application was refused and who is then hired as a field worker must be
    // able to use their own email and phone. Without it, this told the admin
    // "that email address is already in use" and named a row the database would
    // have accepted the insert against: `users_email_live_key` and
    // `users_phone_live_key` both exclude rejected applications, so the check
    // was stricter than the constraint it exists to anticipate.
    //
    // `mode: 'insensitive'` for the same reason: the index is on
    // `lower("email")`, and an exact comparison would let `Foo@bar.com` past a
    // check that the constraint then rejects with a raw P2002.
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: normalizedEmail, mode: 'insensitive' } },
          { phone: normalizedPhone },
        ],
        ...liveIdentityFilter,
      },
      select: { id: true, email: true, phone: true },
    });
    if (existing) {
      const taken: string[] = [];
      if (existing.email?.toLowerCase() === normalizedEmail) taken.push('email address');
      if (existing.phone === normalizedPhone) taken.push('phone number');
      return NextResponse.json(
        {
          ok: false,
          error: taken.length
            ? `That ${taken.join(' and that ')} is already in use`
            : 'That value is already in use',
        },
        { status: 409 },
      );
    }

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // `STF-0001`, allocated the way a member's number is: under an advisory
    // lock, from the highest already issued, inside the transaction that creates
    // the row.
    //
    // It used to be `STF-<base36 millisecond>-<6 hex>`. That was unique — which
    // was the whole requirement, because a millisecond alone is not: two admins
    // adding staff in the same moment produced the same `accountNo`, `accountNo`
    // is `@unique`, and the second create raised P2002 on a column neither
    // caller had sent, so the 409 told them to change an email and phone that
    // were both fine. Randomness solved that and bought a number nobody can read
    // aloud, sort, or recognise — and which is now also the name of the folder
    // holding that person's photograph on the image host.
    //
    // The lock gives the same guarantee without the cost. It is taken inside the
    // transaction, so it is released by the commit or the rollback.
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(STAFF_NO_ADVISORY_LOCK_SQL);
      const [{ next_seq: nextSeq }] =
        await tx.$queryRawUnsafe<Array<{ next_seq: bigint }>>(NEXT_STAFF_NO_SQL);

      return tx.user.create({
        data: {
          email: normalizedEmail,
          phone: normalizedPhone,
          passwordHash,
          role: UserRole.WORKER,
          status: UserStatus.ACTIVE,
          accountNo: formatStaffNo(Number(nextSeq)),
          nameEn: name.trim(),
          fatherName: name.trim(),
          motherName: name.trim(),
          assignedBranchId: resolvedBranchId,
        },
        select: STAFF_SELECT,
      });
    });

    // The marker whose existence is `mustChangePassword`. Hashed and scoped
    // like every other row of this table (WO-86) — the secret is never
    // presented, but a row keyed on something guessable is a row somebody can
    // plant.
    await prisma.passwordResetToken.create({
      data: {
        scope: RESET_SCOPE_FIRST_LOGIN,
        tokenHash: hashResetSecret(randomBytes(24).toString('hex')),
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
        role: 'WORKER',
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
      details: `Created worker account for ${created.nameEn}`,
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
        branch: toBranchSummary(created.assignedBranch),
        joinDate: created.createdAt.toISOString(),
      },
    });
  } catch (error) {
    // routeErrorStatus first: an expired session and a malformed body both
    // used to land here and be reported as a 500 (TEST-16, TEST-18).
    const status = routeErrorStatus(error);
    if (status) {
      return NextResponse.json({ ok: false, error: routeErrorMessage(error, 'Failed to create staff account') }, { status });
    }
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

    const parsed = updateStaffSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id, name, phone, assignedBranchId } = parsed.data;

    const branch = await resolveBranch(assignedBranchId);
    if (!branch.ok) {
      return NextResponse.json({ ok: false, error: branch.message }, { status: 400 });
    }
    const resolvedBranchId = branch.id;

    const normalizedPhone = phone.trim();

    // Get old values for audit
    const oldUser = await prisma.user.findUnique({
      where: { id },
      select: { nameEn: true, phone: true, role: true, assignedBranchId: true },
    });

    // This screen manages workers. An admin row is listed there but carries no
    // actions, so reaching this with one means a request the UI does not make.
    if (!oldUser) {
      return NextResponse.json({ ok: false, error: 'Worker not found' }, { status: 404 });
    }
    if (oldUser.role !== UserRole.WORKER) {
      return NextResponse.json(
        { ok: false, error: 'Only worker accounts can be edited here' },
        { status: 400 },
      );
    }

    // Same rule as create: a rejected application holds no phone number, so
    // giving a worker a number that only a refused applicant "has" is allowed.
    const existingPhone = await prisma.user.findFirst({
      where: {
        phone: normalizedPhone,
        id: { not: id },
        ...liveIdentityFilter,
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
        assignedBranchId: resolvedBranchId,
      },
      select: STAFF_SELECT,
    });

    // Audit log for worker update
    await createAuditLog({
      action: 'WORKER_UPDATED',
      entityType: 'USER',
      entityId: updated.id,
      userId: auth.id,
      oldValue: oldUser,
      newValue: { name: updated.nameEn, role: updated.role, phone: updated.phone },
      details: `Updated worker account for ${updated.nameEn}`,
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
        branch: toBranchSummary(updated.assignedBranch),
        joinDate: updated.createdAt.toISOString(),
      },
    });
  } catch (error) {
    // routeErrorStatus first: an expired session and a malformed body both
    // used to land here and be reported as a 500 (TEST-16, TEST-18).
    const status = routeErrorStatus(error);
    if (status) {
      return NextResponse.json({ ok: false, error: routeErrorMessage(error, 'Failed to update staff account') }, { status });
    }
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

    const parsed = updateStaffStatusSchema.safeParse(await readJsonBody(req));
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
      select: STAFF_SELECT,
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Worker not found' }, { status: 404 });
    }

    if (existing.role !== UserRole.WORKER) {
      return NextResponse.json({ ok: false, error: 'Only worker accounts can be updated here' }, { status: 400 });
    }

    // WO-91. Deactivating a worker and ending their sessions are one fact, so
    // they are one transaction. `status` is read at **login** and nowhere else:
    // neither backend re-reads it per request, by design — that would be a
    // second user lookup on every call — so the revocation marker is the *only*
    // thing that takes a deactivated worker's staff token away. Without it a
    // dismissed worker went on posting deposits and processing withdrawals
    // until their token expired, up to a day later.
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id },
        data: {
          status: status === 'ACTIVE' ? UserStatus.ACTIVE : UserStatus.INACTIVE,
        },
        select: STAFF_SELECT,
      });
      if (status === 'INACTIVE') {
        await revokeAllTokens(tx, id, 'admin_revoke');
      }
      return row;
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
        branch: toBranchSummary(updated.assignedBranch),
        joinDate: updated.createdAt.toISOString(),
      },
    });
  } catch (error) {
    // routeErrorStatus first: an expired session and a malformed body both
    // used to land here and be reported as a 500 (TEST-16, TEST-18).
    const status = routeErrorStatus(error);
    if (status) {
      return NextResponse.json({ ok: false, error: routeErrorMessage(error, 'Failed to update staff status') }, { status });
    }
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

    if (existing.role !== UserRole.WORKER) {
      return NextResponse.json({ ok: false, error: 'Only worker accounts can be deleted here' }, { status: 400 });
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
      // The branch that runs for any worker who has ever processed a
      // transaction — which is every real worker — and the one that used to
      // stop a step short: it set INACTIVE and left the token alive (WO-91).
      const archived = await prisma.$transaction(async (tx) => {
        const row = await tx.user.update({
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
        await revokeAllTokens(tx, id, 'admin_revoke');
        return row;
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
        // Reset tokens are keyed by contact details rather than by user id, so
        // the cascade below cannot reach them. Leaving them would let a
        // first-login link for a deleted account be redeemed against whoever is
        // given that phone number next.
        await tx.passwordResetToken.deleteMany({
          where: {
            OR: [
              ...(existing.email ? [{ email: existing.email }] : []),
              ...(existing.phone ? [{ phone: existing.phone }] : []),
            ],
          },
        });
      }
      // Notifications are NOT deleted here any more. `targetUserId` is a real
      // foreign key with `onDelete: Cascade` since WO-92, and two mechanisms
      // for one rule is how they drift — this hand-written one was the only
      // deletion path that had it, which is exactly the problem.
      await revokeAllTokens(tx, id, 'admin_revoke');
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
    const status = routeErrorStatus(error);
    if (status) {
      return NextResponse.json({ ok: false, error: routeErrorMessage(error, 'Failed to delete staff account') }, { status });
    }
    console.error('[Admin/DeleteStaff] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to delete staff account' }, { status: 500 });
  }
}
