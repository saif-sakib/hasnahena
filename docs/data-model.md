# Data Model

`apps/web/prisma/schema.prisma` is the single source of truth. The Go API reads the same tables with raw SQL. Schema changes ship as migration files under `apps/web/prisma/migrations/`, applied with `pnpm db:migrate` ([ADR-014](decisions.md)).

## Invariants

1. **All money is `BigInt`, whole taka.** `savingsBalance`, `loanBalance`, `amount`, `principalAmount`, `remainingAmount`, `installmentAmount`. No paisa, no decimals, no floats ([ADR-002](decisions.md)).
2. **Balance changes and their `Transaction` row are written in one DB transaction**, and every transaction stores `savingsAfter` / `loanAfter` snapshots so a passbook can be reprinted exactly.
2a. **A balance is written relatively, or read `FOR UPDATE` inside the same transaction.** `SET "savingsBalance" = "savingsBalance" + $1` is always safe. Reading the balance first — especially from the pool, outside the transaction — and writing back a total computed in Go is a lost update: concurrent postings overwrite each other, the balance stops matching the sum of `transactions`, and the `savingsAfter` snapshots become wrong on paper. Fixed everywhere ([ADR-015](decisions.md)), and it has been violated twice: LEDGER-01 in `transaction_repository.go`, then LEDGER-05 in `AddMemberLoanPayment` — which the ADR-015 pass simply did not think of. A *check* against a balance belongs in the same statement as the write (`WHERE "remainingAmount" >= $1 RETURNING …`), not a line above it. `TestBalanceWritersAreEnumerated` now fails the build when a new method writes a balance without a concurrency test.
3. **`audit_logs` is append-only.** Corrections append; nothing updates or deletes.
3a. **The database has CHECK constraints of its own** (WO-69): no negative savings or loan balance, no zero or negative posting, a loan's `remainingAmount` between 0 and its principal, `paidInstallments` no greater than `totalInstallments`, and `applicationFee = 0` — rule 3 as a constraint rather than a convention. They exist because *two* backends write these tables, so "every current code path is careful" is a statement about today's code. Before them the database accepted every one of those rows; each constraint has an integration test that was seen to pass against the unconstrained schema.
3b. **Migrations are the only definition of this schema** (WO-70). The Go API used to run `CREATE TABLE IF NOT EXISTS` at boot for four tables Prisma also owns, and the two definitions disagreed — `document_sequences."updatedAt"` had a default in one and not the other, which is the divergence that once broke all four money flows at once. A repository that issues DDL now fails `TestRepositoriesDoNotDefineSchema`.
3c. **One contact is one account, and the database says so in two places.**
   `email` carries the ordinary `@unique` index *and* `users_email_lower_key`, a
   unique index on `lower(email)` that Prisma cannot express and `schema.prisma`
   therefore only documents (WO-90). Without it `Saif@x.com` and `saif@x.com` are
   two rows — two savings balances, one person — held apart only by the
   convention that both write paths lowercase first. It is the third object
   `prisma migrate diff` cannot see, and it is also what makes login's
   `lower(email) = lower($1)` an index lookup rather than a scan of `users`.
3d. **Identity data has an end date; the money does not.** A member with any
   posting is **anonymised, never deleted** — a posting whose owner has vanished
   makes the hourly reconciliation permanently wrong, not smaller — and a
   rejected application keeps its decision for ever and loses its NID number,
   parents' names, date of birth and addresses after
   `security.rejectedRetentionDays` ([ADR-033](decisions.md), FR-23).
   `transactions.userId` and `loans.borrowerId` declare no cascade, so they are
   `ON DELETE RESTRICT`: the database refuses to delete a member with history
   whatever the application thinks.
4. IDs are `cuid()`, not UUID. Do not validate them with a UUID regex.
5. Table names are snake_case via `@@map`; column names stay camelCase and **must be quoted in raw SQL** (`a."savingsBalance"`).
5a. **Every foreign key is indexed, with its column leading** (WO-68), and `test/unit/foreign-key-indexes.test.ts` fails the build when a new one is not. Unindexed foreign keys cost twice: reads through them are sequential scans, and so is the foreign-key check Postgres runs when the *parent* row is written, while holding a lock.
6. **Reference numbers are allocated from `document_sequences` inside the posting's transaction** — `DEP-2026-000123`, `WDR-…`, `LOAN-…`, `REP-…`, `DON-…`. Never generate one randomly; `loans.loanNumber` is `@unique` ([ADR-013](decisions.md)). `RecordDonation` was the last exception and was fixed by LEDGER-04.
7. **The donation pool is a row, not a computed total.** `RecordDonation` locks the `accounts` row whose `userId` is `system_donation_fund` and credits it, so that row must exist or every donation fails. It used to be found by `accountNumber = 'HN-ACC-DONATION'`; that column is gone ([ADR-023](decisions.md)), and `accounts.userId` is unique, so the lookup still names exactly one row under `FOR UPDATE`. Nothing created it until 2026-08-17 — `pnpm db:seed` does now, `pnpm db:clear` preserves it at a zero balance, and a missing row answers 503 naming the fix. The default *waterfall* is different: it sums `transactions` (donated minus already drawn) rather than reading this balance, which is why loan recovery kept working while recording a donation could not.
8. **`transactions."processedBy"` is a foreign key to `users.id`, not a name.** It looks like a display field and is not; writing a person's name into it raises `transactions_processedBy_fkey`. A deleted Next handler did exactly that and 500'd on every call. Render the name by joining `users`, the way `member_repository.go` does.

## Entities

| Model → table | Holds | Key relations |
|---|---|---|
| `User` → `users` | identity, bilingual name, NID, role, status, `accountNo` (`ACC-KH-33001`…), avatar, approval trail | self-relation `approvedBy`; 1-1 nominee, permanent/present address |
| `Address` → `addresses` | house/road/village/union/police station/district | permanent (1-1) and present (1-1) sides of `User`. **Both foreign keys live here**, on `userPermanentId` and `userPresentId`, and both cascade — the present one used to point the other way, from `users`, which meant deleting a user orphaned it ([WO-72](changelog.md)) |
| `Nominee` → `nominees` | name, relationship, NID, phone | 1-1 `User`, cascade delete. **No photo** — registration has never collected one |
| `Document` → `documents` | Cloudinary URL + mime/size, typed `passport_photo` / `nid_front` / `nid_back` / `nominee_photo` | many-1 `User`, cascade |
| `Account` → `accounts` | `savingsBalance`, `loanBalance` | 1 per `User`, enforced — `userId` is unique. **No account number**, and **no stored loan eligibility**: all three were copies of a fact that lives elsewhere ([ADR-023](decisions.md), [ADR-037](decisions.md)). `maxLoanAmount` was written 0 at creation and never updated, so the member dashboard's own "Loan Eligibility" tile read ৳0 for every member while the loans page computed the real figure. It is `money.MaxLoanAmount(savings, loan.maxLoanMultiplier)` now, at every reader |
| `Transaction` → `transactions` | type, amount, receipt no., status, dispute fields, balance snapshots, `processedBy` | `Account`, `User`, optional `Loan` |
| `Loan` → `loans` | `loanNumber`, principal/remaining, installment plan, dates, purpose, status | borrower, optional guarantor, approver, `Account` |
| `SupportThread` / `SupportMessage` | member↔staff chat, `deleteAt` TTL | member, processing staff |
| `Notification` → `notifications` | typed alert targeted at a role or a user | — |
| `AuditLog` → `audit_logs` | action, entityType/Id, old/new JSON, actor (`performedBy`), IP, UA | — |
| `SystemConfig` → `system_config` | key/value policy store | — . **Keyed on `key`**, like `document_sequences` is keyed on `(series, year)`: the surrogate `id` was never selected, joined or referenced, and filled the leftmost column of the most hand-read table in the schema with cuids |
| `DocumentSequence` → `document_sequences` | running counter per reference series per year (`DEP`, `WDR`, `LOAN`, `REP`) | — |
| `GalleryItem` | public content | — |
| `Branch` → `branches` | an office: name, `code`, address, phone, `isActive` | `users User[]` — **members as well as staff** since 2026-08-27. Was a dead table beside a free-text `users.assignedBranch` until [WO-72](changelog.md) |
| `PasswordResetToken`, `TokenBlacklist`, `RateLimit` | reset links, revoked JWT hashes, lockout counters | — |

`PasswordResetToken` stores **no secrets**: `tokenHash` is `sha256(secret)` and
`scope` says what the secret is for — `reset`, `first-login`, or
`pwd-change:<userId>` ([ADR-031](decisions.md)). Unique on the *pair*, because a
`pwd-change` secret is six digits and two members can hold the same one. The
`first-login` rows are load-bearing beyond authentication: `mustChangePassword`
is not a column, it is `EXISTS` over an unused, unexpired one of them.

## Enums

- `UserRole` MEMBER · WORKER · ADMIN · SUPER_ADMIN
- `UserStatus` PENDING · ACTIVE · SUSPENDED · INACTIVE
- `TransactionType` DEPOSIT · WITHDRAWAL · LOAN_DISBURSEMENT · LOAN_REPAYMENT · DONATION · FEE
- `TransactionStatus` PENDING · PROCESSED · CONFIRMED · REJECTED · DISPUTED · REVERSED
- `LoanStatus` PENDING_GUARANTOR · PENDING_APPROVAL · ACTIVE · COMPLETED · SETTLED · DEFAULTED · REJECTED. The legacy `PENDING` and `APPROVED` labels are **gone** ([WO-71](changelog.md)) — `PENDING` had been the column default, so every new loan was written into the legacy vocabulary, which is why the guarantor panel never showed a request and the admin dashboard always reported zero pending loans
- `MaritalStatus`, `Gender`, `NotificationType`

`RequestStatus` used to be here and was dropped on 2026-08-27: no column ever had that type and no source file named it. Loan applications use `LoanStatus`, deposit and withdrawal requests use `TransactionStatus`.

`FEE` in `TransactionType` is **not** a fee charged to a member — there is no such thing (rule 3). The one writer is the default-recovery path in `loan_repository.go`, which posts the shortfall of a defaulted loan *out of the charity fund*. Nothing may ever write one against a member's own account; that would contradict the agreement every borrower signs ([T-05](changelog.md)).

`REVERSED` in `TransactionStatus` is written by nothing, and by design: a correction is **appended as a new posting**, never applied by editing the status of an old one ([ADR-027](decisions.md), rule 6). `WITHDRAWAL_REQUEST` in `NotificationType` is likewise unused — that notification is sent as `SYSTEM_ALERT`. Both are kept rather than dropped because removing an enum label is a migration for a value no row holds.

## `system_config` keys

The complete allow-list lives in
[`apps/web/lib/system-config.ts`](../apps/web/lib/system-config.ts) and is the
single source of truth. **The count that used to be written here is gone**: it
said 41 while the file held 46, which is what a number a human maintains does.
Read the file. `PUT /api/v1/settings` **rejects the whole
request** on any key not declared there; it used to upsert anything, so a typo
became a permanent row that looked like a real setting while the code read the
correctly-spelled one.

The seven the Go API reads (plus `support.chatRetentionDays`). The first four come
through `getLoanPolicy()` in `internal/repositories/repository.go`:

| Key | Default | Effect |
|---|---|---|
| `loan.minDepositForLoan` | `8000` | minimum savings before a member may borrow |
| `loan.maxLoanMultiplier` | `5` | personal cap = multiplier × deposit |
| `loan.maxInstallmentMonths` | `24` | longest repayment schedule |
| `loan.allowActiveLoanWithdrawal` | off | permit withdrawal while a loan is active |
| `loan.noticePeriodDays` | `90` | days of notice a member is **asked** to give before withdrawing. Informational: rendered on the member's savings screen and in the FAQ, enforced by nothing ([ADR-030](decisions.md)). `0` shows nothing |
| `loan.missedPaymentsForDefault` | `3` | scheduled instalments a borrower must have missed before a loan may be marked defaulted |
| `security.rejectedRetentionDays` | `365` | days a **rejected** application keeps its NID number, parents' names, date of birth and addresses before the Go API's daily sweep clears them. The decision and its `audit_logs` row are kept for ever ([ADR-033](decisions.md)). A missing, unparseable or non-positive value falls back to 365 rather than stopping the sweep — refusing to run would keep the data indefinitely |

The rest are read by the web app only: `org.*` (letterhead on generated
documents and the public site), `hero.*` and `features.*`/`contact.*` (landing
page), `donation.*` (payment instructions), `branding.*`, `navigation.*`,
`auth.welcomeBack`, `stats.*` (the four figures beside the home page headline —
**stated**, never counted from the ledger; see [traps.md](traps.md) § Interface),
`membership.minimumAgeYears`, `security.rejectedRetentionDays` — which the
privacy policy quotes and the Go retention sweep counts — and
`loan.guarantorThresholdAmount`, which is enforced in the Next loan-application
route, not in Go.

**A config value that is prose needs one row per language.** One row is shown to
both audiences, so whichever script an admin types it in appears on the other
language's site too — the foundation's Bengali address rendered under an English
"Address" heading on the home, contact and support pages, in the footer of every
public page, and on the letterhead of every generated document, which
[ADR-012](decisions.md) makes English only.

**Twelve pairs**, enumerated in `LOCALIZED_SETTING_PAIRS` in
[`apps/web/lib/localized-settings.ts`](../apps/web/lib/localized-settings.ts):
the three `org.*` ones (`name`, `address`, `description`), the eight landing-page
ones (`hero.tagline`, `features.title`, `contact.title`, `donation.title`,
`donation.subtitle`, `donation.referenceNote`, `navigation.donate`,
`auth.welcomeBack`), and the four hero figures (`stats.members`,
`stats.deposits`, `stats.loans`, `stats.charity`) — which are a *pair* for the
same reason as any other prose, because `১২৫+` and `125+` are the same fact in
two alphabets. The bare key holds **Bengali**
and the `…En` twin **English**; `localizedSetting(settings, key, locale)` is the
only place that chooses between them, and each side falls back to the other,
because a real address in the wrong script can still be posted to and an empty
one cannot.

The delays are the point. The description was split **four months after the
address**, because nothing renders it on any page — its only reader is the
JSON-LD in `organizationSchema()`, a node that is English by contract — so the
live English home page described the foundation in Bengali to every search
engine that asked. Then the other nine were found **a day later**, by the T-09
audit, having been there all along. The instruction "enumerate the prose keys"
was written after the second occurrence and not carried out, which is why the
enumeration is now a list in code with a census over it rather than a sentence
in a document.

The four `stats.*` pairs joined the list on 2026-08-26 and are a slightly
different case: they are *figures*, not sentences, and they used to be literals
in `messages/{en,bn}.json` — "125+", "BDT 250,000+" — invented and unchangeable
by the foundation. A number is prose: `১২৫+` and `125+` are the same fact in two
scripts. They are seeded **empty**, and a blank figure omits its card rather than
rendering a gap; the hero has an illustration of its own so it does not depend on
them being filled in.

**Everything else in the list is seeded with real words, in both scripts.** That
is a position rather than a default (the owner's instruction, 2026-08-26): the
pages fall back to `messages/{en,bn}.json` when a setting is empty, so an
unseeded install *renders* correctly and shows the admin a Content & Media screen
of blank boxes they cannot distinguish from a form that failed to load — and
saving from that screen writes the blankness over the page.
`localized-settings.test.ts` requires a seed row for both halves of every pair,
with real words in each script, and refuses Bengali seeded into an `…En` row.

The remaining `org.*` values — phone, email, website, registration number — are
language-neutral and stay single.

**Objects `prisma migrate diff` cannot see.** The list matters
because a `--from-empty` baseline would drop each one silently and
`pnpm db:migrate:check` will not report them as drift: the `audit_logs`
immutability trigger, the CHECK constraints from WO-69, and the three partial
unique indexes described below (`users_email_lower_key` from WO-90 was replaced
by the first of them on 2026-08-26). A
covering index on `support_messages` was a fourth candidate and was deliberately
not added — it had never actually existed in any environment, and a marginal gain
on the smallest hot path does not justify another invisible object.

Added 2026-08-26: the three **partial** unique indexes on `users` —
`users_email_live_key` on `lower(email)`, `users_phone_live_key` on `phone` and
`users_nid_live_key` on `nidNumber`, each `WHERE NOT (rejected application)`.
Prisma can model neither the predicate nor the expression, so `@unique` is gone
from those fields and the constraint exists only in the migration. **This is
what makes email, phone and NID unique**, and a `--from-empty` baseline would
drop all three in silence.

The predicate is `role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS
NULL AND "passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__'`, and all four
conjuncts are load-bearing: `INACTIVE` alone also matches a **deactivated
member**, who has a real hash and an `approvedAt` and must keep their
identifiers reserved. It is defined once per language — `lib/rejected-application.ts`
and `RejectedApplicationSQL` — and pinned by `rejected-application.test.ts`.

**Consequence for every query**: two rows may now hold the same email, so any
lookup by email or phone must exclude rejected applications or it can return
one.

**Read config inside the transaction.** The Go readers come in pairs —
`getSystemConfigInt64` for callers outside a transaction and
`getSystemConfigInt64Tx(ctx, tx, …)` for callers inside one. Using the pool
variant while holding a transaction takes a second connection and deadlocks the
pool under concurrency; see [ADR-017](decisions.md), which cost a permanently
hanging test to find.

Adding a key is a three-step job and the allow-list entry is the *last* one: make
something read it, seed a default in `scripts/seed.mjs`, then declare it. A key
nothing reads is a note, not a setting.

## Indexes

Hot paths are already indexed: `transactions` by `(type,status,createdAt)`, `(userId,createdAt)`, `(accountId,createdAt desc)`, `receiptNumber`; `loans` by `(status,createdAt)` and `(borrowerId,status)`; `users` by `(status,createdAt)` and `(role,status)`; `audit_logs` by actor, action and time. Match this pattern for any new foreign key.

`support_messages` briefly had two indexes on `(threadId, createdAt)`, identical
but for `DESC` on the trailing column. A btree is scannable in both directions,
so the second answered no query the first could not and cost a write on every
message. Before adding an index that differs from an existing one only in sort
direction, check that it is not this.

## Reading the database by hand

Five read-only views exist for a human with a SQL console — `v_people`,
`v_transactions`, `v_loans`, `v_audit`, `v_pending_applications`. Each leads with
the identifier a person actually has (account number, receipt number, loan
number) and joins the names in, so a question can be answered in one query
instead of three passes copying cuids between them.

**Nothing in `apps/api` or `apps/web` may select from one.** They are free to be
denormalised precisely because they store nothing and no code depends on them;
the moment application code reads one, it becomes a second schema
([ADR-037](decisions.md)). `apps/web/test/unit/database-views.test.ts` fails when
a view names a column `schema.prisma` no longer has, because neither the compiler
nor `pnpm db:migrate:check` looks at a view — Prisma's `migrate diff` does not
model them at all.

## Writing SQL by hand — two traps

The Go API writes SQL directly while Prisma owns the schema. Two mismatches
between those two views have already caused production-class defects.

**1. `@updatedAt` is not a database default.** Prisma applies it in the client,
so `prisma db push` actively **strips** any `DEFAULT` from such a column. A
hand-written `INSERT` that omits `"updatedAt"` therefore works until someone
runs a db push, and fails a NOT NULL check forever after.

Moving to migrations ([ADR-014](decisions.md)) does not change this. The
generated `0_init` emits `"updatedAt" TIMESTAMP(3) NOT NULL` with no default,
exactly like `db push` — the difference is that it is now visible in a
reviewable file instead of discoverable in production.

This is exactly what happened to `document_sequences`: the table was created by
the Go bootstrap with `DEFAULT NOW()`, `db push` removed it, and the next
deposit failed. Because every deposit, withdrawal, loan and repayment allocates
a document number inside its transaction, **all four money flows broke at once**
with a generic 500.

> **Rule: any hand-written INSERT must set `"createdAt"` and `"updatedAt"`
> explicitly.** Never rely on a database default for a column Prisma models with
> `@updatedAt`.

**It came back on the other side of the codebase (2026-08-17).** The Go
allocator (`utils.NextDocumentNumberQuery`) names both columns and has for
months. The TypeScript one in
[`lib/document-numbers.ts`](../apps/web/lib/document-numbers.ts) — used by
`POST /api/v1/loans/applications` — did not, so **no loan application could ever
be created**: the first `INSERT` for `(LOAN, <year>)` violated the constraint,
and because that row never landed, the `ON CONFLICT` branch was never reached
either. Fixed in WO-49 and pinned by
[`lib/document-numbers.test.ts`](../apps/web/lib/document-numbers.test.ts).

The durable lesson is not about this column. **Two backends write these tables,
so a schema-level fix is only half applied until you grep the other one.** When
you fix raw SQL in `apps/api`, search `apps/web/lib` and `apps/web/app/api` for
the same table, and the reverse.

**2. Timestamps are `timestamp without time zone`.** Prisma writes UTC. Postgres
`NOW()` written into such a column stores whatever wall clock the *session's*
timezone says, and pgx reads bare timestamps back as UTC. On a server set to
anything but UTC those two disagree by the offset.

That is not cosmetic where Go compares a stored timestamp against a computed
one. `IsUserTokensRevoked` does exactly that, and under an `Asia/Dhaka` session
every token issued after a password change looked *older* than the revocation
marker — locking the member out for the 24 hours the marker lives. Neon defaults
to UTC, which is the only reason production never saw it; a VPS would not be so
forgiving.

The pool now pins `timezone=UTC` on every connection
([main.go](../apps/api/cmd/server/main.go)), which makes Go-written and
Prisma-written timestamps agree everywhere. **Do not remove that line**, and be
suspicious of any `psql` session you use to inspect timestamps — it will show
you *its* timezone, not the one the app wrote with.

## Seeding and reset

| Command | Does |
|---|---|
| `pnpm db:seed` | writes the `system_config` defaults, creates the donation pool, and creates the first admin **only if none exists**. Idempotent; refuses to invent a password and will not reset an existing admin's |
| `pnpm db:clear` | deletes everything except the admin, gallery items, `system_config` and the donation pool |

Both scripts and `transaction_repository.go` must name the same donation-pool
owner id (`system_donation_fund`); a unit test holds the three against each
other, because a mismatch surfaces only when someone records a donation, as
"run `pnpm db:seed`" on an already-seeded database.

`seedAdmin`'s guard asks whether anyone **can log in** as an admin, not whether a
row has the role — the pool's owner is `role: ADMIN`, INACTIVE, with a password
hash bcrypt can never match, and for a while that was enough to make the guard
skip on exactly the databases it existed to catch.
