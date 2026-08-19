import { prisma } from './prisma';
import { headers } from 'next/headers';

export type AuditAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | 'PASSWORD_RESET'
  | 'REGISTRATION_APPROVED'
  | 'REGISTRATION_REJECTED'
  | 'LOAN_APPROVED'
  | 'LOAN_REJECTED'
  | 'DEPOSIT_CONFIRMED'
  | 'WITHDRAWAL_APPROVED'
  | 'WITHDRAWAL_REJECTED'
  | 'USER_STATUS_CHANGED'
  | 'WORKER_CREATED'
  | 'WORKER_UPDATED'
  | 'SETTINGS_UPDATED'
  | 'TRANSACTION_DISPUTED'
  // WO-72. Branches became a managed entity when `users.assignedBranch` stopped
  // being a free string; closing an office reassigns staff, so it is audited.
  | 'BRANCH_CREATED'
  | 'BRANCH_UPDATED'
  | 'BRANCH_DEACTIVATED'
  | 'BRANCH_DELETED';

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
