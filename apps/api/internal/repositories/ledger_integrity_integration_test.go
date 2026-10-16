//go:build integration

package repositories

// Regression guards for the 2026-08-17 ledger audit (LEDGER-01 → 04): concurrent
// postings and the guarantor-less waterfall. Add here when the subject is
// arithmetic integrity rather than a business rule.

import (
	"context"
	"strings"
	"sync"
	"testing"
)

// seedLoanNoGuarantor inserts an ACTIVE loan with "guarantorId" NULL.
func seedLoanNoGuarantor(t *testing.T, borrower string, remaining int64) string {
	t.Helper()
	var loanID string
	err := testPool.QueryRow(context.Background(), `
		INSERT INTO loans (id, "borrowerId",
			"principalAmount", "remainingAmount", "totalInstallments",
			"installmentAmount", status, "installmentStartDate", "createdAt", "updatedAt")
		VALUES ('LOAN-TEST-NOGUAR', $1,
			$2, $2, 10, 100, 'ACTIVE', NOW() - INTERVAL '6 months', NOW(), NOW())
		RETURNING id
	`, borrower, remaining).Scan(&loanID)
	if err != nil {
		t.Fatalf("seed unguaranteed loan: %v", err)
	}
	return loanID
}

// ---------------------------------------------------------------------------
// LEDGER-01 — concurrent postings must not lose each other.
// ---------------------------------------------------------------------------

// TestConcurrentDepositsAllLand: 20 parallel deposits; balance and ledger are
// asserted separately, since their disagreement is the defect.
func TestConcurrentDepositsAllLand(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 0)
	worker := seedStaff(t, "w1", "WORKER")

	const workers = 20
	const each = 1000

	var wg sync.WaitGroup
	errs := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := repo.AddMemberDeposit(ctx, member, worker, each, "concurrent"); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Fatalf("a concurrent deposit failed outright: %v", err)
	}

	const want = int64(workers * each)

	if got := savingsOf(t, member); got != want {
		t.Errorf("balance = %d, want %d — deposits overwrote each other", got, want)
	}

	var ledger int64
	if err := testPool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0)::bigint FROM transactions WHERE type = 'DEPOSIT'`).Scan(&ledger); err != nil {
		t.Fatalf("sum deposits: %v", err)
	}
	if ledger != want {
		t.Errorf("ledger sum = %d, want %d", ledger, want)
	}
	if got := savingsOf(t, member); got != ledger {
		t.Errorf("balance %d and ledger %d disagree — the passbook cannot be reprinted", got, ledger)
	}
}

// TestConcurrentWithdrawalsCannotOverdraw: ten parallel 5,000 withdrawals
// against 10,000; count and balance both asserted.
func TestConcurrentWithdrawalsCannotOverdraw(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 10000)
	worker := seedStaff(t, "w1", "WORKER")

	const attempts = 10
	const each = 5000 // the balance covers exactly two

	// One notice per attempt, so only the balance limits the outcome.
	for i := 0; i < attempts; i++ {
		fileWithdrawalRequest(t, member, each, 12)
	}

	var wg sync.WaitGroup
	succeeded := make(chan struct{}, attempts)
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := repo.AddMemberWithdrawal(ctx, member, worker, each, "concurrent"); err == nil {
				succeeded <- struct{}{}
			}
		}()
	}
	wg.Wait()
	close(succeeded)

	n := 0
	for range succeeded {
		n++
	}

	if n != 2 {
		t.Errorf("%d withdrawals succeeded, want exactly 2 — the balance covered two", n)
	}
	if got := savingsOf(t, member); got != 0 {
		t.Errorf("final balance = %d, want 0", got)
	}
	if got := savingsOf(t, member); got < 0 {
		t.Fatalf("account overdrawn to %d", got)
	}

	// CONFIRMED only; unpaid PENDING notices are not money out.
	var paidOut int64
	if err := testPool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0)::bigint FROM transactions WHERE type = 'WITHDRAWAL' AND status = 'CONFIRMED'`).Scan(&paidOut); err != nil {
		t.Fatalf("sum withdrawals: %v", err)
	}
	if paidOut != 10000 {
		t.Errorf("paid out %d against a 10000 balance", paidOut)
	}
}

// TestConcurrentDepositsAllocateDistinctReceipts: receipts are printed on paper.
func TestConcurrentDepositsAllocateDistinctReceipts(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 0)
	worker := seedStaff(t, "w1", "WORKER")

	const n = 15
	var wg sync.WaitGroup
	receipts := make(chan string, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if r, err := repo.AddMemberDeposit(ctx, member, worker, 100, "concurrent"); err == nil {
				receipts <- r
			}
		}()
	}
	wg.Wait()
	close(receipts)

	seen := map[string]bool{}
	for r := range receipts {
		if seen[r] {
			t.Errorf("receipt %s was allocated twice", r)
		}
		seen[r] = true
		if !strings.HasPrefix(r, "DEP-") {
			t.Errorf("receipt %q is not in the DEP series", r)
		}
	}
	if len(seen) != n {
		t.Errorf("got %d distinct receipts, want %d", len(seen), n)
	}
}

// ---------------------------------------------------------------------------
// LEDGER-02 — the waterfall must work without a guarantor.
// ---------------------------------------------------------------------------

// TestWaterfallRecoversWithoutAGuarantor: a NULL guarantorId must not abort recovery.
func TestWaterfallRecoversWithoutAGuarantor(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 8000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanNoGuarantor(t, borrower, 5000)

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "no guarantor on this loan"); err != nil {
		t.Fatalf("defaulting an unguaranteed loan: %v", err)
	}

	if got := savingsOf(t, borrower); got != 3000 {
		t.Errorf("borrower savings = %d, want 3000 — 5000 was recoverable", got)
	}

	var status string
	var remaining int64
	if err := testPool.QueryRow(ctx,
		`SELECT status::text, "remainingAmount"::bigint FROM loans WHERE id = $1`, loanID).Scan(&status, &remaining); err != nil {
		t.Fatalf("read loan: %v", err)
	}
	if status != "DEFAULTED" {
		t.Errorf("loan status = %s, want DEFAULTED", status)
	}
	if remaining != 0 {
		t.Errorf("remaining = %d, want 0 — the borrower could cover it", remaining)
	}

	if n := countAuditLogs(t, loanID, "WATERFALL_RECOVERY"); n != 1 {
		t.Errorf("waterfall audit rows = %d, want 1", n)
	}
}

// TestUnguaranteedDefaultLeavesResidualDebt: skip the absent guarantor, use the
// pool, leave the rest standing.
func TestUnguaranteedDefaultLeavesResidualDebt(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 1000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanNoGuarantor(t, borrower, 5000)

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "unrecoverable"); err != nil {
		t.Fatalf("defaulting: %v", err)
	}

	if got := savingsOf(t, borrower); got != 0 {
		t.Errorf("borrower savings = %d, want 0 (fully drawn)", got)
	}

	var remaining int64
	if err := testPool.QueryRow(ctx,
		`SELECT "remainingAmount"::bigint FROM loans WHERE id = $1`, loanID).Scan(&remaining); err != nil {
		t.Fatalf("read loan: %v", err)
	}
	if remaining != 4000 {
		t.Errorf("remaining = %d, want 4000 — no guarantor and an empty pool", remaining)
	}
}

// TestMarkingDefaultedIsAtomic: a failed recovery must change nothing.
func TestMarkingDefaultedIsAtomic(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 8000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanNoGuarantor(t, borrower, 5000)

	if err := repo.MarkLoanDefaulted(ctx, "loan_does_not_exist", admin, "bogus"); err == nil {
		t.Fatal("defaulting a nonexistent loan should fail")
	}

	// The real loan is untouched, and so is the borrower.
	var status string
	if err := testPool.QueryRow(ctx,
		`SELECT status::text FROM loans WHERE id = $1`, loanID).Scan(&status); err != nil {
		t.Fatalf("read loan: %v", err)
	}
	if status != "ACTIVE" {
		t.Errorf("unrelated loan status = %s, want ACTIVE", status)
	}
	if got := savingsOf(t, borrower); got != 8000 {
		t.Errorf("borrower savings = %d, want 8000 untouched", got)
	}
}

// ---------------------------------------------------------------------------
// FR-11 — a nominated guarantor must actually see the request.
// ---------------------------------------------------------------------------

// TestGuarantorSeesPendingRequest: the guarantee panel must show
// PENDING_GUARANTOR requests (FR-11).
func TestGuarantorSeesPendingRequest(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)

	var loanID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO loans (id, "borrowerId", "guarantorId",
			"principalAmount", "remainingAmount", "totalInstallments",
			"installmentAmount", status, "createdAt", "updatedAt")
		VALUES ('LOAN-TEST-PENDGUAR', $1, $2,
			50000, 50000, 10, 5000, 'PENDING_GUARANTOR', NOW(), NOW())
		RETURNING id
	`, borrower, guarantor).Scan(&loanID); err != nil {
		t.Fatalf("seed pending-guarantor loan: %v", err)
	}

	data, err := repo.GetMemberDashboardData(ctx, guarantor)
	if err != nil {
		t.Fatalf("dashboard for guarantor: %v", err)
	}
	if len(data.GuarantorRequests) != 1 {
		t.Fatalf("guarantor sees %d requests, want 1", len(data.GuarantorRequests))
	}

	got := data.GuarantorRequests[0]
	if got.ID != loanID {
		t.Errorf("request id = %s, want the loan id %s", got.ID, loanID)
	}
	if got.LoanAmount != 50000 {
		t.Errorf("loan amount = %d, want 50000", got.LoanAmount)
	}
	if got.BorrowerName == "" {
		t.Error("borrower name is empty — the join or the scan is misaligned")
	}

	// And the borrower must not see their own request as one to approve.
	borrowerData, err := repo.GetMemberDashboardData(ctx, borrower)
	if err != nil {
		t.Fatalf("dashboard for borrower: %v", err)
	}
	if len(borrowerData.GuarantorRequests) != 0 {
		t.Errorf("borrower sees %d guarantee requests, want 0", len(borrowerData.GuarantorRequests))
	}
}

// TestMemberLoansDoesNotLeakOtherMembers pins SEC-13: no other member's
// name or balance in the response.
func TestMemberLoansDoesNotLeakOtherMembers(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 10000)
	seedMember(t, "m2", "ACC-KH-33002", 900000)

	data, err := repo.GetMemberLoans(ctx, member)
	if err != nil {
		t.Fatalf("member loans: %v", err)
	}
	if _, present := data["availableGuarantors"]; present {
		t.Error("SEC-13: member loans response exposes other members' names and balances")
	}
}

// ---------------------------------------------------------------------------
// LEDGER-04 — donations are sequential, and they leave a trail.
// ---------------------------------------------------------------------------

// seedDonationAccount creates the pool account RecordDonation locks. The owner
// id must equal repositories.DonationFundUserID.
func seedDonationAccount(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	const owner = DonationFundUserID
	if _, err := testPool.Exec(ctx, `
		INSERT INTO users (id, email, phone, "passwordHash", role, status,
			"nameEn", "fatherName", "motherName", gender, "maritalStatus", "childrenCount",
			"createdAt", "updatedAt")
		VALUES ($1, $1 || '@test.local', '01999000001', 'x', 'ADMIN', 'ACTIVE',
			'Donation Fund', '-', '-', 'MALE', 'MARRIED', 0, NOW(), NOW())
	`, owner); err != nil {
		t.Fatalf("seed donation fund user: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO accounts ("savingsBalance", "loanBalance",
			"createdAt", "updatedAt", "userId")
		VALUES (0, 0, NOW(), NOW(), $1)
	`, owner); err != nil {
		t.Fatalf("seed donation account: %v", err)
	}
	return owner
}

// TestDonationsAreSequentialAndAudited (LEDGER-04): sequential receipts and an
// audit row.
func TestDonationsAreSequentialAndAudited(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	admin := seedStaff(t, "a1", "ADMIN")
	seedDonationAccount(t)

	first, err := repo.RecordDonation(ctx, admin, 2000, "Abdul Karim", "first")
	if err != nil {
		t.Fatalf("first donation: %v", err)
	}
	second, err := repo.RecordDonation(ctx, admin, 3000, "Fatima Begum", "second")
	if err != nil {
		t.Fatalf("second donation: %v", err)
	}

	// Recorded back to back, so the old wall-clock format would very likely
	// have produced the same string for both.
	if first == second {
		t.Fatalf("both donations got receipt %s", first)
	}
	for _, r := range []string{first, second} {
		if !strings.HasPrefix(r, "DON-") {
			t.Errorf("receipt %q is not in the DON series", r)
		}
	}

	if got := donationPoolBalance(t); got != 5000 {
		t.Errorf("pool = %d, want 5000", got)
	}

	var audited int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_logs WHERE action = 'DONATION_RECORDED'`).Scan(&audited); err != nil {
		t.Fatalf("count donation audit rows: %v", err)
	}
	if audited != 2 {
		t.Errorf("donation audit rows = %d, want 2 — every balance change leaves one", audited)
	}
}
