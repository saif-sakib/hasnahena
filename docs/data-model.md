# Data Model

`apps/web/prisma/schema.prisma` is the single source of truth. The Go API reads the same tables with raw SQL. Schema changes ship as migration files under `apps/web/prisma/migrations/`, applied with `pnpm db:migrate` ([ADR-014](decisions.md)).

## Invariants

1. **All money is `BigInt`, whole taka.** `savingsBalance`, `loanBalance`, `amount`, `principalAmount`, `remainingAmount`, `installmentAmount`, `maxLoanAmount`. No paisa, no decimals, no floats ([ADR-002](decisions.md)).
2. **Balance changes and their `Transaction` row are written in one DB transaction**, and every transaction stores `savingsAfter` / `loanAfter` snapshots so a passbook can be reprinted exactly.
3. **`audit_logs` is append-only.** Corrections append; nothing updates or deletes.
4. IDs are `cuid()`, not UUID. Do not validate them with a UUID regex.
5. Table names are snake_case via `@@map`; column names stay camelCase and **must be quoted in raw SQL** (`a."savingsBalance"`).
6. **Reference numbers are allocated from `document_sequences` inside the posting's transaction** — `DEP-2026-000123`, `WDR-…`, `LOAN-…`, `REP-…`. Never generate one randomly; `loans.loanNumber` is `@unique` ([ADR-013](decisions.md)).

## Entities

| Model → table | Holds | Key relations |
|---|---|---|
| `User` → `users` | identity, bilingual name, NID, role, status, `memberId` (`ACC-KH-33001`…), avatar, approval trail | self-relation `approvedBy`; 1-1 nominee, permanent/present address |
| `Address` → `addresses` | house/road/village/union/police station/district | permanent (1-1) and present (1-1) sides of `User` |
| `Nominee` → `nominees` | name, relationship, NID, phone, photo | 1-1 `User`, cascade delete |
| `Document` → `documents` | Cloudinary URL + mime/size, typed `passport_photo` / `nid_front` / `nid_back` / `nominee_photo` | many-1 `User`, cascade |
| `Account` → `accounts` | `accountNumber`, `savingsBalance`, `loanBalance`, `isLoanEligible`, `maxLoanAmount` | 1 per `User` |
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

Read by the Go API through `getLoanPolicy()`, edited from the admin settings page.

| Key | Default | Effect |
|---|---|---|
| `loan.minDepositForLoan` | `8000` | minimum savings before a member may borrow |
| `loan.maxLoanMultiplier` | `5` | personal cap = multiplier × deposit |
| `loan.maxInstallmentMonths` | `24` | longest repayment schedule |
| `loan.allowActiveLoanWithdrawal` | off | permit withdrawal while a loan is active |

Unknown keys are tolerated — the settings endpoint upserts whatever it is given, so typos silently create dead config. Add new keys here when you introduce them.

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

`pnpm db:clear` (`apps/web/scripts/db-clear-preserve-core.mjs`) deletes everything except the admin user, gallery items, and system config. There is no seed script; the first admin is created manually or preserved across resets.
