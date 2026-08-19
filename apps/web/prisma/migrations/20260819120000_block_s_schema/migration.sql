-- Block S — database correctness, redundancy and indexes (WO-68, WO-71, WO-72).
--
-- HAND-WRITTEN, not the output of `prisma migrate diff`. The generated version
-- was correct about the shape and wrong about the data, in three ways that would
-- each have been silent:
--
--   * it swapped the LoanStatus enum with no UPDATE first, so it fails outright
--     the moment any row still holds PENDING or APPROVED;
--   * it dropped users."presentAddressId" without backfilling the new
--     addresses."userPresentId", which discards every member's present address;
--   * it dropped users."assignedBranch" without looking at what was in it.
--
-- The data steps below come first for exactly that reason. Every one is
-- idempotent-safe on an empty database and correct on a populated one.

-- ---------------------------------------------------------------------------
-- WO-71 · Collapse the legacy LoanStatus values
-- ---------------------------------------------------------------------------
-- `PENDING` and `APPROVED` sat beside the spec-aligned states, and `PENDING` was
-- the column DEFAULT — so every new loan was written into the legacy vocabulary.
-- Two costs already paid: the guarantor panel filtered `PENDING` while
-- applications create `PENDING_GUARANTOR`, so a guarantor never saw their
-- request; and GetLoanStats counted `status = 'PENDING'` as "pending loans",
-- which meant the admin dashboard reported zero pending loans however many were
-- waiting.
--
-- The mapping is derived from how the code already treated them, not guessed:
-- `APPROVED` was accepted everywhere `ACTIVE` was (defaultable, repayable, and
-- summed into outstanding balances), so it *is* ACTIVE. `PENDING` predates the
-- guarantor step and meant "waiting for an admin", which is PENDING_APPROVAL.
UPDATE "loans" SET "status" = 'PENDING_APPROVAL' WHERE "status" = 'PENDING';
UPDATE "loans" SET "status" = 'ACTIVE'           WHERE "status" = 'APPROVED';

BEGIN;
CREATE TYPE "LoanStatus_new" AS ENUM ('PENDING_GUARANTOR', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'SETTLED', 'DEFAULTED', 'REJECTED');
ALTER TABLE "loans" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "loans" ALTER COLUMN "status" TYPE "LoanStatus_new" USING ("status"::text::"LoanStatus_new");
ALTER TYPE "LoanStatus" RENAME TO "LoanStatus_old";
ALTER TYPE "LoanStatus_new" RENAME TO "LoanStatus";
DROP TYPE "LoanStatus_old";
-- The default becomes the first real state rather than a legacy label.
ALTER TABLE "loans" ALTER COLUMN "status" SET DEFAULT 'PENDING_GUARANTOR';
COMMIT;

-- ---------------------------------------------------------------------------
-- WO-72 · Branch becomes a real relation
-- ---------------------------------------------------------------------------
-- `branches` shipped in 0_init and nothing ever read or wrote it, while
-- users."assignedBranch" held a free-text office name with no link to it — and
-- the staff list displayed a third thing again, the permanent-address district.

-- Prisma models @updatedAt with no database default, so add the column with one
-- and then drop it: NOT NULL with no default fails on any existing row.
ALTER TABLE "branches" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "branches" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "users" ADD COLUMN "assignedBranchId" TEXT;

-- Carry across whatever the free-text column held, by exact name or code. A
-- value that matches no branch becomes NULL rather than inventing a row: the
-- point of this change is that a branch is something an admin created on
-- purpose, and silently manufacturing one from a typo is what the old column did.
UPDATE "users" u
   SET "assignedBranchId" = b.id
  FROM "branches" b
 WHERE u."assignedBranch" IS NOT NULL
   AND btrim(u."assignedBranch") <> ''
   AND (lower(btrim(u."assignedBranch")) = lower(b.name)
     OR lower(btrim(u."assignedBranch")) = lower(b.code));

ALTER TABLE "users" DROP COLUMN "assignedBranch";

-- ---------------------------------------------------------------------------
-- WO-72 · Both 1-1 address relations own their key from the same side
-- ---------------------------------------------------------------------------
-- `permanentAddress` put the foreign key on `addresses`; `presentAddress` put it
-- on `users`. Same cardinality, same lifecycle, opposite shape — so every query
-- and every cascade rule was written twice and one was always the surprising
-- one. It also leaked: deleting a user cascaded the permanent address away and
-- orphaned the present one.
ALTER TABLE "addresses" ADD COLUMN "userPresentId" TEXT;

-- Backfill BEFORE dropping the old column. Prisma's generated migration dropped
-- it first, which discards every present address on the table.
UPDATE "addresses" a
   SET "userPresentId" = u.id
  FROM "users" u
 WHERE u."presentAddressId" = a.id;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_presentAddressId_fkey";
DROP INDEX IF EXISTS "users_presentAddressId_key";
ALTER TABLE "users" DROP COLUMN "presentAddressId";

CREATE UNIQUE INDEX "addresses_userPresentId_key" ON "addresses"("userPresentId");

-- Both sides cascade now. Previously only the permanent one did.
ALTER TABLE "addresses" DROP CONSTRAINT IF EXISTS "addresses_userPermanentId_fkey";
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userPermanentId_fkey"
  FOREIGN KEY ("userPermanentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userPresentId_fkey"
  FOREIGN KEY ("userPresentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_assignedBranchId_fkey"
  FOREIGN KEY ("assignedBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- WO-68 · Index every foreign key
-- ---------------------------------------------------------------------------
-- Two costs, and the second gets missed: reads through an unindexed FK are
-- sequential scans, and so is the foreign-key check Postgres runs when the
-- PARENT row is written — while holding a lock.
--
-- `loans(guarantorId, status)` is composite because every predicate is
-- `guarantorId = ? AND status …`, including a correlated EXISTS evaluated once
-- per row of the member list. The composite answers it from the index rather
-- than reading each candidate row to check its status.
CREATE INDEX "loans_guarantorId_status_idx"          ON "loans"("guarantorId", "status");
CREATE INDEX "loans_accountId_idx"                   ON "loans"("accountId");
CREATE INDEX "transactions_loanId_idx"               ON "transactions"("loanId");
CREATE INDEX "documents_userId_idx"                  ON "documents"("userId");
CREATE INDEX "sse_tickets_userId_idx"                ON "sse_tickets"("userId");
CREATE INDEX "support_threads_processedByUserId_idx" ON "support_threads"("processedByUserId");
CREATE INDEX "users_assignedBranchId_idx"            ON "users"("assignedBranchId");
CREATE INDEX "branches_isActive_name_idx"            ON "branches"("isActive", "name");
