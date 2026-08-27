import { prisma } from './prisma';
import { headers } from 'next/headers';

/**
 * The vocabulary lives in `lib/audit-actions.ts`, with both backends' actions in
 * it and a census that keeps it honest.
 *
 * What was here before was a hand-written union that had drifted into describing
 * a different system: it named `REGISTRATION_APPROVED`, `LOAN_APPROVED`,
 * `DEPOSIT_CONFIRMED`, `WITHDRAWAL_APPROVED` and `SETTINGS_UPDATED` — none of
 * which anything writes — and was missing every action the Go API does write. It
 * compiled because the only thing it constrained was the ten call sites in this
 * app, and nothing read the table.
 */
export type { AuditAction } from './audit-actions';
import type { AuditAction } from './audit-actions';

export type AuditEntityType =
  | 'USER'
  | 'LOAN'
  | 'TRANSACTION'
  | 'SETTINGS'
  | 'BRANCH';

interface AuditLogParams {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  userId?: string;
  oldValue?: object;
  newValue?: object;
  details?: string;
  /**
   * The request being handled, when the caller has it.
   *
   * `headers()` throws outside a request scope, and it used to throw *before*
   * the insert — so any context where it is unavailable lost the audit row
   * entirely rather than losing the caller's address. Passing the request
   * avoids the lookup; failing the lookup no longer costs the row.
   */
  request?: Request;
}

/** Where the caller appears to be, or `unknown`. Never throws. */
async function callerOrigin(request?: Request): Promise<{ userIp: string; userAgent?: string }> {
  const source = request?.headers ?? (await headers().catch(() => null));
  if (!source) return { userIp: 'unknown' };
  const userIp =
    source.get('x-forwarded-for')?.split(',')[0]?.trim() || source.get('x-real-ip') || 'unknown';
  return { userIp, userAgent: source.get('user-agent') || undefined };
}

/**
 * Creates an audit log entry for sensitive operations
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    const { userIp, userAgent } = await callerOrigin(params.request);

    await prisma.auditLog.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        userId: params.userId,
        userIp,
        userAgent,
        oldValue: params.oldValue ?? undefined,
        newValue: params.newValue ?? undefined,
        details: params.details,
      },
    });
  } catch (error) {
    // Audit logging should not fail the main operation
    console.error('Failed to create audit log:', error);
  }
}
