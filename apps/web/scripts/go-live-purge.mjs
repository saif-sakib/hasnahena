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
// WHAT "RESET" MEANS FOR AN ADMIN ROW
// -----------------------------------
// The row is **reused, and scrubbed** — not re-roled and left otherwise as it
// was, which is what the first version did and which left both launch accounts
// carrying test data into production:
//
//   accountNo    `HN-A-001` and `STF-MOB97EFH` — two dead numbering schemes,
//                neither of them the `STF-0001` series staff are issued from now
//   nidNumber    `9876543210987`, invented by an old seed. That column is
//                **uniquely indexed**, so a fabricated value on a live account
//                is a real member's registration refused one day with "that NID
//                is already in use" and nobody able to explain why
//   dateOfBirth  a made-up 1985 birthday on a real person's record
//   fatherName / motherName
//                `Admin Father`, `Admin Mother`
//
// None of that is dangerous the day it is written and all of it is permanent
// once members exist, which is exactly the shape of thing a cutover is for. So
// every member-shaped field is cleared, a number is allocated from the live
// series, and the account is attached to the sole active branch if there is one.
//
// What is **not** touched: the row id, the email, the phone, and the display
// name. The first three are identity that other rows may reference; the last is
// something only the person can tell you, and inventing one is how `Admin` got
// there in the first place. The script says out loud when a name still looks
// like a placeholder.
//
// THE PASSWORDS
// -------------
// **Left alone by default.** The admin accounts survive this purge, and so do
// the passwords their owners have already chosen and are already using. Taking
// one away is not part of clearing test data, and a first-login marker planted
// over a password somebody set themselves demands they change it again for no
// reason at all.
//
// This was the other way round, on the reasoning that a cutover is the moment to
// rotate everything. That reasoning holds for secrets that live in a config
// store — the JWT secret, the database URL, the Brevo key, all of which the
// go-live procedure does rotate. It does not hold for a person's own password:
// the risk it addresses is a password that has travelled through a chat log,
// and the fix generates a *new* one and prints it to a terminal, which is the
// same journey.
//
// `--reset-passwords` asks for the old behaviour: a generated password per
// admin, printed once, stored nowhere this script can read back, plus a
// `first-login` marker — the platform's own forced-change mechanism (see
// FindByIdentifier's mustChangePassword) — so the printed password gets them in
// and the application makes them replace it before they can do anything else.
// Reach for it on a database whose admin passwords nobody trusts.
//
// FLAGS
// -----
//   --confirm          actually do it; without this the script is a dry run
//   --reset-passwords  generate a new password per admin and force a change at
//                      first login. Off by default: the admins keep theirs
//   --admins-only      scrub the admin rows and delete NOTHING. Safe to run at
//                      any time, including against a database in use
//   --keep-images      leave Cloudinary alone
//
// THE IMAGES
// ----------
// Deleting the rows is half of an erasure. Every member deleted here has a
// folder on the image host — `hasnahena/people/ACC-KH-33002` for their avatar
// and identity documents, `hasnahena/applications/APP-2026-000004` for anything
// filed before they were admitted — and those are served from URLs that need no
// login. A cutover that empties the database and leaves the scans of a hundred
// test members' national identity cards online has not cleared the test data;
// it has only stopped being able to find it.
//
// So the folders of everybody being deleted go too, when Cloudinary credentials
// are present. When they are not — this script's only hard requirement is a
// database URL, deliberately — nothing is deleted and every folder is **printed**
// so it can be dealt with by hand. Silence is the one outcome that is not
// allowed here.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaClient, MaritalStatus, UserRole, UserStatus } from '@prisma/client';
import { loadDatabaseEnv, redactUrl } from './lib/env.mjs';
import { allocateStaffNo, parseStaffSequence } from './lib/account-no.mjs';

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

/**
 * The office to attach the admins to, when there is only one it could be.
 *
 * Assigns automatically ONLY when there is exactly one active office — guessing
 * between several is wrong in a way nothing would report, and a member filed
 * under the wrong branch is discovered when a per-branch report does not add up.
 * Two rows are requested rather than one because `findFirst` cannot tell "the
 * only office" from "the first of several", which is the distinction this exists
 * to make. Restated here rather than imported for the same reason as above, and
 * declines to choose for the same reason: with several offices, guessing is
 * wrong in a way nothing would report.
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

/**
 * Whether the image host can be reached from here.
 *
 * The script's one hard requirement is a database URL. Cloudinary credentials
 * are optional and usually present in `apps/web/.env`; when they are not, the
 * folders are printed instead of deleted, which is the only acceptable
 * alternative to doing it.
 */
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
 * The Cloudinary folders belonging to the people this purge deletes.
 *
 * Named from the row rather than found by listing the host: a folder is
 * `people/<accountNo>` when they were admitted and `people/<id>` for anything
 * filed before account numbers named folders, plus `applications/<formNumber>`
 * for documents submitted and never moved. Listing instead would be shorter and
 * would also sweep up the two surviving admins, which is the one thing this
 * must not do.
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
  // `--keep-passwords` is still accepted and does nothing, because it is what
  // the go-live procedure told people to type for months. A flag that has become
  // the default should be a no-op, not an error.
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

      // Say what the scrub would actually change, field by field, rather than
      // "row reused". The first version of this script printed that and left
      // both accounts carrying an invented NID into production.
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

    // Read before the delete, because after it there is nothing left to ask.
    // Only the people who are actually going: the two admins and the donation
    // pool are excluded here by the same rule the delete uses below.
    const doomed = adminsOnly
      ? []
      : await prisma.user.findMany({
          where: { email: { notIn: ADMINS.map((a) => a.email) }, id: { not: DONATION_OWNER_ID } },
          select: { id: true, accountNo: true, formNumber: true },
        });

    await prisma.$transaction(
      async (tx) => {
        // DATA-08: audit_logs carries a BEFORE UPDATE OR DELETE trigger that
        // rejects every delete unless a transaction opts in. This is one of the
        // two legitimate callers — the cutover, before a single real audit row
        // exists. SET LOCAL scopes the permission to this transaction and this
        // connection, so it cannot leak to an application query running on a
        // neighbouring pooled connection.
        await tx.$executeRawUnsafe("SET LOCAL hasnahena.allow_audit_purge = 'on'");

        // Scrub the admin rows, and collect the ids that survive. Done FIRST so
        // the delete below can be expressed as "everything else".
        //
        // The branch is read once, outside the loop: both admins belong to the
        // same office and there is no sense asking twice.
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

          // A number from the live series, unless the row already holds one.
          // Re-running must not renumber somebody: the account number is also
          // the name of their folder on the image host, so a second number would
          // orphan their photograph.
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
              // The id **is** the account number ([ADR-043](../../../docs/decisions.md)),
              // so renumbering a reused admin row moves both. Every foreign key
              // referencing it is `ON UPDATE CASCADE`, so the children follow;
              // there are none at this point in a cutover anyway, because
              // everything else is about to be deleted.
              id: accountNo,
              assignedBranchId: branchId,

              // Everything below is member-shaped and has no business on a
              // staff row. Left alone, an old seed's invented values follow the
              // account into production — see the header.
              //
              // `nidNumber` is the one that matters most: it is uniquely
              // indexed, so a fabricated value here is a real member refused at
              // registration one day with no way to work out why.
              nidNumber: null,
              dateOfBirth: null,
              bloodGroup: null,
              profession: null,
              childrenCount: 0,
              maritalStatus: MaritalStatus.UNMARRIED,
              formNumber: null,

              // Staff do not have parents recorded — the foundation has no
              // reason to hold them and never asks. Both columns are NOT NULL,
              // so they carry the person's own name, which is what
              // `POST /api/v1/admin/workers` already writes when hiring.
              fatherName: existing.nameEn,
              motherName: existing.nameEn,

              // An avatar uploaded before 2026-08-27 lives under a cuid and a
              // random filename. Clearing the pointer means the next upload
              // files it under `people/<accountNo>/avatar` like everyone else's;
              // the orphaned asset is reported at the end for deletion by hand,
              // because this script has no Cloudinary credentials by design.
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

        // --admins-only stops here: the scrub is the whole job and nothing is
        // deleted. It is the mode to reach for against a database somebody is
        // using, which a cutover purge never is.
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

        // The first-login marker, written after the token table was emptied so
        // it is the only row for each account. Its *existence* is what
        // `mustChangePassword` reads; the secret behind it is never presented.
        //
        // Only under --reset-passwords. Demanding a change of a password the
        // admin chose themselves, because a script ran, is a prompt with no
        // reason behind it.
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
      // bcrypt is outside the transaction, but two dozen deletes over a
      // trans-continental Neon connection are not instant. The default 5s
      // interactive-transaction timeout aborts partway and rolls back, which
      // looks exactly like the script having done nothing.
      { timeout: 120_000, maxWait: 30_000 },
    );

    // The image host, after the database — a folder that will not delete must
    // not roll back a purge that has already succeeded, and the folder names
    // were read before the rows went.
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

    // A display name that still looks like a placeholder is worth saying out
    // loud rather than guessing at. `Admin` is what an old seed wrote, and it is
    // what every generated document's "prepared by" line would print.
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

main().catch((error) => {
  console.error('\ngo-live purge failed:', error.message);
  process.exit(1);
});
