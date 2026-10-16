#!/usr/bin/env node

// The minimum a fresh database needs: one SUPER_ADMIN and the system_config
// defaults. Idempotent — never a second admin, never a password reset. It
// refuses to invent a password.
//
//   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm db:seed   # first run
//   pnpm db:seed                                                # later: new config keys

import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { loadDatabaseEnv } from './lib/env.mjs';
import { runAsScript } from './lib/guard.mjs';
import { allocateStaffNo } from './lib/account-no.mjs';

// Only keys the application reads; defaults match the code's own fallbacks.
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
    // Days, informational only (ADR-030).
    key: 'loan.noticePeriodDays',
    value: '90',
    description: 'Days of notice a member is ASKED to give before withdrawing (not enforced)',
  },
  {
    key: 'support.chatRetentionDays',
    value: '10',
    description: 'Days a resolved support thread is kept before deletion',
  },
  {
    // ADR-033: identity data of a rejected application is cleared after a year.
    key: 'security.rejectedRetentionDays',
    value: '365',
    description: "Days a rejected application keeps its identity data before the sweep clears it",
  },

  // Membership age floor (T-07): 18, the age of majority in Bangladesh.
  {
    key: 'membership.minimumAgeYears',
    value: '18',
    description: 'Minimum age in whole years to register as a member',
  },
  { key: 'org.name', value: 'হাসনাহেনা ফাউন্ডেশন', description: 'Organisation name (Bengali)' },
  { key: 'org.nameEn', value: 'Hasnahena Foundation', description: 'Organisation name (English)' },
  // Two addresses (Bengali + English), like the two names.
  {
    key: 'org.address',
    value: 'ভেকুটিয়া, সদর, যশোর',
    description: 'Office address (Bengali) — shown on the Bengali site',
  },
  {
    key: 'org.addressEn',
    value: 'Bhekutia, Sadar, Jashore, Bangladesh',
    description: 'Office address (English) — the English site and every generated document',
  },
  { key: 'org.phone', value: '+880 1712-345678', description: 'Public contact phone' },
  { key: 'org.email', value: 'info@hasnahenafoundation.com', description: 'Public contact email' },
  { key: 'org.website', value: 'hasnahenafoundation.com', description: 'Public website' },

  // Two descriptions; the English one feeds the JSON-LD.
  {
    key: 'org.description',
    value: 'একটি কর্দ আল-হাসান (সুদমুক্ত ইসলামী অর্থায়ন) সমবায় সংস্থা',
    description: 'One-line description (Bengali)',
  },
  {
    key: 'org.descriptionEn',
    value: 'An interest-free (Qard al-Hasan) cooperative finance society in Jashore, Bangladesh.',
    description: 'One-line description (English) — the JSON-LD every search engine reads',
  },

  // Bank details for /donate (WO-67), seeded EMPTY: the card hides until filled,
  // since a plausible wrong account number is unrecoverable.
  { key: 'bank.name', value: '', description: 'Bank name shown on /donate — empty hides the bank card' },
  { key: 'bank.accountName', value: '', description: 'Bank account holder name shown on /donate' },
  { key: 'bank.accountNo', value: '', description: 'Bank account number shown on /donate — empty hides the bank card' },
  { key: 'bank.branch', value: '', description: 'Bank branch shown on /donate' },

  // ---------------------------------------------------------------------
  // The public site's copy, seeded so Content & Media shows what visitors see.
  // Every row is a PAIR (bare key Bengali, `…En` English) — seed both halves.
  { key: 'hero.tagline', value: 'ইসলামী শরীয়াহ সম্মত', description: 'Hero badge (Bengali)' },
  { key: 'hero.taglineEn', value: 'Shariah Compliant Finance', description: 'Hero badge (English)' },

  { key: 'features.title', value: 'কেন হাসনাহেনা', description: 'Features section heading (Bengali)' },
  { key: 'features.titleEn', value: 'Why Hasnahena', description: 'Features section heading (English)' },

  { key: 'contact.title', value: 'যোগাযোগ করুন', description: 'Contact section heading (Bengali)' },
  { key: 'contact.titleEn', value: 'Get in Touch', description: 'Contact section heading (English)' },

  { key: 'navigation.donate', value: 'দান করুন', description: 'Donate menu label (Bengali)' },
  { key: 'navigation.donateEn', value: 'Donate', description: 'Donate menu label (English)' },

  { key: 'auth.welcomeBack', value: 'আবার স্বাগতম', description: 'Login greeting (Bengali)' },
  { key: 'auth.welcomeBackEn', value: 'Welcome back', description: 'Login greeting (English)' },

  {
    key: 'donation.title',
    value: 'আপনার অনুদান বদলে দিতে পারে একটি জীবন',
    description: 'Donate section heading (Bengali)',
  },
  {
    key: 'donation.titleEn',
    value: 'Your Donation Can Change a Life',
    description: 'Donate section heading (English)',
  },
  {
    key: 'donation.subtitle',
    value: 'নিচের যেকোনো মাধ্যমে অনুদান পাঠাতে পারেন। প্রতিটি টাকা পৌঁছে যাবে প্রকৃত অভাবীদের কাছে।',
    description: 'Donate section subheading (Bengali)',
  },
  {
    key: 'donation.subtitleEn',
    value: 'Give through any of the channels below. Every taka reaches the people who need it.',
    description: 'Donate section subheading (English)',
  },
  {
    key: 'donation.referenceNote',
    value:
      'অনুদান পাঠানোর পর অনুগ্রহ করে রেফারেন্সে আপনার নাম ও মোবাইল নম্বর লিখুন, অথবা আমাদের ফোন করে জানান — তাহলে আমরা আপনার অনুদানের রসিদ পাঠাতে পারব।',
    description: 'Donate reference note (Bengali)',
  },
  {
    key: 'donation.referenceNoteEn',
    value:
      'After sending a donation, please put your name and mobile number in the reference, or call us — that is how we can send you a receipt.',
    description: 'Donate reference note (English)',
  },

  // The four hero figures: the foundation's STATED values, never the ledger
  // (owner's ruling). Starting estimates for the foundation to correct. Lakh
  // notation so they do not wrap on a phone; a pair per figure.
  { key: 'stats.members', value: '১৩৫+', description: 'Members figure (Bengali)' },
  { key: 'stats.membersEn', value: '135+', description: 'Members figure (English)' },
  { key: 'stats.deposits', value: '৳২৫ লক্ষ+', description: 'Total deposits figure (Bengali)' },
  { key: 'stats.depositsEn', value: '৳25 Lakh+', description: 'Total deposits figure (English)' },
  { key: 'stats.loans', value: '৳১৮ লক্ষ+', description: 'Loans-distributed figure (Bengali)' },
  { key: 'stats.loansEn', value: '৳18 Lakh+', description: 'Loans-distributed figure (English)' },
  { key: 'stats.charity', value: '৳৩.৫ লক্ষ+', description: 'Charitable-fund figure (Bengali)' },
  { key: 'stats.charityEn', value: '৳3.5 Lakh+', description: 'Charitable-fund figure (English)' },
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

  // No credentials: fine for a re-seed when a loginable admin exists; on a
  // fresh database it fails loudly rather than seed something nobody can log into.
  if (!email) {
    // ACTIVE and not the donation pool's owner (an INACTIVE ADMIN-role row).
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

  // Cost 12 for this account (the rest use 10); bcrypt stores the cost in the hash.
  const passwordHash = await bcrypt.hash(password, 12);

  // A staff number from the STF series — and the row id (ADR-043).
  const created = await prisma.$transaction(async (tx) => {
    const accountNo = await allocateStaffNo(tx);
    return tx.user.create({
      data: {
        id: accountNo,
        accountNo,
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
  });

  console.log(`admin: created SUPER_ADMIN ${email} (phone ${phone})`);
  return created.id;
}

/**
 * Ensure every default exists and FILL IN BLANKS: an admin's edit wins, but an
 * empty row (Content & Media saves every field) is the absence of an edit and
 * is backfilled. Rows seeded empty have empty defaults, so they stay empty.
 * Caveat: a box cleared on purpose is refilled by the next seed.
 */
async function seedConfig(prisma) {
  let atDefault = 0;
  let backfilled = 0;
  for (const { key, value, description } of CONFIG_DEFAULTS) {
    const existing = await prisma.systemConfig.findUnique({
      where: { key },
      select: { value: true },
    });

    if (!existing) {
      await prisma.systemConfig.create({ data: { key, value, description } });
      atDefault += 1;
      continue;
    }

    const isBlank = existing.value.trim() === '';
    const fillable = isBlank && value !== '';
    await prisma.systemConfig.update({
      where: { key },
      // The description is documentation and is always refreshed.
      data: fillable ? { value, description } : { description },
    });

    if (fillable) backfilled += 1;
    if (fillable || existing.value === value) atDefault += 1;
  }
  console.log(
    `config: ${CONFIG_DEFAULTS.length} keys ensured (${atDefault} at default values` +
      `${backfilled > 0 ? `, ${backfilled} blank rows backfilled` : ''})`,
  );
}

// The donation pool: a real account RecordDonation locks and credits. Its owner
// can never log in (unmatchable hash, INACTIVE). Identified by owner id
// (accounts.userId is unique) — keep equal to DonationFundUserID in
// transaction_repository.go.
const DONATION_OWNER_ID = 'system_donation_fund';

async function seedDonationPool(prisma) {
  const existing = await prisma.account.findUnique({
    where: { userId: DONATION_OWNER_ID },
    select: { userId: true },
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
      userId: DONATION_OWNER_ID,
    },
  });
  console.log(`donation pool: created, owned by ${DONATION_OWNER_ID}`);
}

/**
 * The foundation's own office (WO-72). Code `KH` matches the ACC-KH prefix by
 * convention only (ADR-008). Idempotent on the code, never overwriting edits.
 */
async function seedBranches(prisma) {
  const existing = await prisma.branch.findUnique({ where: { id: 'KH' }, select: { id: true } });
  if (existing) {
    console.log('branches: already present, leaving alone');
    return;
  }
  const branch = await prisma.branch.create({
    data: {
      // The code IS the key now, so it is written here rather than generated.
      id: 'KH',
      name: 'Bhekutia',
      address: 'Bhekutia, Sadar, Jashore, Bangladesh',
      isActive: true,
    },
    select: { id: true, name: true },
  });
  console.log(`branches: created ${branch.name} (${branch.id})`);
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

runAsScript(import.meta.url, main, { label: 'seed' });
