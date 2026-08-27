-- A schema audit, 2026-08-27. Five things the database was carrying that no
-- longer described anything true.
--
-- Nothing here loses information: every value dropped is either derivable from
-- a column that remains, or was never written by any code path.

-- ---------------------------------------------------------------------------
-- 1. accounts."maxLoanAmount" / accounts."isLoanEligible"
--
-- Neither was ever updated after the account was created. `maxLoanAmount` was
-- inserted as 0 and left there for the life of the account — and two production
-- queries selected it: the admin approvals screen's `maxEligible`, and the
-- `loanEligibility` figure behind the "Loan Eligibility / Max loan limit" tile
-- on every member's home screen. So a member with 50,000 taka saved was told,
-- on the first screen they see, that they may borrow nothing — while the loans
-- page two clicks away computed savings x loan.maxLoanMultiplier and showed the
-- real number. One fact, two homes, kept equal by nobody (ADR-023).
--
-- `isLoanEligible` was never read at all, which is why nobody noticed that the
-- two creation paths disagreed about it: the Next registration route wrote
-- `false` and the Go approval path wrote `true`, for the same member, minutes
-- apart.
--
-- Both are now derived where they are needed, by money.MaxLoanAmount and
-- money.CheckEligibility — the calculation the staff screens and the loans page
-- had always used.
-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "isLoanEligible",
                       DROP COLUMN "maxLoanAmount";

-- ---------------------------------------------------------------------------
-- 2. nominees."photoUrl"
--
-- Registration collects four images (NID front, NID back, member photo,
-- signature) and files them in `documents`. It has never collected a photograph
-- of the nominee, no screen displays one, and no query selects this column.
-- AlterTable
ALTER TABLE "nominees" DROP COLUMN "photoUrl";

-- ---------------------------------------------------------------------------
-- 3. system_config: the key becomes the primary key.
--
-- The `id` was a cuid that nothing selected, joined or referenced — written
-- once and never looked at. What it did do was fill the leftmost column of the
-- table that gets read by hand more than any other with values like
-- `cmpbicztq00192zn69dh1j9w5`, one per setting.
--
-- `document_sequences` has always been keyed on `(series, year)` for the same
-- reason: where a real identifier exists and no row points at this one, the
-- real identifier is the key.
-- AlterTable
ALTER TABLE "system_config" DROP CONSTRAINT "system_config_pkey";
ALTER TABLE "system_config" DROP COLUMN "id";
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_pkey" PRIMARY KEY ("key");

-- The unique index on `key` is what the primary key now provides. Dropped after
-- the primary key exists, so `ON CONFLICT (key)` is never without one.
-- DropIndex
DROP INDEX IF EXISTS "system_config_key_key";

-- ---------------------------------------------------------------------------
-- 4. A duplicate index on support_messages.
--
-- There were two: (threadId, createdAt) and (threadId, createdAt DESC). A btree
-- is scannable in either direction, so the second answered no query the first
-- could not, and cost a write on every message sent.
-- DropIndex
DROP INDEX IF EXISTS "idx_support_messages_thread_created_desc";

-- ---------------------------------------------------------------------------
-- 5. The "RequestStatus" enum type.
--
-- No column has ever had this type and no source file names it. Loan
-- applications use "LoanStatus" and deposit/withdrawal requests use
-- "TransactionStatus".
-- DropEnum
DROP TYPE IF EXISTS "RequestStatus";
