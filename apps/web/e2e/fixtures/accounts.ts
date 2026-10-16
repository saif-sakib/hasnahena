/**
 * Seeded accounts for the browser journeys: created idempotently in the
 * database with a fixed fake password, namespaced `e2e-`. Refuses a
 * non-disposable database (assertDisposableDatabase).
 */

import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { RESET_SCOPE_FIRST_LOGIN } from '../../lib/reset-tokens';

/** Obviously fake, and strong enough to pass the API's own policy check. */
export const E2E_PASSWORD = 'E2e-Test-Password-1234';

export type SeededRole = 'MEMBER' | 'WORKER' | 'ADMIN';

export const ACCOUNTS: Record<SeededRole, { id: string; phone: string; email: string; accountNo: string }> = {
  MEMBER: { id: 'e2e-member', phone: '01966600001', email: 'e2e-member@journeys.test', accountNo: 'E2E-M-0001' },
  WORKER: { id: 'e2e-worker', phone: '01966600002', email: 'e2e-worker@journeys.test', accountNo: 'E2E-W-0001' },
  ADMIN: { id: 'e2e-admin', phone: '01966600003', email: 'e2e-admin@journeys.test', accountNo: 'E2E-A-0001' },
};

let prisma: PrismaClient | null = null;
const db = (): PrismaClient => (prisma ??= new PrismaClient());

export async function disconnect(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/** Refuse anything that might hold real records. */
export function assertDisposableDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) throw new Error('DATABASE_URL is not set; run `eval "$(scripts/test-stack.sh env)"` first.');
  const host = url.replace(/^\w+:\/\/[^@]*@/, '').split('/')[0];
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (!local) {
    throw new Error(
      `refusing to seed ${host}: these specs write to the database, so they only run against localhost. ` +
        'Use scripts/test-stack.sh.',
    );
  }
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** The three accounts plus the member's account and balance; upserted, never truncated. */
export async function seedAccounts(openingBalance = 50_000): Promise<void> {
  assertDisposableDatabase();
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);

  // Clear first-login rows, or login diverts to the change-password step.
  await db().passwordResetToken.updateMany({
    where: {
      usedAt: null,
      scope: RESET_SCOPE_FIRST_LOGIN,
      OR: Object.values(ACCOUNTS).flatMap((a) => [{ email: a.email }, { phone: a.phone }]),
    },
    data: { usedAt: new Date() },
  });

  for (const role of Object.keys(ACCOUNTS) as SeededRole[]) {
    const account = ACCOUNTS[role];
    await db().user.upsert({
      where: { id: account.id },
      // The password is reset on every run: a spec that changes it must not
      // break the next run.
      update: { passwordHash, status: UserStatus.ACTIVE, role: UserRole[role] },
      create: {
        id: account.id,
        phone: account.phone,
        email: account.email,
        passwordHash,
        role: UserRole[role],
        status: UserStatus.ACTIVE,
        accountNo: account.accountNo,
        nameEn: `E2E ${role}`,
        nameBn: `ই২ই ${role}`,
        fatherName: 'Test Father',
        motherName: 'Test Mother',
      },
    });
  }

  // Keyed on the owner: `accounts.userId` is unique and there is no account
  // number any more (ADR-023).
  await db().account.upsert({
    where: { userId: ACCOUNTS.MEMBER.id },
    update: { savingsBalance: BigInt(openingBalance), loanBalance: BigInt(0) },
    create: {
      savingsBalance: BigInt(openingBalance),
      loanBalance: BigInt(0),
      userId: ACCOUNTS.MEMBER.id,
    },
  });
}

/** The member's current savings, for asserting a posting actually landed. */
export async function memberSavings(): Promise<bigint> {
  const account = await db().account.findUnique({
    where: { userId: ACCOUNTS.MEMBER.id },
    select: { savingsBalance: true },
  });
  return account?.savingsBalance ?? BigInt(0);
}

/** Remove the rows a spec created, leaving the seeded accounts in place. */
export async function clearMemberActivity(): Promise<void> {
  assertDisposableDatabase();
  await db().transaction.deleteMany({ where: { userId: ACCOUNTS.MEMBER.id } });
  await db().loan.deleteMany({ where: { borrowerId: ACCOUNTS.MEMBER.id } });
  await db().notification.deleteMany({ where: { targetUserId: ACCOUNTS.MEMBER.id } });
}
