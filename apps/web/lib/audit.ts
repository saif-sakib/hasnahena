import { prisma } from './prisma';
import { headers } from 'next/headers';

/** The vocabulary lives in lib/audit-actions.ts. */
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
   * The request being handled, if available — avoids headers(), which throws
   * outside a request scope.
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

/** Create an audit log entry for a sensitive operation. */
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
