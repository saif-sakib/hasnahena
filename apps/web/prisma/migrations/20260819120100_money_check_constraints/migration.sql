-- WO-69 — the database's own opinion about money.
--
-- Until now there was not one CHECK constraint in this schema. Every money
-- invariant — no negative balance, no zero-amount posting, no fee — was enforced
-- only in application code, by TWO backends that write the same tables.
--
-- The application enforcement is correct today, and that is not the point. The
-- database is the last layer both backends must pass through, the one that stays
-- true when someone runs a repair query by hand at 2am, and the only one that
-- cannot be bypassed by a future handler that forgets a guard.
--
-- IMPORTANT: `prisma migrate diff` cannot see CHECK constraints, exactly as it
-- cannot see the audit_logs trigger. A future `--from-empty` baseline would drop
-- these silently, and `pnpm db:migrate:check` will not report them as drift.
-- That list is now: the audit_logs immutability trigger, and these.

-- ---------------------------------------------------------------------------
-- Balances
-- ---------------------------------------------------------------------------
-- ADR-015's lost update drove accounts."loanBalance" to -5000 in a measured
-- test. The relative-write rule prevents it and a concurrency census guards the
-- rule; this is what makes the impossible state actually impossible.
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_savings_non_negative" CHECK ("savingsBalance" >= 0),
  ADD CONSTRAINT "accounts_loan_non_negative"    CHECK ("loanBalance" >= 0);

-- ---------------------------------------------------------------------------
-- Postings
-- ---------------------------------------------------------------------------
-- A zero or negative posting is not a correction — corrections are their own
-- rows, because audit_logs is append-only and so is the ledger it describes.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0);

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------
-- `remainingAmount <= principalAmount` is the one most likely to reject a real
-- write, because both repayment and the default waterfall touch it. It is stated
-- deliberately: a loan that owes more than it borrowed is either interest or a
-- bug, and this codebase permits neither.
ALTER TABLE "loans"
  ADD CONSTRAINT "loans_principal_positive"    CHECK ("principalAmount" > 0),
  ADD CONSTRAINT "loans_remaining_in_range"    CHECK ("remainingAmount" >= 0 AND "remainingAmount" <= "principalAmount"),
  ADD CONSTRAINT "loans_installments_positive" CHECK ("totalInstallments" > 0),
  ADD CONSTRAINT "loans_installments_in_range" CHECK ("paidInstallments" >= 0 AND "paidInstallments" <= "totalInstallments");

-- ---------------------------------------------------------------------------
-- Rule 3, as a constraint rather than a convention
-- ---------------------------------------------------------------------------
-- `loans.applicationFee` exists, defaults to 0, and is already pinned in both
-- directions by requirements.test.ts and lifecycle_integration_test.go. This
-- adds no new policy; it moves the guarantee from "a test would catch it" to
-- "the write fails". For a Shariah constraint that is the right layer — Qard
-- al-Hasan permits no fee, and a column named applicationFee is an invitation.
ALTER TABLE "loans"
  ADD CONSTRAINT "loans_zero_fee" CHECK ("applicationFee" = 0);
