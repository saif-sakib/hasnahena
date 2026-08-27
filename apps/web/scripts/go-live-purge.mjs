#!/usr/bin/env node
//
// The cutover purge: everything the foundation tested with, gone; everything it
// configured, kept.
//
//   node scripts/go-live-purge.mjs            # dry run — prints what it would do
//   node scripts/go-live-purge.mjs --confirm  # does it
//
// This is `pnpm db:clear` taken one step further, and it exists as its own file
// rather than as a flag on that one because the two answer different questions.
// `db:clear` resets a *development* environment and keeps whichever admin it
// finds. This runs **once**, against the database that is about to hold real
// members' savings, and it names the accounts that survive rather than
// discovering them.
//
// WHAT SURVIVES, and why each one
// -------------------------------
//   system_config    every setting an admin has typed: the organisation's name
//                    and address in both scripts, the loan policy, the donation
//                    channels, the landing-page copy. Re-entering these by hand
//                    is how a wrong bKash number gets published.
//   gallery_items    the photographs, and the Cloudinary assets behind them.
//   the two admins   named below. Their rows are *reused* rather than recreated,
//                    so nothing that references them by id has to be rewritten.
//   branches         the foundation's offices. These are **configuration**, not
//                    test data: Vekutia is the base branch, it is named on every
//                    worker assigned to it, and re-creating one by hand after
//                    every clear is exactly the kind of step that gets skipped
//                    once and then debugged for an hour. Workers are deleted, so
//                    the `assignedBranchId` foreign key is left with nothing
//                    pointing at it — which is the correct state for a branch
//                    with no staff yet, and is what the admin Branches screen
//                    shows as "0 staff".
//   the donation pool
//                    `system_donation_fund` and its account. This is
//                    infrastructure, not an account: its password hash is a
//                    string bcrypt can never match, so nobody can sign in as it,
//                    and `RecordDonation` locks that exact row — a database
//                    without it cannot record a donation at all, and fails with
//                    an opaque 500 rather than anything naming the cause. See
//                    ADR on the donation pool owner and
//                    test/unit/donation-pool-owner.test.ts, which pins the id.
//
// WHAT GOES
// ---------
// Every other user — members, workers, the `*.test` fixtures — and with them
// every account, transaction, loan, document, address, nominee, notification,
// support thread, audit row, reset token, blacklist entry and rate-limit
// bucket.
//
// `document_sequences` is reset to nothing, so the first real receipt is
// DEP-2026-000001. Reference numbers are printed on what a member is handed;
// starting at 000247 because of testing is harmless and unexplainable.
//
// THE PASSWORDS
// -------------
// Generated here, printed once, and never stored anywhere this script can read
// back. Each admin also gets a `first-login` marker, which is the platform's own
// forced-password-change mechanism (see FindByIdentifier's mustChangePassword) —
// so the password below gets them in, and the application makes them replace it
// before they can do anything else. That matters because a password that has
// travelled through a chat log is a password somebody else has seen.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { loadDatabaseEnv, redactUrl } from './lib/env.mjs';

/**
 * The accounts this foundation is launching with.
 *
 * Named here rather than discovered, which is the whole difference between this
 * script and `pnpm db:clear`: that one keeps whichever admin it happens to find,
 * and on a database that has been tested against, "whichever it finds" can be a
 * fixture nobody remembers creating.
 *
 * Override for a different environment with a comma-separated list:
 *
 *   PURGE_KEEP_ADMINS=a@x.com,b@x.com pnpm db:purge
 */
const DEFAULT_ADMINS = ['ashiqhmm1@gmail.com', 'saifahmedsakib@gmail.com'];

const ADMINS = (process.env.PURGE_KEEP_ADMINS?.trim()
  ? process.env.PURGE_KEEP_ADMINS.split(',')
  : DEFAULT_ADMINS
)
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean)
  .map((email) => ({ email }));

// Kept in step with scripts/seed.mjs and scripts/db-clear-preserve-core.mjs,
// which both name the same id. donation-pool-owner.test.ts fails if they drift.
const DONATION_OWNER_ID = 'system_donation_fund';

/** Scope of the marker whose existence *is* `mustChangePassword`. */
const FIRST_LOGIN_SCOPE = 'first-login';

const TABLES = [
  'users',
  'addresses',
  'nominees',
  'documents',
  'accounts',
  'transactions',
  'loans',
  'branches',
  'system_config',
  'gallery_items',
  'audit_logs',
  'support_threads',
  'support_messages',
  'notifications',
  'password_reset_tokens',
  'token_blacklist',
  'rate_limits',
  'sse_tickets',
  'document_sequences',
];

async function counts(prisma) {
  const out = {};
  for (const table of TABLES) {
    const [row] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "${table}"`);
    out[table] = row.c;
  }
  const [members] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS c FROM users WHERE role = 'MEMBER'`,
  );
  out['users (MEMBER)'] = members.c;
  return out;
}

/**
 * A password somebody has to read off a screen and type into a phone.
 *
 * No `l`, `1`, `I`, `O` or `0`: this is going to be read aloud or copied off
 * paper at least once, and a character pair nobody can tell apart turns a
 * forgotten password into a support call. 20 characters from a 56-character
 * alphabet is ~116 bits, which is far past anything the alphabet costs us.
 *
 * `randomInt` and not `% alphabet.length` over a random byte — the modulo is
 * biased, which is the same defect internal/utils/random_test.go exists to keep
 * out of the Go side.
 */
function generatePassword(length = 20) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

/** The reset-token contract: the row stores sha256(secret), never the secret. */
function hashResetSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

async function main() {
  loadDatabaseEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Set it in the shell or in .env.local.');
  }

  const confirmed = process.argv.includes('--confirm');
  console.log(`database: ${redactUrl(process.env.DATABASE_URL)}`);
  console.log(confirmed ? 'mode:     CONFIRMED — this will delete data\n' : 'mode:     dry run (pass --confirm to apply)\n');

  const prisma = new PrismaClient();
  try {
    const before = await counts(prisma);

    const survivors = await prisma.user.findMany({
      where: { email: { in: ADMINS.map((a) => a.email) } },
      select: { id: true, email: true, role: true, status: true },
    });
    const byEmail = new Map(survivors.map((u) => [u.email, u]));

    console.log('admin accounts:');
    for (const admin of ADMINS) {
      const found = byEmail.get(admin.email);
      console.log(
        found
          ? `  ${admin.email} — exists (${found.role}/${found.status}), row reused, password reset`
          : `  ${admin.email} — not found, will be created as SUPER_ADMIN/ACTIVE`,
      );
    }
    console.log('');

    if (!confirmed) {
      console.log('would delete (before -> after):');
      for (const [table, n] of Object.entries(before)) {
        const kept =
          table === 'system_config' || table === 'gallery_items' || table === 'branches'
            ? n
            : table === 'users'
              ? ADMINS.length + 1
              : table === 'accounts'
                ? 1
                : 0;
        console.log(`  ${table}: ${n} -> ${kept}`);
      }
      console.log('\nNothing was changed. Re-run with --confirm to apply.');
      return;
    }

    // Passwords are generated before the transaction so a bcrypt hash — which
    // takes ~200ms each at cost 12 — is never computed while holding locks.
    const credentials = ADMINS.map((admin) => ({
      ...admin,
      password: generatePassword(),
      firstLoginSecret: crypto.randomBytes(32).toString('hex'),
    }));
    for (const c of credentials) {
      c.passwordHash = await bcrypt.hash(c.password, 12);
    }

    const keptIds = [];

    await prisma.$transaction(
      async (tx) => {
        // DATA-08: audit_logs carries a BEFORE UPDATE OR DELETE trigger that
        // rejects every delete unless a transaction opts in. This is one of the
        // two legitimate callers — the cutover, before a single real audit row
        // exists. SET LOCAL scopes the permission to this transaction and this
        // connection, so it cannot leak to an application query running on a
        // neighbouring pooled connection.
        await tx.$executeRawUnsafe("SET LOCAL hasnahena.allow_audit_purge = 'on'");

        // Ensure both admins exist, and collect the ids that survive. Done
        // FIRST so the delete below can be expressed as "everything else".
        for (const c of credentials) {
          const existing = await tx.user.findFirst({
            where: { email: c.email },
            select: { id: true, phone: true },
          });

          if (existing) {
            await tx.user.update({
              where: { id: existing.id },
              data: {
                passwordHash: c.passwordHash,
                role: UserRole.SUPER_ADMIN,
                status: UserStatus.ACTIVE,
                // Self-referential: an admin approved by a member who is about
                // to be deleted would fail the foreign key.
                approvedBy: null,
                rejectionReasonCode: null,
                rejectionReasonNote: null,
                rejectedAt: null,
              },
            });
            keptIds.push(existing.id);
            c.id = existing.id;
            c.phone = existing.phone;
          } else {
            throw new Error(
              `${c.email} does not exist and this script will not invent a phone number ` +
                'for it. Create the account first, or add it to seed.mjs.',
            );
          }
        }

        // Everything that hangs off a user, oldest dependency last.
        await tx.supportMessage.deleteMany({});
        await tx.supportThread.deleteMany({});
        await tx.notification.deleteMany({});
        await tx.transaction.deleteMany({});
        await tx.loan.deleteMany({});

        // The donation pool account survives at a zero balance. See the header.
        await tx.account.deleteMany({ where: { userId: { not: DONATION_OWNER_ID } } });
        await tx.account.updateMany({
          where: { userId: DONATION_OWNER_ID },
          data: { savingsBalance: BigInt(0), loanBalance: BigInt(0) },
        });

        await tx.document.deleteMany({});
        await tx.nominee.deleteMany({});
        await tx.address.deleteMany({});
        await tx.auditLog.deleteMany({});
        await tx.passwordResetToken.deleteMany({});
        await tx.tokenBlacklist.deleteMany({});
        await tx.rateLimit.deleteMany({});
        await tx.sseTicket.deleteMany({});
        // NOT branches. See the header: they are configuration.

        await tx.user.deleteMany({
          where: { id: { notIn: [...keptIds, DONATION_OWNER_ID] } },
        });

        // Reference numbers start at 1. See the header.
        await tx.documentSequence.deleteMany({});

        // The first-login marker, written after the token table was emptied so
        // it is the only row for each account. Its *existence* is what
        // `mustChangePassword` reads; the secret behind it is never presented.
        for (const c of credentials) {
          await tx.passwordResetToken.create({
            data: {
              scope: FIRST_LOGIN_SCOPE,
              tokenHash: hashResetSecret(c.firstLoginSecret),
              email: c.email,
              phone: c.phone,
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            },
          });
        }
      },
      // bcrypt is outside the transaction, but two dozen deletes over a
      // trans-continental Neon connection are not instant. The default 5s
      // interactive-transaction timeout aborts partway and rolls back, which
      // looks exactly like the script having done nothing.
      { timeout: 120_000, maxWait: 30_000 },
    );

    const after = await counts(prisma);
    console.log('counts (before -> after):');
    for (const table of Object.keys(after)) {
      const changed = before[table] !== after[table] ? '' : '   (unchanged)';
      console.log(`  ${table}: ${before[table]} -> ${after[table]}${changed}`);
    }

    console.log('\n' + '='.repeat(66));
    console.log('ADMIN CREDENTIALS — shown once, not stored, not recoverable');
    console.log('='.repeat(66));
    for (const c of credentials) {
      console.log(`  ${c.email}`);
      console.log(`    password: ${c.password}`);
      console.log(`    phone:    ${c.phone}   (also works as a login identifier)`);
    }
    console.log('='.repeat(66));
    console.log('Both accounts are SUPER_ADMIN and must change this password at');
    console.log('first login — the application will not let them past it.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\ngo-live purge failed:', error.message);
  process.exit(1);
});
