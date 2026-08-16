#!/usr/bin/env node

// Creates the minimum a fresh database needs to be usable: one SUPER_ADMIN who
// can log in, and the system_config rows the loan rules read.
//
// Idempotent by design — running it twice is a no-op, never a second admin and
// never a password reset on an existing one. That matters because this is the
// script someone will reach for in a hurry, against a database they are not
// completely sure about.
//
//   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm db:seed
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
];

function requiredEnv(name, hint) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. ${hint}`);
  }
  return value;
}

async function seedAdmin(prisma) {
  const email = requiredEnv('SEED_ADMIN_EMAIL', 'Example: SEED_ADMIN_EMAIL=admin@hasnahena.local');
  const phone = process.env.SEED_ADMIN_PHONE?.trim() || '01700000000';

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

async function main() {
  loadDatabaseEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Set it in the shell or in .env.local.');
  }

  const prisma = new PrismaClient();
  try {
    await seedAdmin(prisma);
    await seedConfig(prisma);
    console.log('seed complete');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`seed failed: ${error.message}`);
  process.exit(1);
});
