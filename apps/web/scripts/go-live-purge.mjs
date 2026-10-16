#!/usr/bin/env node
//
// The cutover purge (docs/runbook.md §7.1): test data gone, configuration kept.
// NOT `pnpm db:clear` — this runs once, against the database about to hold real
// savings, and NAMES its survivors rather than discovering them.
//
//   node scripts/go-live-purge.mjs            # dry run
//   node scripts/go-live-purge.mjs --confirm  # does it
//
// Survives: system_config, gallery_items, branches, the donation pool
// (`system_donation_fund` — RecordDonation needs it), and the named admins,
// whose rows are reused and SCRUBBED of member-shaped fields (an invented,
// uniquely indexed NID would one day refuse a real member) and given an
// STF-#### number. Id, email, phone and display name are kept.
// Goes: every other user and all their rows, audit_logs included;
// document_sequences reset so the first receipt is DEP-YYYY-000001; and the
// Cloudinary folders of everyone deleted (printed instead if no credentials).
//
// Flags:
//   --confirm          actually do it
//   --reset-passwords  new password per admin + forced change (default: keep theirs)
//   --admins-only      scrub the admin rows, delete NOTHING (safe any time)
//   --keep-images      leave Cloudinary alone

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaClient, MaritalStatus, UserRole, UserStatus } from '@prisma/client';
import { loadDatabaseEnv, redactUrl } from './lib/env.mjs';
import { runAsScript } from './lib/guard.mjs';
import { allocateStaffNo, parseStaffSequence } from './lib/account-no.mjs';

/**
 * The launch admins, named rather than discovered. Override with
 * PURGE_KEEP_ADMINS=a@x.com,b@x.com.
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

/**
 * The sole active office, or null — never a guess between several (two rows are
 * requested to tell "only" from "first").
 */
async function soleActiveBranchId(tx) {
  const active = await tx.branch.findMany({
    where: { isActive: true },
    select: { id: true },
    take: 2,
  });
  return active.length === 1 ? active[0].id : null;
}

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

/** A readable password: no l/1/I/O/0, 20 chars (~116 bits), randomInt (unbiased). */
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

/** Cloudinary credentials present? If not, folders are printed instead of deleted. */
function cloudinaryConfigured() {
  const ok =
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET;
  if (ok) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }
  return Boolean(ok);
}

/**
 * The folders of the people being deleted, named from their rows (listing the
 * host would also sweep the surviving admins).
 */
function foldersFor(users) {
  const folders = new Set();
  for (const u of users) {
    folders.add(`people/${u.accountNo || u.id}`);
    if (u.formNumber) folders.add(`applications/${u.formNumber}`);
  }
  return [...folders];
}

/** Empty one folder and remove it. Returns the number of assets deleted, or null. */
async function purgeFolder(folder) {
  const prefix = `hasnahena/${folder}`;
  try {
    const result = await cloudinary.api.delete_resources_by_prefix(prefix);
    const deleted = Object.values(result.deleted ?? {}).filter((v) => v === 'deleted').length;
    try {
      await cloudinary.api.delete_folder(prefix);
    } catch {
      // Cosmetic: the assets are what matter, and this throws when the folder
      // was already gone.
    }
    return deleted;
  } catch (error) {
    console.error(`  ! ${prefix}: ${error?.message ?? error}`);
    return null;
  }
}


async function main() {
  loadDatabaseEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Set it in the shell or in .env.local.');
  }

  const confirmed = process.argv.includes('--confirm');
  // --keep-passwords is accepted as a no-op (it is now the default).
  const keepPasswords = !process.argv.includes('--reset-passwords');
  const adminsOnly = process.argv.includes('--admins-only');
  const keepImages = process.argv.includes('--keep-images');

  console.log(`database: ${redactUrl(process.env.DATABASE_URL)}`);
  console.log(
    confirmed
      ? `mode:     CONFIRMED — ${adminsOnly ? 'scrubbing the admin rows only, deleting nothing' : 'this will delete data'}`
      : 'mode:     dry run (pass --confirm to apply)',
  );
  console.log(
    keepPasswords
      ? '          passwords: left alone (pass --reset-passwords to generate new ones)'
      : '          --reset-passwords: a new password per admin, change forced at first login',
  );
  if (keepImages) console.log('          --keep-images: Cloudinary is left untouched');
  console.log('');

  const prisma = new PrismaClient();
  try {
    const before = await counts(prisma);

    const survivors = await prisma.user.findMany({
      where: { email: { in: ADMINS.map((a) => a.email) } },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        nameEn: true,
        accountNo: true,
        fatherName: true,
        motherName: true,
        nidNumber: true,
        dateOfBirth: true,
        formNumber: true,
        avatarUrl: true,
        assignedBranchId: true,
      },
    });
    const byEmail = new Map(survivors.map((u) => [u.email, u]));

    console.log('admin accounts:');
    for (const admin of ADMINS) {
      const found = byEmail.get(admin.email);
      if (!found) {
        console.log(`  ${admin.email} — NOT FOUND. This script will refuse to run.`);
        continue;
      }
      console.log(`  ${admin.email} — ${found.role}/${found.status}, "${found.nameEn}"`);

      // Show the scrub field by field.
      const willChange = [];
      if (parseStaffSequence(found.accountNo) === null) {
        willChange.push(`accountNo ${found.accountNo ?? '(none)'} -> a new STF-#### number`);
      }
      if (found.nidNumber) willChange.push(`nidNumber ${found.nidNumber} -> cleared`);
      if (found.fatherName !== found.nameEn || found.motherName !== found.nameEn) {
        willChange.push(
          `parents "${found.fatherName}" / "${found.motherName}" -> the person's own name ` +
            '(staff have no parents recorded; both columns are NOT NULL)',
        );
      }
      if (found.dateOfBirth) willChange.push('dateOfBirth -> cleared');
      if (found.formNumber) willChange.push(`formNumber ${found.formNumber} -> cleared`);
      if (found.avatarUrl) willChange.push('avatarUrl -> cleared (old opaque Cloudinary path)');
      if (!found.assignedBranchId) willChange.push('branch -> the sole active one, if there is one');
      if (!keepPasswords) willChange.push('password -> newly generated, change forced at first login');

      for (const line of willChange) console.log(`      ${line}`);
      if (willChange.length === 0) console.log('      already clean');
    }
    console.log('');

    if (!confirmed && adminsOnly) {
      console.log('Nothing was changed, and --admins-only deletes nothing at all.');
      console.log('Re-run with --confirm to apply the changes listed above.');
      return;
    }

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
      password: keepPasswords ? null : generatePassword(),
      firstLoginSecret: crypto.randomBytes(32).toString('hex'),
    }));
    if (!keepPasswords) {
      for (const c of credentials) {
        c.passwordHash = await bcrypt.hash(c.password, 12);
      }
    }

    const keptIds = [];

    // Read before the delete; admins and the pool are excluded by the same rule.
    const doomed = adminsOnly
      ? []
      : await prisma.user.findMany({
          where: { email: { notIn: ADMINS.map((a) => a.email) }, id: { not: DONATION_OWNER_ID } },
          select: { id: true, accountNo: true, formNumber: true },
        });

    await prisma.$transaction(
      async (tx) => {
        // DATA-08: the audit_logs trigger refuses deletes unless opted in; SET
        // LOCAL scopes it to this transaction.
        await tx.$executeRawUnsafe("SET LOCAL hasnahena.allow_audit_purge = 'on'");

        // Scrub the admins first, so the delete is "everything else".
        const branchId = await soleActiveBranchId(tx);

        for (const c of credentials) {
          const existing = await tx.user.findFirst({
            where: { email: c.email },
            select: { id: true, phone: true, nameEn: true, accountNo: true },
          });

          if (!existing) {
            throw new Error(
              `${c.email} does not exist and this script will not invent a phone number ` +
                'for it. Create the account first, or add it to seed.mjs.',
            );
          }

          // Keep an existing number — it also names their image folder.
          let accountNo = existing.accountNo;
          if (parseStaffSequence(accountNo) === null) {
            accountNo = await allocateStaffNo(tx);
          }

          await tx.user.update({
            where: { id: existing.id },
            data: {
              ...(keepPasswords ? {} : { passwordHash: c.passwordHash }),
              role: UserRole.SUPER_ADMIN,
              status: UserStatus.ACTIVE,
              accountNo,
              // The id IS the account number (ADR-043); FKs cascade.
              id: accountNo,
              assignedBranchId: branchId,

              // Member-shaped fields have no business on a staff row (NID is uniquely indexed).
              nidNumber: null,
              dateOfBirth: null,
              bloodGroup: null,
              profession: null,
              childrenCount: 0,
              maritalStatus: MaritalStatus.UNMARRIED,
              formNumber: null,

              // NOT NULL parents get the person's own name, as hiring writes.
              fatherName: existing.nameEn,
              motherName: existing.nameEn,

              // Pre-2026-08-27 avatars live under random ids; reported for manual deletion.
              avatarUrl: null,

              // Self-referential: an admin approved by a member who is about to
              // be deleted would fail the foreign key.
              approvedBy: null,
              approvedAt: null,
              rejectionReasonCode: null,
              rejectionReasonNote: null,
              rejectedAt: null,
            },
          });

          keptIds.push(existing.id);
          c.id = existing.id;
          c.phone = existing.phone;
          c.nameEn = existing.nameEn;
          c.accountNo = accountNo;
          c.previousAccountNo = existing.accountNo;
        }

        // --admins-only stops here.
        if (adminsOnly) return;

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

        // First-login markers, only under --reset-passwords.
        for (const c of keepPasswords ? [] : credentials) {
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
      // The default 5s interactive timeout aborts partway over a slow link.
      { timeout: 120_000, maxWait: 30_000 },
    );

    // Images after the database; a failed folder delete must not roll it back.
    if (!adminsOnly && doomed.length > 0) {
      const folders = foldersFor(doomed);
      console.log('');
      if (keepImages) {
        console.log(`images:   --keep-images, so ${folders.length} folder(s) were left on Cloudinary.`);
      } else if (!confirmed) {
        console.log(`images:   would delete ${folders.length} Cloudinary folder(s).`);
      } else if (!cloudinaryConfigured()) {
        console.log('images:   Cloudinary is NOT configured here, so nothing was deleted.');
        console.log('          These folders still hold members\' photographs and NID scans.');
        console.log('          Delete them by hand in the Cloudinary console:');
        for (const folder of folders) console.log(`            hasnahena/${folder}`);
      } else {
        let assets = 0;
        let failed = 0;
        for (const folder of folders) {
          const deleted = await purgeFolder(folder);
          if (deleted === null) failed += 1;
          else assets += deleted;
        }
        console.log(`images:   ${assets} asset(s) deleted from ${folders.length} folder(s).`);
        if (failed > 0) {
          console.log(`          ${failed} folder(s) would not delete — see the errors above and`);
          console.log('          clear them in the Cloudinary console. Files are still public.');
        }
      }
    }

    if (!adminsOnly) {
      const after = await counts(prisma);
      console.log('counts (before -> after):');
      for (const table of Object.keys(after)) {
        const changed = before[table] !== after[table] ? '' : '   (unchanged)';
        console.log(`  ${table}: ${before[table]} -> ${after[table]}${changed}`);
      }
      console.log('');
    }

    console.log('='.repeat(70));
    console.log('ADMIN ACCOUNTS');
    console.log('='.repeat(70));
    for (const c of credentials) {
      console.log(`  ${c.email}`);
      console.log(`    name:       ${c.nameEn}`);
      const renumbered =
        c.previousAccountNo && c.previousAccountNo !== c.accountNo
          ? `   (was ${c.previousAccountNo})`
          : '';
      console.log(`    accountNo:  ${c.accountNo}${renumbered}`);
      console.log(`    phone:      ${c.phone}   (also works as a login identifier)`);
      if (c.password) {
        console.log(`    password:   ${c.password}`);
      } else {
        console.log('    password:   unchanged');
      }
    }
    console.log('='.repeat(70));

    if (credentials.some((c) => c.password)) {
      console.log('Shown once — not stored, not recoverable. Both accounts are');
      console.log('SUPER_ADMIN and must change this password at first login;');
      console.log('the application will not let them past it.');
    }

    // Flag display names that still look like placeholders.
    const placeholders = credentials.filter((c) =>
      /^(admin|super ?admin|staff|user|test)$/i.test((c.nameEn ?? '').trim()),
    );
    if (placeholders.length > 0) {
      console.log('');
      console.log('Names still to set — this script will not invent one:');
      for (const c of placeholders) {
        console.log(`  ${c.email} is called "${c.nameEn}". Set the real name on the profile screen.`);
      }
    }

    console.log('');
    console.log('Scrubbed on each admin row: nidNumber, dateOfBirth, bloodGroup,');
    console.log('profession, formNumber, marital status, children count and any');
    console.log('avatar pointer. An avatar uploaded before 2026-08-27 lives under a');
    console.log('cuid on the image host and is now unreferenced — delete it there,');
    console.log('or simply upload a new one, which files it under people/<accountNo>/.');
  } finally {
    await prisma.$disconnect();
  }
}

runAsScript(import.meta.url, main, { label: 'go-live purge' });
