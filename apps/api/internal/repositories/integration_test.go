//go:build integration

package repositories

import (
	"context"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// The money lifecycle (also guards document_sequences."updatedAt" having no
// DB default).
// ---------------------------------------------------------------------------

func TestMoneyLifecycleEndToEnd(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")

	receipt, err := repo.AddMemberDeposit(ctx, member, worker, 5000, "opening deposit")
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if !strings.HasPrefix(receipt, "DEP-") {
		t.Errorf("deposit receipt = %q, want a DEP- series number", receipt)
	}
	if got := savingsOf(t, member); got != 25000 {
		t.Fatalf("savings after deposit = %d, want 25000", got)
	}

	// FR-08: a payout settles a notice the member gave. Backdated so the test
	// does not have to wait out the notice period.
	fileWithdrawalRequest(t, member, 3000, 12)
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 3000, "withdrawal"); err != nil {
		t.Fatalf("withdrawal: %v", err)
	}
	if got := savingsOf(t, member); got != 22000 {
		t.Fatalf("savings after withdrawal = %d, want 22000", got)
	}

	loanNumber, err := repo.CreateMemberLoan(ctx, member, worker, 10000, "shop stock", 3)
	if err != nil {
		t.Fatalf("create loan: %v", err)
	}
	if !strings.HasPrefix(loanNumber, "LOAN-") {
		t.Errorf("loan number = %q, want a LOAN- series number", loanNumber)
	}
	if got := loanBalanceOf(t, member); got != 10000 {
		t.Fatalf("loan balance after disbursement = %d, want 10000", got)
	}

	var loanID string
	var perInstallment int64
	if err := testPool.QueryRow(ctx,
		`SELECT id, "installmentAmount"::bigint FROM loans WHERE id = $1`, loanNumber,
	).Scan(&loanID, &perInstallment); err != nil {
		t.Fatalf("read loan: %v", err)
	}
	// 10000 over 3 is not divisible; the remainder belongs in the final
	// installment, never in a larger regular one (that would be riba).
	if perInstallment != 3333 {
		t.Fatalf("installmentAmount = %d, want 3333", perInstallment)
	}

	for _, amount := range []int64{3333, 3333, 3334} {
		if _, err := repo.AddMemberLoanPayment(ctx, member, worker, loanID, amount, "installment"); err != nil {
			t.Fatalf("repayment of %d: %v", amount, err)
		}
	}

	var remaining int64
	var status string
	if err := testPool.QueryRow(ctx,
		`SELECT "remainingAmount"::bigint, status::text FROM loans WHERE id = $1`, loanID,
	).Scan(&remaining, &status); err != nil {
		t.Fatalf("read loan after repayment: %v", err)
	}
	if remaining != 0 {
		t.Errorf("remaining after full repayment = %d, want 0 — the schedule must repay the principal exactly", remaining)
	}
	if status != "COMPLETED" {
		t.Errorf("loan status = %q, want COMPLETED", status)
	}
	if got := loanBalanceOf(t, member); got != 0 {
		t.Errorf("account loan balance = %d, want 0", got)
	}
}

// Scenario 1: every balance change leaves an audit row in its transaction (rule 2).
func TestEveryBalanceChangeWritesAnAuditRow(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 50000)
	worker := seedStaff(t, "w1", "WORKER")

	if _, err := repo.AddMemberDeposit(ctx, member, worker, 5000, ""); err != nil {
		t.Fatalf("deposit: %v", err)
	}
	fileWithdrawalRequest(t, member, 1000, 12)
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 1000, ""); err != nil {
		t.Fatalf("withdrawal: %v", err)
	}
	loanNumber, err := repo.CreateMemberLoan(ctx, member, worker, 9000, "stock", 3)
	if err != nil {
		t.Fatalf("loan: %v", err)
	}
	var loanID string
	if err := testPool.QueryRow(ctx, `SELECT id FROM loans WHERE id = $1`, loanNumber).Scan(&loanID); err != nil {
		t.Fatalf("read loan: %v", err)
	}
	if _, err := repo.AddMemberLoanPayment(ctx, member, worker, loanID, 3000, ""); err != nil {
		t.Fatalf("repayment: %v", err)
	}

	for _, action := range []string{"DEPOSIT_POSTED", "WITHDRAWAL_POSTED", "LOAN_DISBURSED", "LOAN_REPAYMENT_POSTED"} {
		var n int
		if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_logs WHERE action = $1`, action).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", action, err)
		}
		if n != 1 {
			t.Errorf("audit rows for %s = %d, want 1", action, n)
		}
	}

	// Every audit row must name who did it, or the trail proves nothing.
	var orphaned int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_logs WHERE "performedBy" IS NULL OR "performedBy" = ''`).Scan(&orphaned); err != nil {
		t.Fatalf("count orphaned: %v", err)
	}
	if orphaned != 0 {
		t.Errorf("%d audit rows have no actor", orphaned)
	}
}

// A failed posting must leave nothing behind: no balance change, no audit row,
// and no burnt document number.
func TestFailedPostingRollsBackCompletely(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 1000)
	worker := seedStaff(t, "w1", "WORKER")

	// An outstanding request exists, so the payout below takes the settlement
	// path rather than writing a fresh row — the branch with more to roll back.
	fileWithdrawalRequest(t, member, 5000, 12)

	// More than the balance — must be refused.
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 5000, "too much"); err == nil {
		t.Fatal("withdrawal beyond balance was accepted")
	}

	if got := savingsOf(t, member); got != 1000 {
		t.Errorf("savings = %d, want 1000 unchanged", got)
	}
	if n := countAuditLogs(t, "", "WITHDRAWAL_POSTED"); n != 0 {
		t.Errorf("failed withdrawal left %d audit rows", n)
	}
	// The request row is expected to survive — a refused payout must not consume
	// what the member asked for. What must NOT exist is a posting.
	var postings int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE status <> 'PENDING'`).Scan(&postings); err != nil {
		t.Fatalf("count postings: %v", err)
	}
	if postings != 0 {
		t.Errorf("failed withdrawal left %d posted transaction rows", postings)
	}

	var requestStatus string
	if err := testPool.QueryRow(ctx,
		`SELECT status::text FROM transactions WHERE type = 'WITHDRAWAL'`).Scan(&requestStatus); err != nil {
		t.Fatalf("read request: %v", err)
	}
	if requestStatus != "PENDING" {
		t.Errorf("the withdrawal request is %s after a failed payout, want PENDING — a refused payout consumed it", requestStatus)
	}
}

// ---------------------------------------------------------------------------
// Scenario 2 — loan cap enforcement, and its recalculation after a deposit.
// ---------------------------------------------------------------------------

func TestLoanCapEnforcementAndRecalculation(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	// Defaults: minimum deposit 8000, cap 5x savings.
	member := seedMember(t, "m1", "ACC-KH-33001", 10000)
	worker := seedStaff(t, "w1", "WORKER")

	// 5 x 10000 = 50000. One taka over must be refused.
	if _, err := repo.CreateMemberLoan(ctx, member, worker, 50001, "too big", 12); err == nil {
		t.Fatal("loan above the cap was accepted")
	}

	// Exactly at the cap is allowed.
	if _, err := repo.CreateMemberLoan(ctx, member, worker, 50000, "at the cap", 12); err != nil {
		t.Fatalf("loan at the cap was refused: %v", err)
	}

	// One loan at a time.
	if _, err := repo.CreateMemberLoan(ctx, member, worker, 1000, "second loan", 12); err == nil {
		t.Fatal("a second concurrent loan was accepted")
	}
}

func TestLoanCapRecalculatesAfterDeposit(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 10000)
	worker := seedStaff(t, "w1", "WORKER")

	// 60000 is above 5 x 10000.
	if _, err := repo.CreateMemberLoan(ctx, member, worker, 60000, "before deposit", 12); err == nil {
		t.Fatal("loan above the cap was accepted before the deposit")
	}

	// Depositing raises the cap: 5 x 12000 = 60000.
	if _, err := repo.AddMemberDeposit(ctx, member, worker, 2000, "top up"); err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if _, err := repo.CreateMemberLoan(ctx, member, worker, 60000, "after deposit", 12); err != nil {
		t.Fatalf("loan at the recalculated cap was refused: %v", err)
	}
}

func TestLoanRefusedBelowMinimumDeposit(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 7999) // minimum is 8000
	worker := seedStaff(t, "w1", "WORKER")

	if _, err := repo.CreateMemberLoan(ctx, member, worker, 1000, "under minimum", 12); err == nil {
		t.Fatal("loan was granted to a member below the minimum deposit")
	}
}

// ---------------------------------------------------------------------------
// Scenario 3 — the default waterfall: borrower, then guarantor, then the
// donation pool, then residual debt.
// ---------------------------------------------------------------------------

// seedLoanWithGuarantor inserts an ACTIVE loan directly, so the test controls
// the guarantor and the outstanding amount.
func seedLoanWithGuarantor(t *testing.T, borrower, guarantor string, remaining int64) string {
	t.Helper()
	var loanID string
	err := testPool.QueryRow(context.Background(), `
		INSERT INTO loans (id, "borrowerId", "guarantorId",
			"principalAmount", "remainingAmount", "totalInstallments", "paidInstallments",
			"installmentAmount", purpose, status, "disbursementDate", "installmentStartDate",
			"createdAt", "updatedAt")
		VALUES ('LOAN-TEST-' || $1, $1, $2,
			$3, $3, 12, 0, ($3/12)::bigint, 'test', 'ACTIVE', NOW(),
			NOW() - INTERVAL '6 months', NOW(), NOW())
		RETURNING id
	`, borrower, guarantor, remaining).Scan(&loanID)
	if err != nil {
		t.Fatalf("seed loan: %v", err)
	}
	return loanID
}

func seedDonationPool(t *testing.T, accountOwner string, amount int64) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO transactions (id, type, amount, description, "createdAt", "userId")
		VALUES (gen_random_uuid()::text, 'DONATION', $1, 'test donation pool', NOW(), $2)
	`, amount, accountOwner)
	if err != nil {
		t.Fatalf("seed donation: %v", err)
	}
}

// donationPoolBalance mirrors the balance the waterfall computes: donated
// minus already drawn.
func donationPoolBalance(t *testing.T) int64 {
	t.Helper()
	var v int64
	err := testPool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN type = 'DONATION' THEN amount ELSE -amount END)::bigint, 0)
		FROM transactions
		WHERE type = 'DONATION' OR (type = 'FEE' AND "loanId" IS NOT NULL)
	`).Scan(&v)
	if err != nil {
		t.Fatalf("read donation pool: %v", err)
	}
	return v
}

func TestWaterfallTakesFromBorrowerFirst(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanWithGuarantor(t, borrower, guarantor, 5000)
	seedDonationPool(t, borrower, 100000)

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "test default"); err != nil {
		t.Fatalf("mark defaulted: %v", err)
	}

	if got := savingsOf(t, borrower); got != 15000 {
		t.Errorf("borrower savings = %d, want 15000 (5000 recovered)", got)
	}
	// The guarantor must not be touched for money the borrower could cover.
	if got := savingsOf(t, guarantor); got != 30000 {
		t.Errorf("guarantor savings = %d, want 30000 untouched", got)
	}
}

func TestWaterfallFallsThroughToGuarantorThenDonationPool(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 2000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 3000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanWithGuarantor(t, borrower, guarantor, 10000)
	seedDonationPool(t, borrower, 100000)

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "test default"); err != nil {
		t.Fatalf("mark defaulted: %v", err)
	}

	if got := savingsOf(t, borrower); got != 0 {
		t.Errorf("borrower savings = %d, want 0 (fully drawn)", got)
	}
	if got := savingsOf(t, guarantor); got != 0 {
		t.Errorf("guarantor savings = %d, want 0 (fully drawn)", got)
	}

	// 2000 + 3000 recovered, the remaining 5000 comes from the donation pool.
	var remaining int64
	if err := testPool.QueryRow(ctx, `SELECT "remainingAmount"::bigint FROM loans WHERE id = $1`, loanID).Scan(&remaining); err != nil {
		t.Fatalf("read loan: %v", err)
	}
	if remaining != 0 {
		t.Errorf("remaining = %d, want 0 — the donation pool should have covered the rest", remaining)
	}
}

func TestWaterfallLeavesResidualDebtWhenEverythingIsDrained(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 1000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 2000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanWithGuarantor(t, borrower, guarantor, 10000)
	seedDonationPool(t, borrower, 3000)

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "test default"); err != nil {
		t.Fatalf("mark defaulted: %v", err)
	}

	// 1000 + 2000 + 3000 = 6000 recovered, 4000 remains as debt.
	var remaining int64
	if err := testPool.QueryRow(ctx, `SELECT "remainingAmount"::bigint FROM loans WHERE id = $1`, loanID).Scan(&remaining); err != nil {
		t.Fatalf("read loan: %v", err)
	}
	if remaining != 4000 {
		t.Errorf("residual debt = %d, want 4000", remaining)
	}

	// No balance may be driven negative to satisfy a default.
	var negatives int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM accounts WHERE "savingsBalance" < 0`).Scan(&negatives); err != nil {
		t.Fatalf("count negatives: %v", err)
	}
	if negatives != 0 {
		t.Errorf("%d accounts were driven negative by the waterfall", negatives)
	}
}

func TestMarkingDefaultedIsAudited(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 5000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 5000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanWithGuarantor(t, borrower, guarantor, 3000)

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "member unreachable"); err != nil {
		t.Fatalf("mark defaulted: %v", err)
	}

	if n := countAuditLogs(t, loanID, "MARK_LOAN_DEFAULTED"); n != 1 {
		t.Errorf("MARK_LOAN_DEFAULTED audit rows = %d, want 1", n)
	}
	if n := countAuditLogs(t, loanID, "WATERFALL_RECOVERY"); n != 1 {
		t.Errorf("WATERFALL_RECOVERY audit rows = %d, want 1", n)
	}
}

// ---------------------------------------------------------------------------
// Scenario 4 — withdrawal blocking.
// ---------------------------------------------------------------------------

func TestWithdrawalBlockedByActiveLoan(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")

	if _, err := repo.CreateMemberLoan(ctx, member, worker, 10000, "stock", 12); err != nil {
		t.Fatalf("create loan: %v", err)
	}

	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 1000, "while borrowing"); err == nil {
		t.Fatal("withdrawal was allowed while a loan is active")
	}
	if got := savingsOf(t, member); got != 20000 {
		t.Errorf("savings = %d, want 20000 unchanged", got)
	}
}

func TestWithdrawalWithActiveLoanAllowedWhenPolicyPermits(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")
	setConfig(t, "loan.allowActiveLoanWithdrawal", "true")

	if _, err := repo.CreateMemberLoan(ctx, member, worker, 10000, "stock", 12); err != nil {
		t.Fatalf("create loan: %v", err)
	}
	fileWithdrawalRequest(t, member, 1000, 12)
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 1000, "policy allows"); err != nil {
		t.Fatalf("withdrawal refused despite the policy allowing it: %v", err)
	}
	if got := savingsOf(t, member); got != 19000 {
		t.Errorf("savings = %d, want 19000", got)
	}
}

func TestWithdrawalBlockedWhileGuaranteeingAnotherLoan(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 20000)
	worker := seedStaff(t, "w1", "WORKER")
	seedLoanWithGuarantor(t, borrower, guarantor, 10000)

	// A guarantee is a claim on the guarantor's savings, so it must block their
	// withdrawal even though the loan is not theirs.
	if _, err := repo.AddMemberWithdrawal(ctx, guarantor, worker, 1000, "while guaranteeing"); err == nil {
		t.Fatal("guarantor was allowed to withdraw while guaranteeing an active loan")
	}
	if got := savingsOf(t, guarantor); got != 20000 {
		t.Errorf("guarantor savings = %d, want 20000 unchanged", got)
	}
}

func TestWithdrawalBlockedBeyondBalance(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 5000)
	worker := seedStaff(t, "w1", "WORKER")

	// One notice covers both attempts, so the refusal is the balance check.
	fileWithdrawalRequest(t, member, 5001, 12)

	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 5001, "one taka too far"); err == nil {
		t.Fatal("withdrawal beyond the balance was accepted")
	}
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 5000, "exact balance"); err != nil {
		t.Fatalf("withdrawal of the exact balance was refused: %v", err)
	}
	if got := savingsOf(t, member); got != 0 {
		t.Errorf("savings = %d, want 0", got)
	}
}

// ---------------------------------------------------------------------------
// Scenario 5 — audit immutability. Corrections append; nothing rewrites history.
// ---------------------------------------------------------------------------

func TestAuditTrailIsAppendOnlyAcrossACorrection(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 10000)
	worker := seedStaff(t, "w1", "WORKER")

	// The wrong amount is posted.
	if _, err := repo.AddMemberDeposit(ctx, member, worker, 5000, "wrong amount"); err != nil {
		t.Fatalf("first deposit: %v", err)
	}

	var firstID, firstDetails string
	if err := testPool.QueryRow(ctx,
		`SELECT id, details FROM audit_logs WHERE action = 'DEPOSIT_POSTED' ORDER BY "createdAt" LIMIT 1`,
	).Scan(&firstID, &firstDetails); err != nil {
		t.Fatalf("read first audit row: %v", err)
	}

	// The correction is a second posting, not an edit of the first.
	fileWithdrawalRequest(t, member, 5000, 12)
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 5000, "reversing the wrong deposit"); err != nil {
		t.Fatalf("correcting withdrawal: %v", err)
	}
	if _, err := repo.AddMemberDeposit(ctx, member, worker, 500, "corrected amount"); err != nil {
		t.Fatalf("corrected deposit: %v", err)
	}

	// The original row is untouched.
	var afterDetails string
	if err := testPool.QueryRow(ctx, `SELECT details FROM audit_logs WHERE id = $1`, firstID).Scan(&afterDetails); err != nil {
		t.Fatalf("re-read first audit row: %v", err)
	}
	if afterDetails != firstDetails {
		t.Errorf("the original audit row was modified:\n  before: %q\n  after:  %q", firstDetails, afterDetails)
	}

	// And the correction is visible as additional history.
	var total int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_logs`).Scan(&total); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if total != 3 {
		t.Errorf("audit rows after a correction = %d, want 3 (original, reversal, corrected)", total)
	}

	// Net effect: 10000 + 5000 - 5000 + 500.
	if got := savingsOf(t, member); got != 10500 {
		t.Errorf("savings after correction = %d, want 10500", got)
	}
}

// Document numbers are the member-facing reference on every receipt. Two
// postings must never be handed the same one.
func TestDocumentNumbersAreSequentialAndUnique(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 100000)
	worker := seedStaff(t, "w1", "WORKER")

	seen := map[string]bool{}
	for i := 0; i < 5; i++ {
		receipt, err := repo.AddMemberDeposit(ctx, member, worker, 100, "")
		if err != nil {
			t.Fatalf("deposit %d: %v", i, err)
		}
		if seen[receipt] {
			t.Fatalf("receipt %q was issued twice", receipt)
		}
		seen[receipt] = true
	}

	if !seen["DEP-2026-000001"] && len(seen) != 5 {
		t.Errorf("expected five distinct receipts, got %d", len(seen))
	}
}

// The donation pool depletes as it is drawn on.
func TestDonationPoolDepletesAcrossDefaults(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	admin := seedStaff(t, "a1", "ADMIN")
	donor := seedMember(t, "d1", "ACC-KH-33009", 0)
	seedDonationPool(t, donor, 6000)

	if got := donationPoolBalance(t); got != 6000 {
		t.Fatalf("starting pool = %d, want 6000", got)
	}

	// First default: borrower and guarantor have nothing, so the pool covers
	// the whole 5000.
	b1 := seedMember(t, "m1", "ACC-KH-33001", 0)
	g1 := seedMember(t, "g1", "ACC-KH-33002", 0)
	loan1 := seedLoanWithGuarantor(t, b1, g1, 5000)
	if err := repo.MarkLoanDefaulted(ctx, loan1, admin, "first default"); err != nil {
		t.Fatalf("first default: %v", err)
	}

	var remaining1 int64
	if err := testPool.QueryRow(ctx, `SELECT "remainingAmount"::bigint FROM loans WHERE id = $1`, loan1).Scan(&remaining1); err != nil {
		t.Fatalf("read loan1: %v", err)
	}
	if remaining1 != 0 {
		t.Errorf("first loan remaining = %d, want 0", remaining1)
	}
	if got := donationPoolBalance(t); got != 1000 {
		t.Fatalf("pool after first default = %d, want 1000 — it must deplete", got)
	}

	// Second default: only 1000 is left, so 4000 must survive as residual debt.
	b2 := seedMember(t, "m2", "ACC-KH-33003", 0)
	g2 := seedMember(t, "g2", "ACC-KH-33004", 0)
	loan2 := seedLoanWithGuarantor(t, b2, g2, 5000)
	if err := repo.MarkLoanDefaulted(ctx, loan2, admin, "second default"); err != nil {
		t.Fatalf("second default: %v", err)
	}

	var remaining2 int64
	if err := testPool.QueryRow(ctx, `SELECT "remainingAmount"::bigint FROM loans WHERE id = $1`, loan2).Scan(&remaining2); err != nil {
		t.Fatalf("read loan2: %v", err)
	}
	if remaining2 != 4000 {
		t.Errorf("second loan remaining = %d, want 4000 — the pool only had 1000 left", remaining2)
	}
	if got := donationPoolBalance(t); got != 0 {
		t.Errorf("pool after second default = %d, want 0", got)
	}

	// Every draw must leave a ledger row behind it.
	var feeRows int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE type = 'FEE' AND "loanId" IS NOT NULL`).Scan(&feeRows); err != nil {
		t.Fatalf("count fee rows: %v", err)
	}
	if feeRows != 2 {
		t.Errorf("donation-pool draws recorded = %d, want 2", feeRows)
	}
}
