//go:build integration

// TEST-19 — replay and out-of-order lifecycle, plus TEST-12's BigInt
// boundaries and the rest of TEST-13's waterfall table.
//
// Every test here answers one question: what happens the *second* time. A
// financial system meets that question constantly — a double-tapped button on a
// phone with one bar of signal, a retried request after a timeout, an admin
// coming back to a screen they already actioned. The first call being correct
// says nothing about the second.
package repositories

import (
	"context"
	"errors"
	"math"
	"sync"
	"testing"
)

// statusOfLoan reads a loan's current status.
func statusOfLoan(t *testing.T, loanID string) string {
	t.Helper()
	var status string
	if err := testPool.QueryRow(context.Background(),
		`SELECT status::text FROM loans WHERE id = $1`, loanID).Scan(&status); err != nil {
		t.Fatalf("read loan status: %v", err)
	}
	return status
}

// seedLoanInStatus is seedLoanWithGuarantor with an explicit status, for the
// lifecycle table below.
func seedLoanInStatus(t *testing.T, borrower, guarantor, status string, remaining int64) string {
	t.Helper()
	var loanID string
	var guarantorArg any
	if guarantor != "" {
		guarantorArg = guarantor
	}
	err := testPool.QueryRow(context.Background(), `
		INSERT INTO loans (id, "borrowerId", "guarantorId",
			"principalAmount", "remainingAmount", "totalInstallments", "paidInstallments",
			"installmentAmount", purpose, status, "disbursementDate", "installmentStartDate",
			"createdAt", "updatedAt")
		VALUES ('LOAN-LC-' || gen_random_uuid()::text, $1, $2,
			$3, $3, 12, 0, GREATEST(($3/12)::bigint, 1), 'lifecycle', $4::"LoanStatus", NOW(),
			NOW() - INTERVAL '6 months', NOW(), NOW())
		RETURNING id
	`, borrower, guarantorArg, remaining, status).Scan(&loanID)
	if err != nil {
		t.Fatalf("seed loan in %s: %v", status, err)
	}
	return loanID
}

// ---------------------------------------------------------------------------
// The headline: defaulting a loan twice used to recover twice
// ---------------------------------------------------------------------------

// TestMarkingDefaultedTwiceDoesNotRecoverTwice is the regression test for the
// defect TEST-15 surfaced.
//
// MarkLoanDefaulted ran `UPDATE loans SET status='DEFAULTED' WHERE id = $1` and
// then the recovery waterfall, without ever looking at the status it was
// changing *from*. So a second call re-ran the waterfall against whatever the
// borrower had saved in the meantime — and took it, for a debt already settled
// against them. Two clicks on one button, and money left an account twice.
//
// Verified to fail against the pre-fix code: the second call returned nil and
// the borrower's balance dropped from 4000 to 1000.
func TestMarkingDefaultedTwiceDoesNotRecoverTwice(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-40001", 1000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanNoGuarantor(t, borrower, 4000)

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "first"); err != nil {
		t.Fatalf("first default: %v", err)
	}
	if got := savingsOf(t, borrower); got != 0 {
		t.Fatalf("after the first default the borrower should be drained to 0, got %d", got)
	}

	// The member keeps saving. This is the whole point: the account is not
	// empty when the second click arrives.
	if _, err := testPool.Exec(ctx,
		`UPDATE accounts SET "savingsBalance" = 3000 WHERE "userId" = $1`, borrower); err != nil {
		t.Fatalf("re-fund borrower: %v", err)
	}

	err := repo.MarkLoanDefaulted(ctx, loanID, admin, "second click")
	if !errors.Is(err, ErrLoanNotDefaultable) {
		t.Fatalf("a second default must be refused with ErrLoanNotDefaultable, got %v", err)
	}
	if got := savingsOf(t, borrower); got != 3000 {
		t.Fatalf("the second default took %d taka from a debt already recovered", 3000-got)
	}
}

func TestMarkingDefaultedRejectsAnUnknownLoan(t *testing.T) {
	repo := newTestRepo(t)
	admin := seedStaff(t, "a1", "ADMIN")

	// Previously: UPDATE matched zero rows and reported no error, an audit row
	// was written about a loan nobody has, and the failure surfaced further
	// down as an opaque 500.
	err := repo.MarkLoanDefaulted(context.Background(), "loan-that-does-not-exist", admin, "typo")
	if !errors.Is(err, ErrLoanNotFound) {
		t.Fatalf("want ErrLoanNotFound, got %v", err)
	}
	if n := countAuditLogs(t, "loan-that-does-not-exist", ""); n != 0 {
		t.Fatalf("wrote %d audit rows about a loan that does not exist", n)
	}
}

func TestMarkingDefaultedRejectsAnEmptyLoanID(t *testing.T) {
	repo := newTestRepo(t)
	admin := seedStaff(t, "a1", "ADMIN")

	if err := repo.MarkLoanDefaulted(context.Background(), "   ", admin, ""); !errors.Is(err, ErrLoanIDRequired) {
		t.Fatalf("want ErrLoanIDRequired, got %v", err)
	}
}

// TestOnlyALiveLoanCanBeDefaulted is the state machine, stated as a table.
//
// Defaulting a loan that was never disbursed recovers money against a debt that
// was never lent; defaulting a completed one recovers against a debt already
// repaid. Both used to succeed.
func TestOnlyALiveLoanCanBeDefaulted(t *testing.T) {
	cases := []struct {
		status    string
		allowed   bool
		reasoning string
	}{
		{"ACTIVE", true, "disbursed and outstanding — the only real default"},
		{"PENDING_GUARANTOR", false, "never disbursed; there is nothing to recover"},
		{"PENDING_APPROVAL", false, "never disbursed"},
		{"COMPLETED", false, "already repaid in full"},
		{"SETTLED", false, "already closed"},
		{"REJECTED", false, "never became a loan"},
		{"DEFAULTED", false, "already recovered; this is the double-click case"},
	}

	for _, tc := range cases {
		t.Run(tc.status, func(t *testing.T) {
			repo := newTestRepo(t)
			ctx := context.Background()
			borrower := seedMember(t, "m1", "ACC-KH-41001", 10000)
			admin := seedStaff(t, "a1", "ADMIN")
			loanID := seedLoanInStatus(t, borrower, "", tc.status, 5000)

			err := repo.MarkLoanDefaulted(ctx, loanID, admin, "table")
			if tc.allowed {
				if err != nil {
					t.Fatalf("a %s loan must be defaultable (%s): %v", tc.status, tc.reasoning, err)
				}
				if got := statusOfLoan(t, loanID); got != "DEFAULTED" {
					t.Fatalf("status = %s, want DEFAULTED", got)
				}
				return
			}
			if !errors.Is(err, ErrLoanNotDefaultable) {
				t.Fatalf("a %s loan must not be defaultable (%s), got err=%v", tc.status, tc.reasoning, err)
			}
			// Nothing moved, and the status is untouched.
			if got := savingsOf(t, borrower); got != 10000 {
				t.Fatalf("a refused default still took %d taka", 10000-got)
			}
			if got := statusOfLoan(t, loanID); got != tc.status {
				t.Fatalf("a refused default changed the status to %s", got)
			}
		})
	}
}

// TestConcurrentDefaultsOnOneLoanRecoverOnce is the same defect under a race
// rather than a retry: two admins on two devices, one loan.
//
// The FOR UPDATE on the loan row is what makes this safe — the second
// transaction blocks until the first commits and then sees DEFAULTED.
func TestConcurrentDefaultsOnOneLoanRecoverOnce(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-42001", 10000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanNoGuarantor(t, borrower, 3000)

	const attempts = 6
	var wg sync.WaitGroup
	errs := make([]error, attempts)
	for i := range attempts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = repo.MarkLoanDefaulted(ctx, loanID, admin, "race")
		}(i)
	}
	wg.Wait()

	succeeded := 0
	for _, err := range errs {
		if err == nil {
			succeeded++
		} else if !errors.Is(err, ErrLoanNotDefaultable) {
			t.Fatalf("unexpected error from a losing racer: %v", err)
		}
	}
	if succeeded != 1 {
		t.Fatalf("%d of %d concurrent defaults succeeded; exactly one must", succeeded, attempts)
	}
	if got := savingsOf(t, borrower); got != 7000 {
		t.Fatalf("borrower savings = %d, want 7000 — 3000 recovered exactly once", got)
	}
}

// ---------------------------------------------------------------------------
// TEST-13 — the rest of the waterfall table
// ---------------------------------------------------------------------------

// TestWaterfallTable walks every combination of what the three sources hold.
// The existing suite covered four of these; the ones it did not are where an
// off-by-one in the ordering would hide.
func TestWaterfallTable(t *testing.T) {
	cases := []struct {
		name       string
		debt       int64
		borrower   int64
		guarantor  int64 // -1 means no guarantor at all
		pool       int64
		wantBorrow int64 // balances afterwards
		wantGuar   int64
		wantResid  int64 // remaining debt
	}{
		{"borrower covers it exactly", 5000, 5000, 9000, 9000, 0, 9000, 0},
		{"borrower covers it with room to spare", 5000, 9000, 9000, 9000, 4000, 9000, 0},
		{"borrower has nothing, guarantor covers exactly", 5000, 0, 5000, 9000, 0, 0, 0},
		{"borrower short, guarantor makes up the difference", 5000, 2000, 3000, 9000, 0, 0, 0},
		{"guarantor short too, pool finishes it", 5000, 1000, 1000, 9000, 0, 0, 0},
		{"pool short as well, debt survives", 5000, 1000, 1000, 1000, 0, 0, 2000},
		{"everything empty", 5000, 0, 0, 0, 0, 0, 5000},
		{"no guarantor, borrower covers", 5000, 8000, -1, 9000, 3000, 0, 0},
		{"no guarantor, pool covers the rest", 5000, 1000, -1, 9000, 0, 0, 0},
		{"no guarantor, nothing anywhere", 5000, 0, -1, 0, 0, 0, 5000},
		{"guarantor holds zero", 5000, 0, 0, 9000, 0, 0, 0},
		{"one taka of debt", 1, 0, 0, 1, 0, 0, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := newTestRepo(t)
			ctx := context.Background()

			borrower := seedMember(t, "m1", "ACC-KH-43001", tc.borrower)
			admin := seedStaff(t, "a1", "ADMIN")

			var loanID string
			var guarantor string
			if tc.guarantor >= 0 {
				guarantor = seedMember(t, "m2", "ACC-KH-43002", tc.guarantor)
				loanID = seedLoanWithGuarantor(t, borrower, guarantor, tc.debt)
			} else {
				loanID = seedLoanNoGuarantor(t, borrower, tc.debt)
			}
			if tc.pool > 0 {
				// Funded from a third party so the pool is not confused with a
				// participant's savings.
				donor := seedMember(t, "m3", "ACC-KH-43003", 0)
				seedDonationPool(t, donor, tc.pool)
			}

			if err := repo.MarkLoanDefaulted(ctx, loanID, admin, tc.name); err != nil {
				t.Fatalf("mark defaulted: %v", err)
			}

			if got := savingsOf(t, borrower); got != tc.wantBorrow {
				t.Errorf("borrower savings = %d, want %d", got, tc.wantBorrow)
			}
			if tc.guarantor >= 0 {
				if got := savingsOf(t, guarantor); got != tc.wantGuar {
					t.Errorf("guarantor savings = %d, want %d", got, tc.wantGuar)
				}
			}

			var residual int64
			if err := testPool.QueryRow(ctx,
				`SELECT "remainingAmount"::bigint FROM loans WHERE id = $1`, loanID).Scan(&residual); err != nil {
				t.Fatalf("read remaining: %v", err)
			}
			if residual != tc.wantResid {
				t.Errorf("residual debt = %d, want %d", residual, tc.wantResid)
			}

			// A balance can never be driven below zero by recovery, whatever
			// the combination. This is the invariant the table exists to guard.
			if savingsOf(t, borrower) < 0 {
				t.Errorf("recovery drove the borrower's savings negative")
			}
			if tc.guarantor >= 0 && savingsOf(t, guarantor) < 0 {
				t.Errorf("recovery drove the guarantor's savings negative")
			}
			// And it never recovers more than was owed.
			if residual < 0 {
				t.Errorf("recovered %d more than the debt", -residual)
			}
		})
	}
}

// TestOneGuarantorTwoDefaults covers the case a single loan can never show:
// the same guarantor standing behind two loans that both go bad.
func TestOneGuarantorTwoDefaults(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrowerA := seedMember(t, "m1", "ACC-KH-44001", 0)
	borrowerB := seedMember(t, "m2", "ACC-KH-44002", 0)
	guarantor := seedMember(t, "m3", "ACC-KH-44003", 5000)
	admin := seedStaff(t, "a1", "ADMIN")

	loanA := seedLoanWithGuarantor(t, borrowerA, guarantor, 3000)
	loanB := seedLoanWithGuarantor(t, borrowerB, guarantor, 4000)

	if err := repo.MarkLoanDefaulted(ctx, loanA, admin, "A"); err != nil {
		t.Fatalf("default A: %v", err)
	}
	if err := repo.MarkLoanDefaulted(ctx, loanB, admin, "B"); err != nil {
		t.Fatalf("default B: %v", err)
	}

	// 5000 held, 3000 taken by A, so B may take at most the 2000 left.
	if got := savingsOf(t, guarantor); got != 0 {
		t.Errorf("guarantor savings = %d, want 0", got)
	}
	var residualB int64
	if err := testPool.QueryRow(ctx,
		`SELECT "remainingAmount"::bigint FROM loans WHERE id = $1`, loanB).Scan(&residualB); err != nil {
		t.Fatalf("read remaining: %v", err)
	}
	if residualB != 2000 {
		t.Errorf("loan B residual = %d, want 2000 — the guarantor cannot pay 7000 out of 5000", residualB)
	}
}

// ---------------------------------------------------------------------------
// TEST-12 — BigInt boundaries
// ---------------------------------------------------------------------------

// TestAmountBoundariesAreRefusedOrHandled walks the edges of int64 through the
// deposit path. Whole taka fit in int64 with room to spare (ADR-002 caps a
// single posting at 10 crore), so the interesting question is not arithmetic
// but whether the guards actually fire.
func TestAmountBoundariesAreRefusedOrHandled(t *testing.T) {
	cases := []struct {
		name   string
		amount int64
		wantOK bool
	}{
		{"zero", 0, false},
		{"one taka", 1, true},
		{"negative one", -1, false},
		{"minus the largest deposit", -100000000, false},
		{"math.MinInt64", math.MinInt64, false},
		{"math.MaxInt64", math.MaxInt64, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := newTestRepo(t)
			ctx := context.Background()
			member := seedMember(t, "m1", "ACC-KH-45001", 1000)
			worker := seedStaff(t, "w1", "WORKER")

			_, err := repo.AddMemberDeposit(ctx, member, worker, tc.amount, "boundary")
			if tc.wantOK && err != nil {
				t.Fatalf("deposit of %d should be accepted: %v", tc.amount, err)
			}
			if !tc.wantOK {
				if err == nil {
					t.Fatalf("deposit of %d was accepted; it must be refused", tc.amount)
				}
				// A refused deposit must leave the balance exactly as it was.
				if got := savingsOf(t, member); got != 1000 {
					t.Fatalf("a refused deposit of %d changed the balance to %d", tc.amount, got)
				}
			}
		})
	}
}

// TestASecondDepositCannotOverflowTheBalance proves the cap is what keeps the
// running total inside int64, rather than luck.
func TestASecondDepositCannotOverflowTheBalance(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-46001", math.MaxInt64-10)
	worker := seedStaff(t, "w1", "WORKER")

	// 100 taka on top of a balance 10 short of MaxInt64. PostgreSQL bigint
	// raises `bigint out of range` rather than wrapping, so this must be an
	// error and the balance must be untouched — never a negative balance.
	_, err := repo.AddMemberDeposit(ctx, member, worker, 100, "overflow")
	if err == nil {
		t.Fatalf("a deposit that overflows the balance was accepted")
	}
	if got := savingsOf(t, member); got != math.MaxInt64-10 {
		t.Fatalf("balance moved to %d after a failed deposit", got)
	}
	if n := countAuditLogs(t, member, ""); n != 0 {
		t.Fatalf("a failed deposit wrote %d audit rows", n)
	}
}
