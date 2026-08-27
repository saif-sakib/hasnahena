import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { createAuditLog } from '@/lib/audit';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';

/**
 * WO-72. Branches, as a thing an admin can actually manage.
 *
 * The `branches` table existed from the beginning and nothing read or wrote it,
 * while `users.assignedBranch` held a free-text office name with no link to it.
 * Two homes for one fact, connected by nothing — so renaming an office left
 * every worker pointing at the old name, and a typo created a branch that
 * existed on exactly one row.
 *
 * A note on the branch *code*: it is the human-readable prefix (`KH`), but
 * member IDs are **not** generated from it. They come from the hardcoded
 * `utils.AccountNoPrefix` ("ACC-KH-33") in the Go API, because that identifier is
 * read aloud and written into paper passbooks and its format is fixed
 * (ADR-008). Adding a branch here does not change how member IDs are issued.
 */

const branchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  // Uppercase and short, because it is the human-readable half of an office's
  // identity and it appears next to the name in every picker.
  code: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and hyphens only'),
  address: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateSchema = branchSchema.partial().extend({ id: z.string().trim().min(1) });

const BRANCH_SELECT = {
  id: true,
  name: true,
  code: true,
  address: true,
  phone: true,
  isActive: true,
  createdAt: true,
  // Members and staff counted apart.
  //
  // A branch's `users` are everyone attached to it since 2026-08-27, and the two
  // numbers answer different questions: how many people bank here decides
  // whether the office matters, how many work here decides whether it can be
  // closed. One combined count would have quietly changed what the existing
  // "N staff" label on the screen meant the moment members started carrying a
  // branch — the same number, a different fact, no code change to notice.
  _count: { select: { users: true } },
} as const;

/** Staff attached to a branch, which is what decides whether it can be deleted. */
function countStaff(branchId: string) {
  return prisma.user.count({
    where: { assignedBranchId: branchId, role: { in: ['WORKER', 'ADMIN', 'SUPER_ADMIN'] } },
  });
}

/** Members attached to a branch. */
function countMembers(branchId: string) {
  return prisma.user.count({ where: { assignedBranchId: branchId, role: 'MEMBER' } });
}

function isAdmin(auth: { role?: string | null }): boolean {
  return ['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase());
}

function forbidden() {
  return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
}

function fail(error: unknown, fallback: string) {
  const status = routeErrorStatus(error);
  if (status) {
    return NextResponse.json({ ok: false, error: routeErrorMessage(error, fallback) }, { status });
  }
  console.error(`[Admin/Branches] ${fallback}:`, error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}

/** Every branch, newest office last. Member and staff counts come along so the
 *  admin can see what deactivating one would affect. */
export async function GET(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (!isAdmin(auth)) return forbidden();
    const branches = await prisma.branch.findMany({
      select: BRANCH_SELECT,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    // One grouped query for every branch rather than two per branch. There will
    // be a handful of offices and hundreds of members, and this list is loaded
    // by an admin screen against a metered database — 2N round trips for a
    // number is the shape of query that is fine until it is not.
    const grouped = await prisma.user.groupBy({
      by: ['assignedBranchId', 'role'],
      where: { assignedBranchId: { not: null } },
      _count: { _all: true },
    });
    const tally = new Map<string, { staff: number; members: number }>();
    for (const row of grouped) {
      const key = row.assignedBranchId as string;
      const entry = tally.get(key) ?? { staff: 0, members: 0 };
      if (row.role === 'MEMBER') entry.members += row._count._all;
      else entry.staff += row._count._all;
      tally.set(key, entry);
    }
    return NextResponse.json({
      ok: true,
      data: branches.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        address: b.address ?? '',
        phone: b.phone ?? '',
        isActive: b.isActive,
        staffCount: tally.get(b.id)?.staff ?? 0,
        memberCount: tally.get(b.id)?.members ?? 0,
        createdAt: b.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return fail(error, 'Failed to load branches');
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (!isAdmin(auth)) return forbidden();
    const parsed = branchSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const code = parsed.data.code.toUpperCase();

    const clash = await prisma.branch.findUnique({ where: { code }, select: { id: true } });
    if (clash) {
      return NextResponse.json({ ok: false, error: 'A branch with this code already exists' }, { status: 409 });
    }

    const created = await prisma.branch.create({
      data: {
        name: parsed.data.name,
        code,
        address: parsed.data.address || null,
        phone: parsed.data.phone || null,
        isActive: parsed.data.isActive ?? true,
      },
      select: BRANCH_SELECT,
    });

    await createAuditLog({
      action: 'BRANCH_CREATED',
      entityType: 'BRANCH',
      entityId: created.id,
      userId: auth.id,
      newValue: { name: created.name, code: created.code },
      details: `Created branch ${created.name} (${created.code})`,
    });

    return NextResponse.json(
      { ok: true, data: { ...created, staffCount: 0, memberCount: 0 } },
      { status: 201 },
    );
  } catch (error) {
    return fail(error, 'Failed to create branch');
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (!isAdmin(auth)) return forbidden();
    const parsed = updateSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { id, ...changes } = parsed.data;

    const existing = await prisma.branch.findUnique({ where: { id }, select: { id: true, name: true, code: true } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 });
    }

    const code = changes.code ? changes.code.toUpperCase() : undefined;
    if (code && code !== existing.code) {
      const clash = await prisma.branch.findUnique({ where: { code }, select: { id: true } });
      if (clash) {
        return NextResponse.json({ ok: false, error: 'A branch with this code already exists' }, { status: 409 });
      }
    }

    const updated = await prisma.branch.update({
      where: { id },
      data: {
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(code !== undefined ? { code } : {}),
        ...(changes.address !== undefined ? { address: changes.address || null } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone || null } : {}),
        ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
      },
      select: BRANCH_SELECT,
    });

    await createAuditLog({
      action: 'BRANCH_UPDATED',
      entityType: 'BRANCH',
      entityId: updated.id,
      userId: auth.id,
      oldValue: existing,
      newValue: { name: updated.name, code: updated.code, isActive: updated.isActive },
      details: `Updated branch ${updated.name} (${updated.code})`,
    });

    return NextResponse.json({
      ok: true,
      data: {
        ...updated,
        staffCount: await countStaff(updated.id),
        memberCount: await countMembers(updated.id),
      },
    });
  } catch (error) {
    return fail(error, 'Failed to update branch');
  }
}

/**
 * Deactivates rather than deletes when **anyone** is attached.
 *
 * `User.assignedBranch` is `onDelete: SetNull`, so deleting a branch with people
 * on it silently unassigns them — a quiet loss of information that nothing in
 * the UI would report. Deactivating keeps the history and takes the branch out
 * of the picker, which is what "close an office" actually means.
 *
 * Members count for this as of 2026-08-27, and they are the more important half:
 * unassigning a worker is an administrative annoyance, while unassigning three
 * hundred members silently detaches every one of them from the office holding
 * their passbook.
 */
export async function DELETE(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (!isAdmin(auth)) return forbidden();
    const id = new URL(req.url).searchParams.get('id')?.trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Branch id is required' }, { status: 400 });
    }

    const existing = await prisma.branch.findUnique({
      where: { id },
      select: { id: true, name: true, code: true, _count: { select: { users: true } } },
    });
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 });
    }

    if (existing._count.users > 0) {
      const [staffCount, memberCount] = await Promise.all([countStaff(id), countMembers(id)]);
      const attached = [
        memberCount > 0 ? `${memberCount} member${memberCount === 1 ? '' : 's'}` : null,
        staffCount > 0 ? `${staffCount} staff` : null,
      ]
        .filter(Boolean)
        .join(' and ');
      const deactivated = await prisma.branch.update({
        where: { id },
        data: { isActive: false },
        select: BRANCH_SELECT,
      });
      await createAuditLog({
        action: 'BRANCH_DEACTIVATED',
        entityType: 'BRANCH',
        entityId: id,
        userId: auth.id,
        oldValue: { name: existing.name, code: existing.code },
        details: `Deactivated branch ${existing.name} — ${attached} still assigned`,
      });
      return NextResponse.json({
        ok: true,
        deactivated: true,
        message: `${attached} are assigned to this branch, so it was deactivated rather than deleted.`,
        data: { ...deactivated, staffCount, memberCount },
      });
    }

    await prisma.branch.delete({ where: { id } });
    await createAuditLog({
      action: 'BRANCH_DELETED',
      entityType: 'BRANCH',
      entityId: id,
      userId: auth.id,
      oldValue: { name: existing.name, code: existing.code },
      details: `Deleted branch ${existing.name} (${existing.code})`,
    });

    return NextResponse.json({ ok: true, deactivated: false });
  } catch (error) {
    return fail(error, 'Failed to delete branch');
  }
}
