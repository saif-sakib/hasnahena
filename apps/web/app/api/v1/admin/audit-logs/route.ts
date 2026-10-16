export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { authErrorStatus } from '@/lib/auth';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { readableDetails } from '@/lib/audit-details';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_NAMES,
  NOISE_ACTIONS,
  actionsInCategory,
  type AuditCategory,
} from '@/lib/audit-actions';

/**
 * The audit trail for the admin screen — the real append-only record, unlike
 * the overview's "Recent Activity", which reconstructs events from current
 * state. Each row carries who, what (`details`) and to whom (entityId resolved
 * to a readable label). `q` matches details, action, actor name, and account,
 * receipt or loan numbers.
 */

const MAX_LIMIT = 100;

/**
 * A BOUNDED count for the numbered pager: at most this many ids, O(cap) not
 * O(table), since the trail only grows. Past it the pager shows `100+`.
 */
const COUNT_CEILING = 2_000;

interface Subject {
  label: string;
  kind: string;
}

/** Resolve each row's entityId to a readable label, batched per entity type. */
async function resolveSubjects(
  rows: Array<{ entityType: string; entityId: string }>,
): Promise<Map<string, Subject>> {
  const byType = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.entityId) continue;
    const set = byType.get(row.entityType) ?? new Set<string>();
    set.add(row.entityId);
    byType.set(row.entityType, set);
  }

  const out = new Map<string, Subject>();
  const key = (type: string, id: string) => `${type}:${id}`;

  const userIds = [...(byType.get('USER') ?? [])];
  const accountIds = [...(byType.get('ACCOUNT') ?? [])];
  const loanIds = [...(byType.get('LOAN') ?? [])];
  const txIds = [...(byType.get('TRANSACTION') ?? [])];

  /** All four lookups in parallel; an empty list makes no query. */
  const [userRows, accountRows, loanRows, txRows] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { OR: [{ id: { in: userIds } }, { formNumber: { in: userIds } }] },
          select: { id: true, nameEn: true, accountNo: true, formNumber: true, role: true },
        })
      : Promise.resolve([]),
    accountIds.length
      ? prisma.account.findMany({
          where: { userId: { in: accountIds } },
          select: { userId: true, user: { select: { nameEn: true, accountNo: true } } },
        })
      : Promise.resolve([]),
    loanIds.length
      ? prisma.loan.findMany({
          where: { id: { in: loanIds } },
          select: { id: true, borrower: { select: { nameEn: true } } },
        })
      : Promise.resolve([]),
    txIds.length
      ? prisma.transaction.findMany({
          where: { id: { in: txIds } },
          select: { id: true, type: true, amount: true, user: { select: { nameEn: true } } },
        })
      : Promise.resolve([]),
  ]);

  if (userIds.length) {
    // Match `id` OR `formNumber`: rows written before admission hold the
    // application number (ADR-043/044).
    for (const u of userRows) {
      // Account number first; an applicant's application number stands in.
      const identifier = u.accountNo || u.formNumber || '';
      const subject: Subject = {
        label: identifier ? `${u.nameEn} (${identifier})` : u.nameEn,
        kind: u.role,
      };
      out.set(key('USER', u.id), subject);
      // The same person, under the name the older rows call them by.
      if (u.formNumber) out.set(key('USER', u.formNumber), subject);
    }
  }

  // An account reads better as its member; its key is the member's id (ADR-044).
  if (accountIds.length) {
    for (const a of accountRows) {
      out.set(key('ACCOUNT', a.userId), {
        label: `${a.user.nameEn} (${a.user.accountNo ?? '—'})`,
        kind: 'MEMBER',
      });
    }
  }

  if (loanIds.length) {
    for (const l of loanRows) {
      out.set(key('LOAN', l.id), {
        label: `${l.id} — ${l.borrower.nameEn}`,
        kind: 'LOAN',
      });
    }
  }

  if (txIds.length) {
    for (const t of txRows) {
      out.set(key('TRANSACTION', t.id), {
        // A label, not arithmetic.
        label: `${t.id} — ${t.user.nameEn} — ৳${t.amount.toString()}`,
        kind: t.type,
      });
    }
  }

  return out;
}

/** Which user ids a free-text query names (account/application numbers, names). */
async function idsMatchingQuery(q: string): Promise<{ userIds: string[]; entityIds: string[] }> {
  const [users, loans, transactions] = await Promise.all([
    prisma.user.findMany({
      // Identifiers and names only — never phone, email or NID: those can match
      // a second person, and an NID search would make this a membership oracle.
      where: {
        OR: [
          { accountNo: { contains: q, mode: 'insensitive' } },
          { formNumber: { contains: q, mode: 'insensitive' } },
          { nameEn: { contains: q, mode: 'insensitive' } },
          { nameBn: { contains: q } },
        ],
      },
      select: { id: true, formNumber: true },
      take: 50,
    }),
    prisma.loan.findMany({
      where: { id: { contains: q, mode: 'insensitive' } },
      select: { id: true },
      take: 50,
    }),
    prisma.transaction.findMany({
      where: { id: { contains: q, mode: 'insensitive' } },
      select: { id: true },
      take: 50,
    }),
  ]);
  // Also match rows from when the person was still an applicant.
  const allUserIds = users.flatMap((u) => (u.formNumber ? [u.id, u.formNumber] : [u.id]));
  return {
    userIds: allUserIds,
    entityIds: [...allUserIds, ...loans.map((l) => l.id), ...transactions.map((t) => t.id)],
  };
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (auth.role !== 'ADMIN' && auth.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ ok: false, error: 'Admins only' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
    );
    const category = searchParams.get('category') as AuditCategory | null;
    const action = searchParams.get('action');
    const severity = searchParams.get('severity');
    const q = (searchParams.get('q') || '').trim();
    const from = parseDate(searchParams.get('from'));
    const to = parseDate(searchParams.get('to'));
    const includeNoise = searchParams.get('includeNoise') === 'true';

    const filters: Prisma.AuditLogWhereInput[] = [];

    if (action) {
      filters.push({ action });
    } else if (category) {
      const names = actionsInCategory(category);
      // An empty category must not become `IN ()`.
      if (names.length) filters.push({ action: { in: names } });
    } else if (severity) {
      const names = AUDIT_ACTION_NAMES.filter(
        (name) => AUDIT_ACTIONS[name].severity === severity,
      );
      if (names.length) filters.push({ action: { in: names } });
    }

    // Default view hides noise — unless an action or category is named.
    if (!includeNoise && !action && !category) {
      filters.push({ action: { notIn: NOISE_ACTIONS } });
    }

    if (from || to) {
      filters.push({ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
    }

    if (q) {
      const { entityIds } = await idsMatchingQuery(q);
      filters.push({
        OR: [
          { details: { contains: q, mode: 'insensitive' } },
          { action: { contains: q.toUpperCase().replace(/ /g, '_') } },
          ...(entityIds.length ? [{ entityId: { in: entityIds } }] : []),
          ...(entityIds.length ? [{ userId: { in: entityIds } }] : []),
        ],
      });
    }

    const where: Prisma.AuditLogWhereInput = filters.length ? { AND: filters } : {};

    // The page and the bounded count (ids only, capped), in parallel.
    const [rows, countRows] = await Promise.all([
      prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit + 1,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        // The sentence the writer composed.
        details: true,
        oldValue: true,
        newValue: true,
        userIp: true,
        createdAt: true,
        userId: true,
      },
      }),
      prisma.auditLog.findMany({
        where,
        select: { id: true },
        take: COUNT_CEILING + 1,
      }),
    ]);
    const hasMore = rows.length > limit;
    const logs = hasMore ? rows.slice(0, limit) : rows;

    // The total is a floor, so the pager can render `100+`.
    const countCapped = countRows.length > COUNT_CEILING;
    const matched = countCapped ? COUNT_CEILING : countRows.length;
    const totalPages = Math.max(1, Math.ceil(matched / limit));

    const actorIds = [...new Set(logs.map((l) => l.userId).filter((id): id is string => !!id))];
    const [actors, subjects] = await Promise.all([
      actorIds.length
        ? prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, nameEn: true, nameBn: true, role: true, accountNo: true },
          })
        : Promise.resolve([]),
      resolveSubjects(logs),
    ]);
    const actorMap = new Map(actors.map((a) => [a.id, a]));

    const data = logs.map((log) => {
      const actor = log.userId ? actorMap.get(log.userId) : undefined;
      const subject = subjects.get(`${log.entityType}:${log.entityId}`);
      return {
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        // Retired identifiers resolved at render time (lib/audit-details.ts).
        details: readableDetails(log.details, log.entityId),
        oldValue: log.oldValue,
        newValue: log.newValue,
        userIp: log.userIp,
        createdAt: log.createdAt.toISOString(),
        actor: actor
          ? {
              id: actor.id,
              nameEn: actor.nameEn,
              nameBn: actor.nameBn,
              role: actor.role,
              accountNo: actor.accountNo,
            }
          : // A null actor is the platform itself — the retention sweep, the
            // Named rather than blank.
            null,
        subject: subject ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      data,
      pagination: { page, limit, hasMore, totalPages, countCapped },
    });
  } catch (error) {
    const authStatus = authErrorStatus(error);
    if (authStatus) {
      return NextResponse.json(
        { ok: false, error: authStatus === 401 ? 'Unauthorized' : 'Server error' },
        { status: authStatus },
      );
    }
    console.error('[AuditLogs GET] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}
