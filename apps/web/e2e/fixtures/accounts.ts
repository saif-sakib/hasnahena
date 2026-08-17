/**
 * Seeded accounts for the browser journeys (TEST-26 … TEST-30).
 *
 * Playwright specs run in Node, so they can reach the database directly rather
 * than driving the whole sign-up-and-approve flow before every test. That
 * matters twice over: the journeys under test start *after* approval, and a spec
 * that depends on another spec having run first fails on execution order.
 *
 * Every account is created here, idempotently, with a password this file knows.
 * Real credentials never appear: the password is fixed, obviously fake, and the
 * accounts are namespaced `e2e-` so they cannot be confused with member data.
 *
 * Guarded against pointing at anything real — see assertDisposableDatabase.
 */

import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';

/** Obviously fake, and strong enough to pass the API's own policy check. */
export const E2E_PASSWORD = 'E2e-Test-Password-1234';

export type SeededRole = 'MEMBER' | 'WORKER' | 'ADMIN';

export const ACCOUNTS: Record<SeededRole, { id: string; phone: string; email: string; memberId: string }> = {
  MEMBER: { id: 'e2e-member', phone: '01966600001', email: 'e2e-member@journeys.test', memberId: 'E2E-M-0001' },
  WORKER: { id: 'e2e-worker', phone: '01966600002', email: 'e2e-worker@journeys.test', memberId: 'E2E-W-0001' },
  ADMIN: { id: 'e2e-admin', phone: '01966600003', email: 'e2e-admin@journeys.test', memberId: 'E2E-A-0001' },
};

let prisma: PrismaClient | null = null;
const db = (): PrismaClient => (prisma ??= new PrismaClient());

export async function disconnect(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/**
 * Refuse to run against anything that might hold real records.
 *
 * These specs create users and move balances. A `DATABASE_URL` pointing at Neon
 * would do that to the cooperative's own ledger, and the mistake is one
 * copied-and-pasted environment variable away.
 */
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

/**
 * Create the three accounts, plus an account row and an opening balance for the
 * member so the money journeys have something to work with.
 *
 * Upserted rather than truncated: the Go suites share this database and clearing
 * it out from under them is how a suite starts failing on ordering.
 */
export async function seedAccounts(openingBalance = 50_000): Promise<void> {
  assertDisposableDatabase();
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);

  // `mustChangePassword` is not a column — the API derives it from an unused
  // `first-login-` row in password_reset_tokens. Clearing those is what stops
  // the login form diverting these accounts to the change-password step.
  await db().passwordResetToken.updateMany({
    where: {
      usedAt: null,
      token: { startsWith: 'first-login-' },
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
        memberId: account.memberId,
        nameEn: `E2E ${role}`,
        nameBn: `ই২ই ${role}`,
        fatherName: 'Test Father',
        motherName: 'Test Mother',
      },
    });
  }

  await db().account.upsert({
    where: { accountNumber: ACCOUNTS.MEMBER.memberId },
    update: { savingsBalance: BigInt(openingBalance), loanBalance: BigInt(0) },
    create: {
      accountNumber: ACCOUNTS.MEMBER.memberId,
      savingsBalance: BigInt(openingBalance),
      loanBalance: BigInt(0),
      isLoanEligible: true,
      maxLoanAmount: BigInt(0),
      userId: ACCOUNTS.MEMBER.id,
    },
  });
}

/** The member's current savings, for asserting a posting actually landed. */
export async function memberSavings(): Promise<bigint> {
  const account = await db().account.findUnique({
    where: { accountNumber: ACCOUNTS.MEMBER.memberId },
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
