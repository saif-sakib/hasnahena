# Data Model

`apps/web/prisma/schema.prisma` is the single source of truth. The Go API reads the same tables with raw SQL. Schema changes ship as migration files under `apps/web/prisma/migrations/`, applied with `pnpm db:migrate` ([ADR-014](decisions.md)).

## Invariants

1. **All money is `BigInt`, whole taka.** `savingsBalance`, `loanBalance`, `amount`, `principalAmount`, `remainingAmount`, `installmentAmount`, `maxLoanAmount`. No paisa, no decimals, no floats ([ADR-002](decisions.md)).
2. **Balance changes and their `Transaction` row are written in one DB transaction**, and every transaction stores `savingsAfter` / `loanAfter` snapshots so a passbook can be reprinted exactly.
2a. **A balance is written relatively, or read `FOR UPDATE` inside the same transaction.** `SET "savingsBalance" = "savingsBalance" + $1` is always safe. Reading the balance first — especially from the pool, outside the transaction — and writing back a total computed in Go is a lost update: concurrent postings overwrite each other, the balance stops matching the sum of `transactions`, and the `savingsAfter` snapshots become wrong on paper. Fixed everywhere ([ADR-015](decisions.md)), and it has been violated twice: LEDGER-01 in `transaction_repository.go`, then LEDGER-05 in `AddMemberLoanPayment` — which the ADR-015 pass simply did not think of. A *check* against a balance belongs in the same statement as the write (`WHERE "remainingAmount" >= $1 RETURNING …`), not a line above it. `TestBalanceWritersAreEnumerated` now fails the build when a new method writes a balance without a concurrency test.
3. **`audit_logs` is append-only.** Corrections append; nothing updates or deletes.
4. IDs are `cuid()`, not UUID. Do not validate them with a UUID regex.
5. Table names are snake_case via `@@map`; column names stay camelCase and **must be quoted in raw SQL** (`a."savingsBalance"`).
6. **Reference numbers are allocated from `document_sequences` inside the posting's transaction** — `DEP-2026-000123`, `WDR-…`, `LOAN-…`, `REP-…`, `DON-…`. Never generate one randomly; `loans.loanNumber` is `@unique` ([ADR-013](decisions.md)). `RecordDonation` was the last exception and was fixed by LEDGER-04.
7. **The donation pool is a row, not a computed total.** `RecordDonation` locks the `accounts` row whose `userId` is `system_donation_fund` and credits it, so that row must exist or every donation fails. It used to be found by `accountNumber = 'HN-ACC-DONATION'`; that column is gone ([ADR-023](decisions.md)), and `accounts.userId` is unique, so the lookup still names exactly one row under `FOR UPDATE`. Nothing created it until 2026-08-17 — `pnpm db:seed` does now, `pnpm db:clear` preserves it at a zero balance, and a missing row answers 503 naming the fix. The default *waterfall* is different: it sums `transactions` (donated minus already drawn) rather than reading this balance, which is why loan recovery kept working while recording a donation could not.
8. **`transactions."processedBy"` is a foreign key to `users.id`, not a name.** It looks like a display field and is not; writing a person's name into it raises `transactions_processedBy_fkey`. A deleted Next handler did exactly that and 500'd on every call. Render the name by joining `users`, the way `member_repository.go` does.

## Entities

| Model → table | Holds | Key relations |
|---|---|---|
| `User` → `users` | identity, bilingual name, NID, role, status, `memberId` (`ACC-KH-33001`…), avatar, approval trail | self-relation `approvedBy`; 1-1 nominee, permanent/present address |
| `Address` → `addresses` | house/road/village/union/police station/district | permanent (1-1) and present (1-1) sides of `User` |
| `Nominee` → `nominees` | name, relationship, NID, phone, photo | 1-1 `User`, cascade delete |
| `Document` → `documents` | Cloudinary URL + mime/size, typed `passport_photo` / `nid_front` / `nid_back` / `nominee_photo` | many-1 `User`, cascade |
| `Account` → `accounts` | `savingsBalance`, `loanBalance`, `isLoanEligible`, `maxLoanAmount` | 1 per `User`, enforced — `userId` is unique. **No account number**: it held a copy of `users.memberId` ([ADR-023](decisions.md)) |
| `Transaction` → `transactions` | type, amount, receipt no., status, dispute fields, balance snapshots, `processedBy` | `Account`, `User`, optional `Loan` |
| `Loan` → `loans` | `loanNumber`, principal/remaining, installment plan, dates, purpose, status | borrower, optional guarantor, approver, `Account` |
| `SupportThread` / `SupportMessage` | member↔staff chat, `deleteAt` TTL | member, processing staff |
| `Notification` → `notifications` | typed alert targeted at a role or a user | — |
| `AuditLog` → `audit_logs` | action, entityType/Id, old/new JSON, actor (`performedBy`), IP, UA | — |
| `SystemConfig` → `system_config` | key/value policy store | — |
| `DocumentSequence` → `document_sequences` | running counter per reference series per year (`DEP`, `WDR`, `LOAN`, `REP`) | — |
| `GalleryItem`, `Branch` | public content, branch registry | — |
| `PasswordResetToken`, `TokenBlacklist`, `RateLimit` | reset links, revoked JWT hashes, lockout counters | — |

## Enums

- `UserRole` MEMBER · WORKER · ADMIN · SUPER_ADMIN
- `UserStatus` PENDING · ACTIVE · SUSPENDED · INACTIVE
- `TransactionType` DEPOSIT · WITHDRAWAL · LOAN_DISBURSEMENT · LOAN_REPAYMENT · DONATION · FEE
- `TransactionStatus` PENDING · PROCESSED · CONFIRMED · REJECTED · DISPUTED · REVERSED
- `LoanStatus` PENDING_GUARANTOR · PENDING_APPROVAL · ACTIVE · COMPLETED · SETTLED · DEFAULTED · REJECTED, plus legacy `PENDING` / `APPROVED` still accepted by old rows
- `RequestStatus`, `MaritalStatus`, `Gender`, `NotificationType`

`FEE` exists in `TransactionType` for late-fee policy that is not implemented; it must never carry interest.

## `system_config` keys

The complete allow-list lives in
[`apps/web/lib/system-config.ts`](../apps/web/lib/system-config.ts) — 35 keys —
and is the single source of truth. `PUT /api/v1/settings` **rejects the whole
request** on any key not declared there; it used to upsert anything, so a typo
became a permanent row that looked like a real setting while the code read the
correctly-spelled one.

The six the Go API reads (plus `support.chatRetentionDays`). The first four come
through `getLoanPolicy()` in `internal/repositories/repository.go`:

| Key | Default | Effect |
|---|---|---|
| `loan.minDepositForLoan` | `8000` | minimum savings before a member may borrow |
| `loan.maxLoanMultiplier` | `5` | personal cap = multiplier × deposit |
| `loan.maxInstallmentMonths` | `24` | longest repayment schedule |
| `loan.allowActiveLoanWithdrawal` | off | permit withdrawal while a loan is active |
| `loan.noticePeriodMonths` | `3` | how long a withdrawal notice must sit before it can be paid (FR-08, [ADR-016](decisions.md)). `0` means no notice period |
| `loan.missedPaymentsForDefault` | `3` | scheduled instalments a borrower must have missed before a loan may be marked defaulted |

The rest are read by the web app only: `org.*` (letterhead on generated
documents and the public site), `hero.*` and `features.*`/`contact.*` (landing
page), `donation.*` (payment instructions), `branding.*`, `navigation.*`,
`auth.welcomeBack`, and `loan.guarantorThresholdAmount` — which is enforced in
the Next loan-application route, not in Go.

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
