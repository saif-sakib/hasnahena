import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

interface AuditLogInput {
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  userIp?: string;
  userAgent?: string;
}

function toNullableJsonInput(
  value: Prisma.InputJsonValue | null | undefined
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === null) return Prisma.JsonNull;
  return value;
}

export async function createAuditLog(input: AuditLogInput) {
  await prisma.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      userId: input.userId,
      oldValue: toNullableJsonInput(input.oldValue),
      newValue: toNullableJsonInput(input.newValue),
      userIp: input.userIp,
      userAgent: input.userAgent,
    },
  });
}

// Common action types
export const AuditActions = {
  // User actions
  USER_APPROVED: 'USER_APPROVED',
  USER_REJECTED: 'USER_REJECTED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_CREATED: 'USER_CREATED',

  // Loan actions
  LOAN_APPROVED: 'LOAN_APPROVED',
  LOAN_REJECTED: 'LOAN_REJECTED',
  LOAN_DISBURSED: 'LOAN_DISBURSED',
  LOAN_COMPLETED: 'LOAN_COMPLETED',

  // Transaction actions
  TRANSACTION_APPROVED: 'TRANSACTION_APPROVED',
  TRANSACTION_REJECTED: 'TRANSACTION_REJECTED',
  TRANSACTION_PROCESSED: 'TRANSACTION_PROCESSED',
  WITHDRAWAL_APPROVED: 'WITHDRAWAL_APPROVED',
  WITHDRAWAL_REJECTED: 'WITHDRAWAL_REJECTED',
  DEPOSIT_CONFIRMED: 'DEPOSIT_CONFIRMED',

  // Settings actions
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',

  // Auth actions
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
} as const;

export type AuditAction = typeof AuditActions[keyof typeof AuditActions];
