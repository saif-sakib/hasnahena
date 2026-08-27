export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { createAuditLog } from '@/lib/audit';
import { rejectedApplicationFilter } from '@/lib/rejected-application';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_NAMES,
  AUDIT_RETENTION_DAYS,
  type AuditRetention,
} from '@/lib/audit-actions';
import { purgeApplicationDocuments } from '@/lib/application-documents';
import { routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';

/**
 * The half of the retention policy that has to reach Cloudinary.
 *
 * The Go API sweeps a rejected application's identity **text** on its own daily
 * loop (`retention_repository.go`, FR-23). It cannot touch the **images**,
 * because the image host is configured in this app and in one place — the same
 * split as the member erasure, and for the same reason.
 *
 * Two callers, on purpose:
 *
 *   1. **The approvals screen**, immediately after an admin refuses an
 *      application, with `{ userId }`. That is when the scans stop having a
 *      purpose, and waiting a day to delete a national identity card because a
 *      cron runs at midnight is a day of exposure bought for nothing.
 *   2. **A scheduled sweep**, with no body, authenticated by `CRON_SECRET`.
 *      This is what makes (1) safe to be a browser-initiated call: a closed
 *      tab, a dropped connection or a Cloudinary outage costs a delay, not the
 *      deletion. Anything (1) missed is found here.
 *
 * A sweep that finds nothing is the expected outcome on most days, and reports
 * `{ purged: 0 }` rather than staying silent — a retention job whose healthy
 * output is indistinguishable from a broken one is not evidence of anything.
 */

/**
 * Delete the audit rows whose tier has expired.
 *
 * **Most rows are never deleted.** Everything about money, about a decision made
 * concerning a person, and about data being destroyed is `permanent` — the last
 * of those circularly so, since those rows are the evidence that the policy was
 * followed (ADR-038). What expires is operational noise: sign-ins, sign-outs,
 * verification codes, reset requests for identifiers that are not members.
 *
 * The tier lives beside the action in `lib/audit-actions.ts`, not here, because
 * "may this be deleted" is a property of what happened rather than of the job
 * that deletes it. This function only applies the clock.
 *
 * `audit_logs` refuses `DELETE` at the database level (DATA-08). The opt-in is
 * `SET LOCAL`, so it is scoped to this transaction and this connection and
 * cannot leak to a neighbouring pooled one — and it has to be written on
 * purpose, which is what distinguishes a policy from an accident.
 */
async function expireAuditRows(): Promise<{ deleted: number; byTier: Record<string, number> }> {
  const tiers = Object.keys(AUDIT_RETENTION_DAYS) as Array<Exclude<AuditRetention, 'permanent'>>;
  const byTier: Record<string, number> = {};
  let deleted = 0;

  for (const tier of tiers) {
    const actions = AUDIT_ACTION_NAMES.filter((name) => AUDIT_ACTIONS[name].retention === tier);
    if (!actions.length) continue;
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS[tier] * 86_400_000);

    const count = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL hasnahena.allow_audit_purge = 'on'");
      const result = await tx.auditLog.deleteMany({
        where: { action: { in: actions }, createdAt: { lt: cutoff } },
      });
      return result.count;
    });

    if (count > 0) byTier[tier] = count;
    deleted += count;
  }

  return { deleted, byTier };
}

/** The clock is only for the text half; images go at the decision. */
async function refusedApplicationsWithDocuments(limit: number) {
  return prisma.user.findMany({
    where: {
      ...rejectedApplicationFilter,
      documents: { some: {} },
    },
    select: { id: true, accountNo: true, formNumber: true },
    orderBy: { rejectedAt: 'asc' },
    take: limit,
  });
}

function cronAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means no unauthenticated caller is ever accepted. The
  // alternative — treating an unset variable as "no check" — turns a missing
  // environment variable into an open erasure endpoint.
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

/**
 * The scheduled sweep, which Vercel invokes with a **GET**.
 *
 * Vercel Cron sends `GET` and attaches `Authorization: Bearer $CRON_SECRET`
 * itself; there is no way to make it send a POST. Writing this as POST-only —
 * which it was for about ten minutes — is a cron job that returns 405 every
 * night and a retention policy that has never once run, with nothing on any
 * screen to say so.
 *
 * It takes no parameters. Everything an admin can steer goes through POST.
 */
export async function GET(req: Request) {
  if (cronAuthorised(req)) return runSweep(req, null);

  // Not the scheduler. Answer the way every other guarded route does — 401 for
  // a caller with no usable session, 403 for one who has a session and still may
  // not be here — so this endpoint is not the single exception the contract
  // suite has to be told about.
  //
  // **No role reaches this, including a super admin.** Everything an admin may
  // steer is on POST, which audits who did it; a GET that also answered a token
  // would be a second way to expire the audit log with no name attached.
  try {
    await requireActiveAuth(req);
  } catch (error) {
    const status = routeErrorStatus(error) ?? 401;
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status });
  }
  return NextResponse.json(
    { ok: false, error: 'This endpoint is called by the scheduler' },
    { status: 403 },
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { userId?: unknown } | null;
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';

    if (cronAuthorised(req)) {
      // The scheduled caller sweeps; it may not target one person. Naming a row
      // is an admin's act and belongs to an admin's audit trail.
      if (userId) {
        return NextResponse.json(
          { ok: false, error: 'The scheduled sweep does not take a userId' },
          { status: 400 },
        );
      }
      return runSweep(req, null);
    }

    const auth = await requireActiveAuth(req);
    if (!['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Admins only' }, { status: 403 });
    }
    return runSweep(req, { actorId: auth.id, userId });
  } catch (error) {
    const status = routeErrorStatus(error);
    if (status) {
      return NextResponse.json(
        { ok: false, error: routeErrorMessage(error, 'Retention sweep failed') },
        { status },
      );
    }
    console.error('[Retention] sweep failed:', error);
    return NextResponse.json({ ok: false, error: 'Retention sweep failed' }, { status: 500 });
  }
}

/**
 * The work, once the caller has been established.
 *
 * `caller` is `null` for the scheduled pass and carries the admin's id — and,
 * optionally, the one application they are refusing — otherwise.
 */
async function runSweep(
  req: Request,
  caller: { actorId: string; userId: string } | null,
): Promise<NextResponse> {
  const actorId = caller?.actorId ?? null;
  const userId = caller?.userId ?? '';
  try {
    const targets = userId
      ? await prisma.user.findMany({
          // Filtered, not trusted. An admin passing a *member's* id here would
          // otherwise delete a live member's identity documents through a route
          // whose whole subject is refused applications.
          where: { id: userId, ...rejectedApplicationFilter },
          select: { id: true, accountNo: true, formNumber: true },
        })
      : await refusedApplicationsWithDocuments(50);

    let purged = 0;
    let assetsDeleted = 0;
    const failures: string[] = [];

    for (const target of targets) {
      const result = await purgeApplicationDocuments(target.id);
      if (result.assets === null) {
        failures.push(target.formNumber ?? target.id);
        continue;
      }
      purged += 1;
      assetsDeleted += result.assets;

      // One row per application, not one per sweep. `audit_logs` is append-only
      // (DATA-08), so this outlives everything it describes — which is the point:
      // it must be possible to show that the foundation deleted somebody's
      // national identity card, and when, long after nothing else remembers they
      // applied.
      //
      // It names the application number and the counts, and nothing it erased.
      await createAuditLog({
        action: 'APPLICATION_DOCUMENTS_ERASED',
        entityType: 'USER',
        entityId: target.id,
        userId: actorId ?? undefined,
        newValue: {
          formNumber: target.formNumber,
          documents: result.rows,
          assetsDeleted: result.assets,
        },
        details: actorId
          ? 'Identity documents erased when the application was refused'
          : 'Identity documents erased by the scheduled retention sweep',
        request: req,
      });
    }

    // Only on the scheduled pass. Expiring audit rows is the policy running, not
    // something an admin does to one application, and doing it inside a
    // per-rejection call would make the two indistinguishable in the trail.
    let auditExpired = 0;
    if (!userId) {
      const expiry = await expireAuditRows();
      auditExpired = expiry.deleted;
      if (expiry.deleted > 0) {
        await createAuditLog({
          action: 'AUDIT_LOG_EXPIRED',
          entityType: 'SETTINGS',
          entityId: 'audit_logs',
          newValue: { deleted: expiry.deleted, byTier: expiry.byTier },
          details: 'Audit entries past their retention tier were removed',
        });
      }
    }

    if (failures.length > 0) {
      console.error(
        `[Retention] ${failures.length} application(s) still have documents stored: ` +
          `${failures.join(', ')}. They will be retried on the next sweep.`,
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        considered: targets.length,
        purged,
        assetsDeleted,
        failed: failures.length,
        auditExpired,
      },
    });
  } catch (error) {
    const status = routeErrorStatus(error);
    if (status) {
      return NextResponse.json(
        { ok: false, error: routeErrorMessage(error, 'Retention sweep failed') },
        { status },
      );
    }
    console.error('[Retention] sweep failed:', error);
    return NextResponse.json({ ok: false, error: 'Retention sweep failed' }, { status: 500 });
  }
}
