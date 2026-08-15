# Data Model

`apps/web/prisma/schema.prisma` is the single source of truth. The Go API reads the same tables with raw SQL. Schema changes ship via `pnpm db:push` — there are no migration files ([ADR-004](decisions.md)).

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

## Seeding and reset

`pnpm db:clear` (`apps/web/scripts/db-clear-preserve-core.mjs`) deletes everything except the admin user, gallery items, and system config. There is no seed script; the first admin is created manually or preserved across resets.
