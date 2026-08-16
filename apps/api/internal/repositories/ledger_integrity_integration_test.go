//go:build integration

package repositories

// Regression guards for the ledger defects found in the 2026-08-17 audit
// (LEDGER-01 → LEDGER-04, work orders WO-41 → WO-43).
//
// The whole batch existed because the suite next door was green over all of it.
// It was green for two specific reasons, and each test here closes one:
//
//   - Nothing in it ever ran two postings at once, so a read-modify-write on a
//     balance looked correct. Twenty concurrent deposits left one deposit's
//     worth of money in the account and twenty rows in the ledger.
//   - Every waterfall test seeded a guarantor, so the nullable "guarantorId"
//     column's real path — a loan below the guarantor threshold — never
//     executed once.
//
// Both are cheap to test and were invisible without the test. Add to this file
// rather than the general one when the thing under test is *arithmetic
// integrity* rather than a business rule.

import (
	"context"
	"strings"
	"sync"
	"testing"
)

// seedLoanNoGuarantor inserts an ACTIVE loan with "guarantorId" left NULL —
// what the schema allows and what every loan below the guarantor threshold
// looks like. The sibling helper in integration_test.go always sets one, which
// is exactly how LEDGER-02 survived.
func seedLoanNoGuarantor(t *testing.T, borrower string, remaining int64) string {
	t.Helper()
	var loanID string
	err := testPool.QueryRow(context.Background(), `
		INSERT INTO loans (id, "loanNumber", "accountId", "borrowerId",
			"principalAmount", "remainingAmount", "totalInstallments",
			"installmentAmount", status, "createdAt", "updatedAt")
		VALUES (gen_random_uuid()::text, 'LOAN-TEST-NOGUAR', 'acct_' || $1, $1,
			$2, $2, 10, 100, 'ACTIVE', NOW(), NOW())
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

// TestConcurrentDepositsAllLand is the direct regression test for the measured
// defect: 20 parallel deposits of 1,000 produced a balance of 1,000 against
// 20,000 of transaction rows.
//
// The balance and the ledger are asserted separately on purpose. Either alone
// can look right while the pair is wrong, and it is the *disagreement* that
// makes a passbook unexplainable to the member holding it.
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

// TestConcurrentWithdrawalsCannotOverdraw covers the mirror case, which was the
// more expensive of the two: ten parallel withdrawals of 5,000 all cleared a
// 10,000 balance, paying out 50,000.
//
// The count is asserted as well as the balance because a correct final balance
// can still hide an overdraw that a later deposit happened to cover.
func TestConcurrentWithdrawalsCannotOverdraw(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 10000)
	worker := seedStaff(t, "w1", "WORKER")

	const attempts = 10
	const each = 5000 // the balance covers exactly two

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

	var paidOut int64
	if err := testPool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0)::bigint FROM transactions WHERE type = 'WITHDRAWAL'`).Scan(&paidOut); err != nil {
		t.Fatalf("sum withdrawals: %v", err)
	}
	if paidOut != 10000 {
		t.Errorf("paid out %d against a 10000 balance", paidOut)
	}
}

// TestConcurrentDepositsAllocateDistinctReceipts guards the other shared
// resource a parallel posting touches. Receipt numbers are printed in paper
// passbooks, so a collision is unrecoverable after the fact.
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

// TestWaterfallRecoversWithoutAGuarantor is the regression test for a loan
// whose "guarantorId" is NULL. Before the fix the waterfall aborted on the NULL
// scan before step 1, and because MarkLoanDefaulted committed the status change
// in a separate transaction the loan was left DEFAULTED with nothing recovered.
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

// TestUnguaranteedDefaultLeavesResidualDebt confirms the null-guarantor path
// still follows the policy when the borrower cannot cover the debt: skip the
// absent guarantor, fall through to the donation pool, leave the rest standing.
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

// TestMarkingDefaultedIsAtomic pins the transaction boundary itself.
//
// A loan id that does not exist makes the waterfall's first statement return no
// rows, so the whole call must fail having changed nothing. Before the fix the
// status UPDATE had already been committed by the time recovery ran, so a
// failure left a defaulted loan that had never been settled.
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

// TestGuarantorSeesPendingRequest guards two defects that together made the
// member dashboard's guarantee panel permanently empty, neither of which could
// fail loudly:
//
//   - the SELECT listed five columns and the Scan took four, so every row
//     errored into a `continue`;
//   - it filtered on the legacy `PENDING` status while a guarantee request is
//     created as `PENDING_GUARANTOR`.
//
// Either one alone hides the request. Both were live, so a member nominated as
// guarantor was never told, and the loan sat in PENDING_GUARANTOR forever.
func TestGuarantorSeesPendingRequest(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)

	var loanID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO loans (id, "loanNumber", "accountId", "borrowerId", "guarantorId",
			"principalAmount", "remainingAmount", "totalInstallments",
			"installmentAmount", status, "createdAt", "updatedAt")
		VALUES (gen_random_uuid()::text, 'LOAN-TEST-PENDGUAR', 'acct_' || $1, $1, $2,
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

// TestMemberLoansDoesNotLeakOtherMembers pins SEC-13.
//
// GetMemberLoans used to return `availableGuarantors`: the name and savings
// balance of the 50 wealthiest other members, ordered by balance descending, to
// any signed-in member. product.md is explicit that a member cannot see another
// member's data. Nothing consumed it, so it was disclosure with no feature.
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

// seedDonationAccount creates the real HN-ACC-DONATION account that
// RecordDonation posts into. seedDonationPool next door only inserts DONATION
// ledger rows, which is enough for the waterfall (it sums transactions) but not
// for recording a donation, which needs the account row to lock.
func seedDonationAccount(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	const owner = "donation_fund"
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
		INSERT INTO accounts (id, "accountNumber", "savingsBalance", "loanBalance",
			"isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
		VALUES ('acct_' || $1, 'HN-ACC-DONATION', 0, 0, false, 0, NOW(), NOW(), $1)
	`, owner); err != nil {
		t.Fatalf("seed donation account: %v", err)
	}
	return owner
}

// TestDonationsAreSequentialAndAudited covers both halves of LEDGER-04 at once.
// The receipt number used to be a wall-clock stamp to the second, so two
// donations recorded in the same second collided; and RecordDonation was the
// only balance-changing method in the API that wrote no audit row.
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
