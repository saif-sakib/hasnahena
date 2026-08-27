export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { authErrorStatus } from '@/lib/auth';
import { requireActiveAuth } from '@/lib/auth-revocation';
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
  if (userIds.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nameEn: true, accountNo: true, formNumber: true, role: true },
    });

    // **Ids that resolve to nobody, resolved through the rename history.**
    //
    // `users.id` is the number a person is known by (ADR-043), so it moves once
    // — from `APP-2026-000001` to `ACC-KH-33001` — when they are admitted. Rows
    // written before that keep the id they were written with, because
    // `audit_logs` is append-only at the database level and its trigger refuses
    // UPDATE unconditionally. Rewriting the trail so it agreed with the present
    // is the exact thing that trigger exists to stop, and it is right: a record
    // of who somebody was called at the time is worth more than one that has
    // been tidied.
    //
    // So the *reader* does the work. `user_id_history` is one hop by
    // construction, so this is a second query and never a walk.
    const unresolved = userIds.filter((id) => !users.some((u) => u.id === id));
    if (unresolved.length) {
      const renames = await prisma.userIdHistory.findMany({
        where: { oldId: { in: unresolved } },
        select: { oldId: true, newId: true },
      });
      if (renames.length) {
        const renamed = await prisma.user.findMany({
          where: { id: { in: renames.map((r) => r.newId) } },
          select: { id: true, nameEn: true, accountNo: true, formNumber: true, role: true },
        });
        for (const rename of renames) {
          const person = renamed.find((u) => u.id === rename.newId);
          if (!person) continue;
          const identifier = person.accountNo || person.formNumber || '';
          out.set(key('USER', rename.oldId), {
            label: identifier ? `${person.nameEn} (${identifier})` : person.nameEn,
            kind: person.role,
          });
        }
      }
    }

    for (const u of users) {
      // The account number first, because that is what the office says out loud.
      // An applicant has none, so their application number stands in — and
      // somebody erased has neither name nor number worth printing beyond what
      // the erasure left, which is deliberately just the account number.
      const identifier = u.accountNo || u.formNumber || '';
      out.set(key('USER', u.id), {
        label: identifier ? `${u.nameEn} (${identifier})` : u.nameEn,
        kind: u.role,
      });
    }
  }

  // An account row is one member's, so it reads better as the member.
  const accountIds = [...(byType.get('ACCOUNT') ?? [])];
  if (accountIds.length) {
    const accounts = await prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, user: { select: { nameEn: true, accountNo: true } } },
    });
    for (const a of accounts) {
      out.set(key('ACCOUNT', a.id), {
        label: `${a.user.nameEn} (${a.user.accountNo ?? '—'})`,
        kind: 'MEMBER',
      });
    }
  }

  const loanIds = [...(byType.get('LOAN') ?? [])];
  if (loanIds.length) {
    const loans = await prisma.loan.findMany({
      where: { id: { in: loanIds } },
      select: { id: true, loanNumber: true, borrower: { select: { nameEn: true } } },
    });
    for (const l of loans) {
      out.set(key('LOAN', l.id), {
        label: `${l.loanNumber} — ${l.borrower.nameEn}`,
        kind: 'LOAN',
      });
    }
  }

  const txIds = [...(byType.get('TRANSACTION') ?? [])];
  if (txIds.length) {
    const txs = await prisma.transaction.findMany({
      where: { id: { in: txIds } },
      select: {
        id: true,
        receiptNumber: true,
        type: true,
        amount: true,
        user: { select: { nameEn: true } },
      },
    });
    for (const t of txs) {
      out.set(key('TRANSACTION', t.id), {
        // Whole taka, formatted by the reader — this is a label, not money the
        // screen does arithmetic on, so it is a string by the time it leaves here.
        label: `${t.receiptNumber ?? t.type} — ${t.user.nameEn} — ৳${t.amount.toString()}`,
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
      select: { id: true },
      take: 50,
    }),
    prisma.loan.findMany({
      where: { loanNumber: { contains: q, mode: 'insensitive' } },
      select: { id: true },
      take: 50,
    }),
    prisma.transaction.findMany({
      where: { receiptNumber: { contains: q, mode: 'insensitive' } },
      select: { id: true },
      take: 50,
    }),
  ]);
  const userIds = users.map((u) => u.id);
  // Searching `ACC-KH-33001` must also find what that person did while they were
  // `APP-2026-000001`. Without this, admission is a hole in their own history —
  // and the application period is exactly the part somebody investigating a
  // registration wants to read.
  const priorIds = userIds.length
    ? (
        await prisma.userIdHistory.findMany({
          where: { newId: { in: userIds } },
          select: { oldId: true },
        })
      ).map((r) => r.oldId)
    : [];
  const allUserIds = [...userIds, ...priorIds];
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
    const rows = await prisma.auditLog.findMany({
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
    });
    const hasMore = rows.length > limit;
    const logs = hasMore ? rows.slice(0, limit) : rows;

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
        details: log.details,
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
      pagination: { page, limit, hasMore },
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
