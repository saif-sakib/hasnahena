# Data Model

`apps/web/prisma/schema.prisma` is the single source of truth; the Go API reads the same tables with raw SQL. Schema changes ship as migrations under `apps/web/prisma/migrations/`, applied with `pnpm db:migrate` ([ADR-014](decisions.md)) — the migrations are the only definition (WO-70; a repository issuing DDL fails `TestRepositoriesDoNotDefineSchema`).

## Invariants

1. **Money is `BigInt` whole taka** — no paisa, decimals or floats ([ADR-002](decisions.md)).
2. **A balance change and its `Transaction` row are one DB transaction**; every transaction stores `savingsAfter`/`loanAfter` snapshots so a passbook reprints exactly.
3. **Balances are written relatively** (`SET "savingsBalance" = "savingsBalance" + $1`) or read `FOR UPDATE` in the same transaction; a check against a balance belongs in the same statement (`WHERE "remainingAmount" >= $1 RETURNING …`). Violated twice (LEDGER-01, LEDGER-05 — [ADR-015](decisions.md)); `TestBalanceWritersAreEnumerated` demands a concurrency test for every writer.
4. **`audit_logs` is append-only** (a trigger refuses UPDATE; DELETE only with `hasnahena.allow_audit_purge` set locally).
5. **CHECK constraints** (WO-69): no negative savings or loan balance, no non-positive posting, `remainingAmount` between 0 and principal, `paidInstallments ≤ totalInstallments`, `applicationFee = 0`. Two backends write these tables, so the database enforces them itself.
6. **Uniqueness of email, phone and NID among live rows** comes from three partial indexes — `users_email_live_key` on `lower(email)`, `users_phone_live_key`, `users_nid_live_key` — each `WHERE NOT (rejected application)`. The predicate is `role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL AND "passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__'`; all four conjuncts matter (`INACTIVE` alone also matches a deactivated member, who keeps their identifiers). Defined once per language — `lib/rejected-application.ts`, `RejectedApplicationSQL` — pinned by `rejected-application.test.ts`. **Two rows may share an email**, so every lookup by contact detail excludes rejected applications.
7. **Identity data has an end date; money does not** ([ADR-033](decisions.md), FR-23): a member with any posting is anonymised, never deleted; a rejected application loses NID, parents' names, DOB and addresses after `security.rejectedRetentionDays`. `transactions.userId` and `loans.borrowerId` are `ON DELETE RESTRICT`.
8. **A row is keyed by what it is already called** ([ADR-044](decisions.md)): `users.id` is the person's number; `transactions.id` the receipt number; `loans.id` the loan number; `accounts`/`nominees` keyed on `userId`, `addresses`/`documents` on `(userId, type)`; `audit_logs`, `notifications`, `gallery_items` on a sequence. A `cuid()` survives only where nobody reads one (`password_reset_tokens`, `token_blacklist`). Never validate an id with a UUID regex.
9. Tables are snake_case (`@@map`); columns camelCase and **quoted in raw SQL** (`a."savingsBalance"`).
10. **Every foreign key is indexed with its column leading** (WO-68, `foreign-key-indexes.test.ts`) — otherwise reads and the parent-row FK check are sequential scans.
11. **Reference numbers come from `document_sequences` in the posting's transaction and ARE the key** ([ADR-013](decisions.md)): `DEP-` deposit, `WDR-` withdrawal, `DSB-` disbursement or top-up, `REP-` instalment, `DON-` donation, `ADJ-` donation-pool draw, `LOAN-` the loan, `APP-` an application. Never random (`TestPostingsAndLoansAreNumbered`); never a `FEE` series (rule 3).
12. **A member's own payment reference (bKash TrxID) is `transactions."externalReference"`**, never the receipt number.
13. **The donation pool is a row**: the `accounts` row of `userId = 'system_donation_fund'`, locked and credited by `RecordDonation`; created by `pnpm db:seed`, kept by `pnpm db:clear`, a 503 naming the fix if missing. The default waterfall instead sums `transactions` (donated minus drawn).
14. **`transactions."processedBy"` is a foreign key to `users.id`**, not a name — join `users` to display it.

## Entities

| Model → table | Holds | Key / relations |
|---|---|---|
| `User` → `users` | identity, bilingual name, NID, role, status, `accountNo`, `formNumber`, avatar, approval and rejection trail, `preferredLocale`, `assignedBranchId` | **`id` is the person's number** — `STF-0001`, `APP-2026-000001` while applying, `ACC-KH-33001` once admitted; no default, changes once at approval ([ADR-043](decisions.md)) |
| `Address` → `addresses` | `type` (`PERMANENT`/`PRESENT`), house…district | `(userId, type)`; cascades |
| `Nominee` → `nominees` | name, relationship, NID, phone (no photo) | `userId`; cascades |
| `Document` → `documents` | Cloudinary URL, mime, size; `passport_photo`/`nid_front`/`nid_back`/`nominee_photo` | `(userId, type)`; cascades |
| `Account` → `accounts` | `savingsBalance`, `loanBalance` | `userId` (one per user). No account number, no stored eligibility — `money.MaxLoanAmount(savings, loan.maxLoanMultiplier)` at every reader ([ADR-023](decisions.md), [ADR-037](decisions.md)) |
| `Transaction` → `transactions` | type, amount, status, `externalReference`, dispute fields, snapshots, `processedBy` | id = receipt number; `User`, optional `Loan`; no `accountId` |
| `Loan` → `loans` | principal/remaining, instalment plan, dates, purpose, status | id = loan number; borrower, optional guarantor, approver |
| `Branch` → `branches` | name, address, phone, `isActive` | **the code is the id** (`KH`, [ADR-041](decisions.md)); `users` — members and staff, assigned by the admin at approval |
| `SupportThread` / `SupportMessage` | member↔staff chat, `deleteAt` TTL | member, processing staff |
| `Notification` → `notifications` | typed alert for a role or a user | sequence; `targetUserId` FK with cascade (WO-92) |
| `AuditLog` → `audit_logs` | action, entityType/Id, old/new JSON, `performedBy`, IP, UA | sequence. `entityId` is readable (`ACC-…`, `LOAN-…`, `DEP-…`); pre-admission rows hold the `APP-` number, resolved via `users.formNumber` |
| `SystemConfig` → `system_config` | key/value settings | keyed on `key` |
| `DocumentSequence` → `document_sequences` | counter per series per year | `(series, year)` |
| `GalleryItem` → `gallery_items` | public photos | sequence |
| `PasswordResetToken`, `TokenBlacklist`, `RateLimit` | reset secrets, revoked tokens, lockout counters | — |

`PasswordResetToken` stores **no secrets**: `tokenHash = sha256(secret)` and `scope` is `reset`, `first-login` or `pwd-change:<userId>` ([ADR-031](decisions.md)), unique on the pair (six-digit codes collide). `mustChangePassword` is not a column — it is `EXISTS` over an unused `first-login` row.

## Enums

- `UserRole` MEMBER · WORKER · ADMIN · SUPER_ADMIN
- `UserStatus` PENDING · ACTIVE · SUSPENDED · INACTIVE
- `TransactionType` DEPOSIT · WITHDRAWAL · LOAN_DISBURSEMENT · LOAN_REPAYMENT · DONATION · FEE
- `TransactionStatus` PENDING · PROCESSED · CONFIRMED · REJECTED · DISPUTED · REVERSED
- `LoanStatus` PENDING_GUARANTOR · PENDING_APPROVAL · ACTIVE · COMPLETED · SETTLED · DEFAULTED · REJECTED (legacy `PENDING`/`APPROVED` removed, WO-71)
- `MaritalStatus`, `Gender`, `NotificationType`, `AddressType`

`FEE` is **never** a charge to a member (rule 3): its one writer is the default waterfall posting a shortfall out of the donation pool (always with a `loanId`). `REVERSED` and `NotificationType.WITHDRAWAL_REQUEST` are written by nothing — corrections append a new posting (ADR-027) — and are kept because dropping an unused label is a migration for nothing.

## `system_config` keys

The allow-list is [`apps/web/lib/system-config.ts`](../apps/web/lib/system-config.ts) — read it; `PUT /api/v1/settings` rejects the whole request on an undeclared key. Read by the Go API (the first four via `getLoanPolicy()`):

| Key | Default | Effect |
|---|---|---|
| `loan.minDepositForLoan` | `8000` | minimum savings before borrowing |
| `loan.maxLoanMultiplier` | `5` | personal cap = multiplier × savings |
| `loan.maxInstallmentMonths` | `24` | longest schedule |
| `loan.allowActiveLoanWithdrawal` | off | withdraw while a loan is active |
| `loan.noticePeriodDays` | `90` | notice a member is **asked** for; shown on the savings screen and FAQ, enforces nothing ([ADR-030](decisions.md)) |
| `loan.missedPaymentsForDefault` | `3` | missed instalments before a loan may be defaulted |
| `security.rejectedRetentionDays` | `365` | when the daily Go sweep clears a rejected application's identity data; bad values fall back to 365 |
| `support.chatRetentionDays` | — | support chat retention |

Web-only: `org.*` (letterhead, public site), `hero.*`, `features.*`, `contact.*`, `donation.*`, `bank.*`, `branding.*`, `navigation.*`, `auth.welcomeBack`, `stats.*` (the hero figures — **stated, never counted**), `membership.minimumAgeYears`, and `loan.guarantorThresholdAmount` (enforced in the Next loan-application route).

**Prose values are pairs** — `LOCALIZED_SETTING_PAIRS` in [`lib/localized-settings.ts`](../apps/web/lib/localized-settings.ts): `org.{name,address,description}`, `hero.tagline`, `features.title`, `contact.title`, `donation.{title,subtitle,referenceNote}`, `navigation.donate`, `auth.welcomeBack`, `stats.{members,deposits,loans,charity}`. The bare key is Bengali, the `…En` twin English; `localizedSetting(settings, key, locale)` alone chooses, each side falling back to the other. One row shown to both audiences put the Bengali address on the English site and the English-only letterhead — found key by key four times, hence the coded list and census. Every pair is seeded with real words in both scripts (`localized-settings.test.ts`; `seedConfig` also backfills empty rows). Phone, email, website and registration number are language-neutral singles.

Inside a repository transaction, read config with the `…Tx` reader ([ADR-017](decisions.md)). Adding a key: make something read it, seed it, then declare it.

**Objects `prisma migrate diff` cannot see** — a `--from-empty` baseline drops them silently and `db:migrate:check` will not notice: the `audit_logs` trigger, the CHECK constraints, and the three partial unique indexes.

## Indexes

Hot paths: `transactions` by `(type,status,createdAt)`, `(status,createdAt)`, `(userId,createdAt desc)`; `loans` by `(status,createdAt)`, `(borrowerId,status)`, `(guarantorId,status)`; `users` by `(status,createdAt)`, `(role,status)`, `phone`; `audit_logs` by actor, action and time. A btree scans both directions — never add an index differing from an existing one only in sort order.

## Reading the database by hand

Read-only views for a human with a SQL console: `v_people`, `v_transactions`, `v_loans`, `v_audit`, `v_pending_applications` — each leads with the identifier a person has and joins the names in. **No application code may select from one** ([ADR-037](decisions.md)); `database-views.test.ts` fails when a view names a column the schema dropped (nothing else checks views).

## Writing SQL by hand — two traps

1. **`@updatedAt` has no database default** (Prisma sets it client-side, and `0_init` declares it NOT NULL with none). **Every hand-written INSERT sets `"createdAt"` and `"updatedAt"`.** Forgetting it once broke all four money flows (`document_sequences`), and the TypeScript allocator repeated it, blocking every loan application (WO-49). Two backends write these tables: fix raw SQL in `apps/api`, then grep `apps/web/lib` and `apps/web/app/api` for the same table, and vice versa.
2. **Timestamps are `timestamp without time zone`.** Prisma writes UTC; `NOW()` stores the session's wall clock. A non-UTC session made every token issued after a password change look older than the revocation marker. The pool pins `timezone=UTC` in `main.go` — **never remove it** — and remember a `psql` session shows *its* timezone.

## Seeding and reset

| Command | Does |
|---|---|
| `pnpm db:seed` | `system_config` defaults (backfilling empty rows), the donation pool, the first admin **only if no loginable admin exists**; idempotent, never invents or resets a password |
| `pnpm db:clear` | deletes everything except the admin, gallery, `system_config` and the donation pool (local databases only, `--confirm`) |

Both scripts and `transaction_repository.go` name the same pool owner (`system_donation_fund`), pinned by `donation-pool-owner.test.ts`.
