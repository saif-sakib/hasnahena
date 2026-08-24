#!/usr/bin/env node

// Creates the minimum a fresh database needs to be usable: one SUPER_ADMIN who
// can log in, and the system_config rows the loan rules read.
//
// Idempotent by design — running it twice is a no-op, never a second admin and
// never a password reset on an existing one. That matters because this is the
// script someone will reach for in a hurry, against a database they are not
// completely sure about.
//
// First run, on an empty database:
//
//   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm db:seed
//
// Every run after that, to pick up config keys added since:
//
//   pnpm db:seed
//
// The admin variables are only required when there is no admin yet. Once one
// exists the admin step is skipped and only system_config is ensured, because
// needing a password to add a settings row is how a routine re-seed turns into
// a reason to go looking for credentials.
//
// It refuses to invent a password. An admin account with a guessable default is
// how a cooperative's entire member ledger walks out the door.

import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { loadDatabaseEnv } from './lib/env.mjs';

// Only keys the application actually reads. Defaults match the fallbacks
// hardcoded in the Go repository (repositories/repository.go) and lib/documents/theme.ts
// — seeding them makes the effective policy visible in the admin settings page
// instead of invisible in two codebases.
const CONFIG_DEFAULTS = [
  {
    key: 'loan.minDepositForLoan',
    value: '8000',
    description: 'Minimum savings balance (taka) before a member may borrow',
  },
  {
    key: 'loan.maxLoanMultiplier',
    value: '5',
    description: 'Maximum loan as a multiple of the member savings balance',
  },
  {
    key: 'loan.maxInstallmentMonths',
    value: '24',
    description: 'Maximum number of monthly installments on a loan',
  },
  {
    key: 'loan.allowActiveLoanWithdrawal',
    value: 'false',
    description: 'Allow savings withdrawal while the member has an active loan',
  },
  {
    key: 'loan.guarantorThresholdAmount',
    value: '20000',
    description: 'Loans above this amount (taka) require a guarantor; 0 requires one always',
  },
  {
    // Days, and informational only (ADR-030). Seeded so the member savings
    // screen and the FAQ have a figure to publish; nothing in either backend
    // reads it, and no payout waits on it. 90 is the three months that the
    // enforced `loan.noticePeriodMonths` used to mean.
    key: 'loan.noticePeriodDays',
    value: '90',
    description: 'Days of notice a member is ASKED to give before withdrawing (not enforced)',
  },
  {
    key: 'support.chatRetentionDays',
    value: '10',
    description: 'Days a resolved support thread is kept before deletion',
  },
  { key: 'org.name', value: 'হাসনাহেনা ফাউন্ডেশন', description: 'Organisation name (Bengali)' },
  { key: 'org.nameEn', value: 'Hasnahena Foundation', description: 'Organisation name (English)' },
  {
    key: 'org.address',
    value: 'Bhekutia, Sadar, Jashore, Bangladesh',
    description: 'Address printed on generated documents',
  },
  { key: 'org.phone', value: '+880 1712-345678', description: 'Public contact phone' },
  { key: 'org.email', value: 'info@hasnahenafoundation.com', description: 'Public contact email' },
  { key: 'org.website', value: 'hasnahenafoundation.com', description: 'Public website' },

  // Bank transfer details for /donate (WO-67).
  //
  // Seeded EMPTY on purpose, unlike every other row here. The page hides its
  // bank card entirely while the account number is blank, because the thing
  // being replaced was a hardcoded placeholder — `2050 0000 0000 0000` — that a
  // donor could read as real and send money to. A visible gap is recoverable;
  // a plausible wrong account number is not.
  //
  // The admin fills these in on Settings → Organisation. Until then the card
  // does not render, which is the intended state and not a defect.
  { key: 'bank.name', value: '', description: 'Bank name shown on /donate — empty hides the bank card' },
  { key: 'bank.accountName', value: '', description: 'Bank account holder name shown on /donate' },
  { key: 'bank.accountNo', value: '', description: 'Bank account number shown on /donate — empty hides the bank card' },
  { key: 'bank.branch', value: '', description: 'Bank branch shown on /donate' },
];

function requiredEnv(name, hint) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. ${hint}`);
  }
  return value;
}

async function seedAdmin(prisma) {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const phone = process.env.SEED_ADMIN_PHONE?.trim() || '01700000000';

  // No credentials supplied. That is the ordinary case for re-running the seed
  // on a working database to pick up newly added config keys, and it used to
  // fail before reaching seedConfig at all — demanding an admin email to write
  // a settings row, on a database whose admin has existed for months.
  //
  // Skipping is only safe when an admin already exists. On a genuinely fresh
  // database, silently seeding config and no admin would leave something that
  // looks seeded and cannot be logged into, so that still fails loudly.
  if (!email) {
    // "An admin exists" has to mean an admin somebody can log in as, not merely
    // a row with an admin role. The donation pool's owner is exactly such a row
    // — role ADMIN so it can hold an account, INACTIVE with a password hash
    // bcrypt can never match, by design — and it satisfied this check. Once the
    // pool existed, re-running the seed on a database whose real admin had been
    // removed printed "admin: skipped" and exited 0, leaving the thing the
    // comment above promises cannot happen: seeded, and impossible to log into.
    //
    // Both conditions, deliberately. ACTIVE is the property that matters;
    // naming the system id as well keeps the intent legible if a future system
    // account is created ACTIVE for some other reason.
    const anyAdmin = await prisma.user.findFirst({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        status: UserStatus.ACTIVE,
        id: { not: DONATION_OWNER_ID },
      },
      select: { id: true, email: true, phone: true },
    });

    if (!anyAdmin) {
      throw new Error(
        'SEED_ADMIN_EMAIL is not set and this database has no admin account.\n'
          + '  To create the first admin:\n'
          + '    SEED_ADMIN_EMAIL=admin@hasnahena.local SEED_ADMIN_PASSWORD=<12+ chars> pnpm db:seed'
      );
    }

    console.log(
      `admin: skipped — SEED_ADMIN_EMAIL not set and ${anyAdmin.email ?? anyAdmin.phone} already exists`
    );
    return anyAdmin.id;
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
    select: { id: true, email: true, phone: true, role: true },
  });

  if (existing) {
    // Never touch an account that already exists. Re-running the seed must not
    // be a way to reset a forgotten admin password.
    console.log(`admin: already present (${existing.email ?? existing.phone}) — left unchanged`);
    return existing.id;
  }

  const password = requiredEnv(
    'SEED_ADMIN_PASSWORD',
    'Choose one; this script will not invent a default.'
  );
  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
  }

  // The rest of the codebase hashes at cost 10; this one account gets 12. The
  // cost is encoded in the hash itself, so Go's CompareHashAndPassword reads it
  // back without knowing or caring — and this is the account that owns every
  // member's savings record.
  const passwordHash = await bcrypt.hash(password, 12);

  const created = await prisma.user.create({
    data: {
      email,
      phone,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      nameEn: process.env.SEED_ADMIN_NAME?.trim() || 'System Administrator',
      fatherName: 'N/A',
      motherName: 'N/A',
      approvedAt: new Date(),
    },
    select: { id: true },
  });

  console.log(`admin: created SUPER_ADMIN ${email} (phone ${phone})`);
  return created.id;
}

async function seedConfig(prisma) {
  let created = 0;
  for (const { key, value, description } of CONFIG_DEFAULTS) {
    const result = await prisma.systemConfig.upsert({
      where: { key },
      // An operator who changed a value in the admin UI outranks this file.
      // Only the description is refreshed, since that is documentation.
      update: { description },
      create: { key, value, description },
      select: { value: true },
    });
    if (result.value === value) {
      created += 1;
    }
  }
  console.log(`config: ${CONFIG_DEFAULTS.length} keys ensured (${created} at default values)`);
}

// The donation pool is a real account in the ledger, not a computed total:
// RecordDonation locks the account owned by DONATION_OWNER_ID and credits it,
// so without this row every attempt to record a donation failed
// with a 500 and the message "Failed to record donation". Nothing in the schema,
// the migrations or the application ever created it — only a test did — so it
// would have been missing on the day the foundation recorded its first
// donation (found by TEST-18, 2026-08-17).
//
// It is owned by a placeholder user because `accounts.userId` is NOT NULL. That
// user must never be able to log in: `passwordHash` is a string bcrypt can
// never produce a match for, and the status is INACTIVE, so the auth gate
// refuses it even if someone later sets a password.
// The pool is identified by its owner, not by an account number: there is no
// account number any more (ADR-023), and `accounts.userId` is unique, so this
// id names exactly one row — which matters because the Go side takes
// FOR UPDATE on it. Keep it in step with DonationFundUserID in
// apps/api/internal/repositories/transaction_repository.go.
const DONATION_OWNER_ID = 'system_donation_fund';

async function seedDonationPool(prisma) {
  const existing = await prisma.account.findUnique({
    where: { userId: DONATION_OWNER_ID },
    select: { id: true },
  });
  if (existing) {
    console.log('donation pool: already present — left unchanged');
    return;
  }

  await prisma.user.upsert({
    where: { id: DONATION_OWNER_ID },
    update: {},
    create: {
      id: DONATION_OWNER_ID,
      phone: '00000000000',
      email: 'donation-fund@system.invalid',
      // Not a hash of anything. bcrypt.compare against this always returns
      // false, so the account cannot be logged into even by accident.
      passwordHash: 'x-not-a-valid-bcrypt-hash-login-impossible',
      role: UserRole.ADMIN,
      status: UserStatus.INACTIVE,
      nameEn: 'Donation Fund',
      nameBn: 'দাতব্য তহবিল',
      fatherName: '-',
      motherName: '-',
    },
  });

  await prisma.account.create({
    data: {
      savingsBalance: BigInt(0),
      loanBalance: BigInt(0),
      isLoanEligible: false,
      maxLoanAmount: BigInt(0),
      userId: DONATION_OWNER_ID,
    },
  });
  console.log(`donation pool: created, owned by ${DONATION_OWNER_ID}`);
}

/**
 * The foundation's own office (WO-72).
 *
 * `branches` existed from the first migration and nothing ever wrote a row to
 * it, while `users.assignedBranch` held a free-text office name with no link
 * back — so there was a table modelling branches and a string modelling
 * branches, and neither knew about the other.
 *
 * The code `KH` matches the prefix inside `utils.MemberIDPrefix`
 * ("ACC-KH-33"). They are **not** connected in code and deliberately so: member
 * IDs are read aloud and written into paper passbooks, so their format is fixed
 * (ADR-008) rather than derived from whatever rows happen to be in this table.
 * The match is a convention for humans reading both.
 *
 * Idempotent on `code`, so re-seeding never creates a second Bhekutia and never
 * overwrites an address an admin has corrected.
 */
async function seedBranches(prisma) {
  const existing = await prisma.branch.findUnique({ where: { code: 'KH' }, select: { id: true } });
  if (existing) {
    console.log('branches: already present, leaving alone');
    return;
  }
  const branch = await prisma.branch.create({
    data: {
      name: 'Bhekutia',
      code: 'KH',
      address: 'Bhekutia, Sadar, Jashore, Bangladesh',
      isActive: true,
    },
    select: { id: true, name: true, code: true },
  });
  console.log(`branches: created ${branch.name} (${branch.code})`);
}

async function main() {
  loadDatabaseEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Set it in the shell or in .env.local.');
  }

  const prisma = new PrismaClient();
  try {
    await seedAdmin(prisma);
    await seedConfig(prisma);
    await seedDonationPool(prisma);
    await seedBranches(prisma);
    console.log('seed complete');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`seed failed: ${error.message}`);
  process.exit(1);
});
