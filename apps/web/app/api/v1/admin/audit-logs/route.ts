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
 * The audit trail, for the screen that reads it.
 *
 * ---
 *
 * **What this is not.** The admin overview has a "Recent Activity" list, and it
 * is not this. That list is a `UNION` over `users`, `loans` and `transactions`
 * that *reconstructs* events from current state, so it can only ever show things
 * that left a row behind: it cannot show a sign-in, a password reset, a member
 * erasure, a branch closure, a lockout, or a ledger drift, and it cannot show
 * anything about a record that has since been deleted. It also cannot be wrong
 * in a useful way — reconstructing history from state means history changes when
 * state does. `audit_logs` is append-only at the database level (DATA-08) and is
 * the actual record.
 *
 * **Three things every row needs and only one of which was here before:**
 *
 *   1. *who* — the actor. Was already resolved.
 *   2. *what* — including `details`, the human-readable sentence each writer
 *      composes. **It was not selected.** Every row came back without the one
 *      field that says what happened, which is most of why nothing could be
 *      built on this endpoint.
 *   3. *to whom* — `entityId` is a cuid. On its own it is unreadable, and an
 *      audit trail whose subject has to be looked up by hand in another table is
 *      one nobody uses twice. Resolved below, per entity type.
 *
 * **Searching.** `q` matches the details text, the action, the actor's name and
 * — the case that matters — an **account number, receipt number or loan
 * number**. An admin investigating something has one of those in their hand, not
 * a cuid, so the search resolves them to ids first and then matches rows where
 * that id is either the actor or the subject.
 */

const MAX_LIMIT = 100;

/**
 * How far ahead the pager is allowed to count.
 *
 * Numbered pages need a total, and a plain `COUNT(*)` is what this route was
 * built without: it scans every matching row, on every keystroke of the search
 * box, against a database that bills for being awake (ADR-035), to render the
 * word "of". That reasoning has not changed.
 *
 * What changed is the requirement — an admin needs to jump to page 7, not press
 * Next seven times. So the count is **bounded**: it asks for at most this many
 * matching rows and reports "at least this many" when it hits the ceiling. The
 * cost is O(cap), not O(table), so it cannot grow into the scan the original
 * decision was avoiding however long the trail gets — and the trail only grows,
 * because `audit_logs` is append-only and most of it is kept permanently.
 *
 * 2,000 rows is 100 pages at the default size, which is more jumping than the
 * filters make useful; past that the pager shows `100+` and Next still works.
 */
const COUNT_CEILING = 2_000;

interface Subject {
  label: string;
  kind: string;
}

/**
 * Turn each row's `entityId` into something a person can read.
 *
 * Batched per entity type rather than per row: a page of fifty rows was fifty
 * round trips to a database that bills for being awake (ADR-035).
 */
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

  /**
   * All four lookups at once.
   *
   * They were awaited one after another, which is four sequential round trips
   * to a database in another region — the functions are pinned to `sin1` beside
   * Neon now (deployment.md), but "four in a row" is a cost that should not
   * exist at any latency. Nothing here depends on anything else here; they were
   * sequential only because they were written in the order the types occurred to
   * somebody. An empty list resolves without a query at all.
   */
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
    // **`id` OR `formNumber`, in one query.**
    //
    // A person's id moves once, at admission, from `APP-2026-000001` to
    // `ACC-KH-33001` (ADR-043), and rows written before that keep the id they
    // were written with — `audit_logs` is append-only at the database level and
    // its trigger refuses UPDATE. That refusal is right, and since ADR-043 it
    // costs nothing: the value those rows hold is the applicant's own form
    // number, which is readable, and which `users.formNumber` still holds for
    // its own reasons. There is no mapping table to consult (ADR-044 removed
    // `user_id_history`); the column that already records the fact answers it.
    for (const u of userRows) {
      // The account number first, because that is what the office says out loud.
      // An applicant has none, so their application number stands in — and
      // somebody erased has neither name nor number worth printing beyond what
      // the erasure left, which is deliberately just the account number.
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

  // An account row is one member's, so it reads better as the member — and
  // since ADR-044 the account's key *is* the member's, so this is a lookup by
  // the number that was already printed on the row.
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
        // Whole taka, formatted by the reader — this is a label, not money the
        // screen does arithmetic on, so it is a string by the time it leaves here.
        label: `${t.id} — ${t.user.nameEn} — ৳${t.amount.toString()}`,
        kind: t.type,
      });
    }
  }

  return out;
}

/**
 * Which user ids a free-text query names.
 *
 * An admin searches for `ACC-KH-33001`, `Rahim`, `DEP-2026-000042` — never for a
 * cuid. Without this step the search box silently matches nothing for exactly
 * the inputs somebody would actually type.
 */
async function idsMatchingQuery(q: string): Promise<{ userIds: string[]; entityIds: string[] }> {
  const [users, loans, transactions] = await Promise.all([
    prisma.user.findMany({
      // Identifiers and names only — deliberately **not** phone, email or NID.
      //
      // Two reasons, and the second is the real one. A rejected applicant and a
      // live member may share a phone number (uniqueness is scoped to live rows),
      // so matching on one here would silently pull a second person's history
      // into a search an admin is about to draw a conclusion from. And a search
      // box that accepts a national ID number turns the audit screen into a way
      // of asking "is this person a member", which is the question
      // `rejected-application.ts` and ADR-032 both exist to stop being
      // answerable. `accountNo`, the application number and the name cover every
      // search anybody actually performs.
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
  // Searching `ACC-KH-33001` must also find what that person did while they were
  // `APP-2026-000001`. Without this, admission is a hole in their own history —
  // and the application period is exactly the part somebody investigating a
  // registration wants to read. The form number is on the row itself, so this
  // needs no second query and no history table.
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
      // An empty category would produce `IN ()`, which matches nothing and looks
      // to the reader exactly like "there is no history here".
      if (names.length) filters.push({ action: { in: names } });
    } else if (severity) {
      const names = AUDIT_ACTION_NAMES.filter(
        (name) => AUDIT_ACTIONS[name].severity === severity,
      );
      if (names.length) filters.push({ action: { in: names } });
    }

    // The default view answers "what would need explaining", so the high-volume
    // routine actions are out unless asked for. Never applied when the reader has
    // named an action or a category — asking for sign-ins and being shown none
    // is the kind of filter interaction that makes a screen untrustworthy.
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

    // **One page, and one row past it.** There is no `count()` here on purpose.
    //
    // The screen shows the most recent entries and loads more when the reader
    // asks. A total needs a second query that scans every row the filter
    // matches — on every keystroke of the search box, against a database that
    // bills for being awake (ADR-035) — to produce a number whose only use is
    // the word "of". Asking for `limit + 1` rows answers the question the
    // button actually needs, which is whether there is anything after this.
    /**
     * The page, and how many pages there are — in parallel.
     *
     * The count selects `id` only and stops at the ceiling, so what comes back
     * is at most 2,000 integers off the same index the page query uses. It is
     * not a `COUNT(*)`: it cannot read the whole table.
     */
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
        // The sentence the writer composed. Not selected before this, which is
        // why every row arrived saying nothing.
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

    // `countCapped` says the total is a floor rather than a fact, so the pager
    // can render `100+` instead of claiming a number it did not finish counting.
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
        // The sentence as written, with a retired identifier resolved to the
        // name the row itself already carries. The stored row is untouched —
        // see lib/audit-details.ts.
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
            // reconciliation pass. Named rather than left blank, because "who did
            // this" with no answer reads as missing data.
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
