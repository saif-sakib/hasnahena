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
  | 'SETTINGS_UPDATED';

export type AuditEntityType =
  | 'USER'
  | 'LOAN'
  | 'TRANSACTION'
  | 'SETTINGS';

interface AuditLogParams {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  userId?: string;
  oldValue?: object;
  newValue?: object;
  details?: string;
}

/**
 * Creates an audit log entry for sensitive operations
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    const headersList = await headers();
    const userIp = headersList.get('x-forwarded-for')?.split(',')[0]?.trim()
      || headersList.get('x-real-ip')
      || 'unknown';
    const userAgent = headersList.get('user-agent') || undefined;

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

/**
 * Get client IP from request headers
 */
export function getClientIp(headersList: Headers): string {
  return headersList.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headersList.get('x-real-ip')
    || 'unknown';
}
