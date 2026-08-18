-- ADR-023. `accounts.accountNumber` held a copy of `users.memberId`.
--
-- Both creation paths assigned it that value (`const accountNumber = memberId`
-- in the registration route, and the same memberID parameter in
-- ApproveRegistration), and approval even re-synced it on every run. Nothing
-- ever read it to find a member's account — those lookups are all by "userId" —
-- so the column's only effect was to print the same string twice on the
-- statement and the membership certificate, under two different labels.
--
-- No information is lost. For a member account the value is still in
-- users."memberId". The one non-member row, the donation pool, was found by the
-- literal 'HN-ACC-DONATION'; it is now found by its owner, the fixed user id
-- 'system_donation_fund' that `pnpm db:seed` assigns.

-- DropIndex
DROP INDEX "accounts_accountNumber_key";

-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "accountNumber";

-- One account per user, which is what every query already assumed: member
-- lookups read WHERE "userId" = $1 and expect a single row, and the donation
-- pool is now located the same way — under FOR UPDATE, on a money path, where
-- a predicate that could match two rows is not acceptable.
--
-- This fails loudly if any user somehow owns two accounts. Nothing in the code
-- creates a second one: registration creates exactly one, and approval checks
-- EXISTS before inserting.
-- CreateIndex
CREATE UNIQUE INDEX "accounts_userId_key" ON "accounts"("userId");
