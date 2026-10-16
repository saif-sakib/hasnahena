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
import { fileApplicationDocuments, purgeApplicationDocuments } from '@/lib/application-documents';
import { routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';

/**
 * The Cloudinary half of retention (ADR-038). Two callers: the approvals
 * screen right after a refusal (POST {userId}), and the nightly Vercel Cron
 * (GET, CRON_SECRET) as the backstop. An empty sweep reports `{ purged: 0 }`.
 */

/**
 * Delete audit rows whose tier has expired (most are permanent, ADR-038; the
 * tier lives in lib/audit-actions.ts). audit_logs refuses DELETE; the opt-in is
 * SET LOCAL, scoped to this transaction.
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

/**
 * Admitted members whose documents are still under applications/ — backstop
 * for an approval whose refile call never arrived. Matched on the URL, which
 * is the fact.
 */
async function admittedMembersWithUnfiledDocuments(limit: number) {
  return prisma.user.findMany({
    where: {
      accountNo: { not: null },
      documents: { some: { url: { contains: '/applications/' } } },
    },
    select: { id: true, accountNo: true },
    take: limit,
  });
}

function cronAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means nobody is accepted.
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

/**
 * The nightly sweep. Vercel Cron only sends GET (with Bearer CRON_SECRET); a
 * POST-only route would 405 every night. Takes no parameters.
 */
export async function GET(req: Request) {
  if (cronAuthorised(req)) return runSweep(req, null);

  // Not the scheduler: 401/403 like every guarded route. NO role reaches GET —
  // admin actions go through POST, which is audited.
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
      // The scheduler may not target one person.
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

/** The work; `caller` is null for the scheduled pass. */
async function runSweep(
  req: Request,
  caller: { actorId: string; userId: string } | null,
): Promise<NextResponse> {
  const actorId = caller?.actorId ?? null;
  const userId = caller?.userId ?? '';
  try {
    const targets = userId
      ? await prisma.user.findMany({
          // Filtered: never a live member's documents.
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

      // One audit row per application — the proof a national ID was deleted.
      // Names the application number and counts only.
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

    // Scheduled pass only: the refile backstop.
    let filed = 0;
    if (!userId) {
      for (const member of await admittedMembersWithUnfiledDocuments(50)) {
        const outcome = await fileApplicationDocuments(member.id);
        filed += outcome.moved;
      }
    }

    // Scheduled pass only: audit expiry is the policy running.
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
        filed,
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
