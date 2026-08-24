//go:build integration

// Withdrawal policy, and the default threshold.
//
// `loan.missedPaymentsForDefault` was one of two admin settings that were
// editable and read by nothing until 2026-08-18 — a control reporting a policy
// the system did not apply. Its tests assert the rule in BOTH directions,
// refused below the threshold and allowed at it, because a rule that only ever
// refuses is indistinguishable from a broken feature and one that only ever
// allows is indistinguishable from no rule.
//
// The other was `loan.noticePeriodMonths`, which became FR-08's notice period
// and has since been removed entirely (ADR-030). What is left here in its place
// asserts that no gate remains — see the section below for why that is worth a
// test at all.
//
//	scripts/test-stack.sh up
//	eval "$(scripts/test-stack.sh env)"
//	cd apps/api && go test ./internal/repositories/ -tags=integration -count=1
package repositories

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Withdrawals after ADR-030 — no notice, no notice period
// ---------------------------------------------------------------------------
//
// FR-08 used to make a member's withdrawal *request* a binding notice and gate
// both payout paths on it maturing. The owner removed that rule: staff take the
// request in person and pay at the desk, and `loan.noticePeriodDays` is the
// courtesy period the foundation publishes rather than a gate in this code.
//
// These tests are what stops it coming back. Two of them assert the absence of
// a refusal, which is the only way to pin a rule that has been deleted — and
// the settlement tests below them assert what did NOT change: one posting per
// withdrawal, and the ledger summing to what left the account.

// The headline behaviour. Before ADR-030 this was ErrNoWithdrawalNotice.
func TestWithdrawalWithNoRequestBehindItIsPaid(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")

	receipt, err := repo.AddMemberWithdrawal(ctx, member, worker, 5000, "paid at the desk")
	if err != nil {
		t.Fatalf("payout with no request on file was refused: %v", err)
	}
	if receipt == "" {
		t.Error("payout returned an empty receipt number")
	}
	if got := savingsOf(t, member); got != 15000 {
		t.Errorf("savings = %d after the payout, want 15000", got)
	}

	// One CONFIRMED row, written by the payout itself.
	var rows int
	var status string
	var ledger int64
	if err := testPool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(MAX(status::text), ''), COALESCE(SUM(amount), 0)::bigint
		FROM transactions WHERE "userId" = $1 AND type = 'WITHDRAWAL'
	`, member).Scan(&rows, &status, &ledger); err != nil {
		t.Fatalf("read the posting: %v", err)
	}
	if rows != 1 || status != "CONFIRMED" || ledger != 5000 {
		t.Errorf("ledger has %d WITHDRAWAL row(s), status %s, summing %d; want 1 CONFIRMED row of 5000",
			rows, status, ledger)
	}
}

// A payout that is not settling anything must not be held up by a stale
// request either — including one filed minutes ago, which under the old rule
// was the most-refused case of all.
func TestAFreshRequestIsPaidImmediately(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")

	// createdAt = NOW(), which is what a member's own request used to look like
	// on day one of a three-month period.
	fileWithdrawalRequest(t, member, 5000, 0)

	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 5000, "same day"); err != nil {
		t.Fatalf("payout against a request filed today was refused: %v", err)
	}
	if got := savingsOf(t, member); got != 15000 {
		t.Errorf("savings = %d, want 15000", got)
	}
}

// An outstanding request becomes the posting. Two rows would mean every total
// over `transactions` counted the same withdrawal twice.
func TestASettledRequestBecomesThePostingRatherThanASecondRow(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")

	requestID := fileWithdrawalRequest(t, member, 5000, 12)
	receipt, err := repo.AddMemberWithdrawal(ctx, member, worker, 5000, "settled")
	if err != nil {
		t.Fatalf("payout: %v", err)
	}

	var rows int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE type = 'WITHDRAWAL'`).Scan(&rows); err != nil {
		t.Fatalf("count withdrawal rows: %v", err)
	}
	if rows != 1 {
		t.Errorf("%d WITHDRAWAL rows after settling one request, want 1", rows)
	}

	var status, storedReceipt string
	if err := testPool.QueryRow(ctx,
		`SELECT status::text, COALESCE("receiptNumber", '') FROM transactions WHERE id = $1`,
		requestID).Scan(&status, &storedReceipt); err != nil {
		t.Fatalf("read settled request: %v", err)
	}
	if status != "CONFIRMED" {
		t.Errorf("settled request status = %s, want CONFIRMED", status)
	}
	if storedReceipt != receipt {
		t.Errorf("settled request carries receipt %q, want %q", storedReceipt, receipt)
	}
}

// A request covers any amount up to what it asked for. Above that it is a
// different withdrawal, which used to be a refusal and is now simply its own
// row — the request is left outstanding for the money it still represents.
func TestAPayoutAboveTheRequestWritesItsOwnRow(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")
	requestID := fileWithdrawalRequest(t, member, 10000, 1)

	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 12000, "more than asked for"); err != nil {
		t.Fatalf("payout above the request was refused: %v", err)
	}
	if got := savingsOf(t, member); got != 8000 {
		t.Errorf("savings = %d, want 8000", got)
	}

	var status string
	if err := testPool.QueryRow(ctx,
		`SELECT status::text FROM transactions WHERE id = $1`, requestID).Scan(&status); err != nil {
		t.Fatalf("read the untouched request: %v", err)
	}
	if status != "PENDING" {
		t.Errorf("the request is %s after a larger payout, want PENDING — a payout it did not cover consumed it", status)
	}
}

// Settling for less than was asked must record what was PAID, not what was
// asked. Leaving the announced figure would debit 6,000 and tell the ledger
// 10,000 — a passbook that cannot be reconciled against the balance beside it,
// which is the ADR-015 class of defect in a new place.
func TestASettledRequestRecordsWhatWasPaid(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")
	fileWithdrawalRequest(t, member, 10000, 1)

	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 6000, "less than asked for"); err != nil {
		t.Fatalf("payout below the request: %v", err)
	}
	if got := savingsOf(t, member); got != 14000 {
		t.Errorf("savings = %d, want 14000", got)
	}

	var ledger int64
	if err := testPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)::bigint
		FROM transactions
		WHERE "userId" = $1 AND type = 'WITHDRAWAL' AND status = 'CONFIRMED'
	`, member).Scan(&ledger); err != nil {
		t.Fatalf("sum settled withdrawals: %v", err)
	}
	if ledger != 6000 {
		t.Errorf("ledger records %d withdrawn, but 6000 left the account — the passbook cannot be reconciled", ledger)
	}
}

// The general form: for any mixture of requested and unrequested payouts,
// confirmed withdrawals must sum to exactly what left the account.
func TestWithdrawalsReconcileAgainstTheBalance(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 30000)
	worker := seedStaff(t, "w1", "WORKER")

	// Two settled against a request for more than was taken, one with no
	// request behind it at all.
	for _, pair := range [][2]int64{{10000, 6000}, {8000, 8000}, {0, 1000}} {
		if pair[0] > 0 {
			fileWithdrawalRequest(t, member, pair[0], 1)
		}
		if _, err := repo.AddMemberWithdrawal(ctx, member, worker, pair[1], "partial"); err != nil {
			t.Fatalf("payout of %d against a request of %d: %v", pair[1], pair[0], err)
		}
	}

	const paid = 6000 + 8000 + 1000
	if got := savingsOf(t, member); got != 30000-paid {
		t.Errorf("savings = %d, want %d", got, 30000-paid)
	}

	var ledger int64
	if err := testPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)::bigint
		FROM transactions
		WHERE "userId" = $1 AND type = 'WITHDRAWAL' AND status = 'CONFIRMED'
	`, member).Scan(&ledger); err != nil {
		t.Fatalf("sum settled withdrawals: %v", err)
	}
	if ledger != paid {
		t.Errorf("ledger sum = %d, want %d — the balance and the passbook disagree", ledger, paid)
	}
}

// The guarantor lock is FR-09 and survives ADR-030 untouched: what was removed
// is the notice period, not the rule that a guarantor's savings are committed.
func TestAPayoutIsStillRefusedWhileGuaranteeingALoan(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	worker := seedStaff(t, "w1", "WORKER")
	seedLoanWithGuarantor(t, borrower, guarantor, 10000)

	_, err := repo.AddMemberWithdrawal(ctx, guarantor, worker, 1000, "")
	if !errors.Is(err, ErrGuarantorBlocksWithdrawal) {
		t.Fatalf("payout to a guarantor on an active loan: err = %v, want ErrGuarantorBlocksWithdrawal", err)
	}
	if got := savingsOf(t, guarantor); got != 30000 {
		t.Errorf("savings = %d after a refused payout, want 30000", got)
	}
}

// Approving a withdrawal request no longer waits on anything. Under the old
// rule this returned ErrNoticePeriodNotElapsed for the first three months.
func TestApprovingAWithdrawalDoesNotWaitOnANoticePeriod(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	admin := seedStaff(t, "a1", "ADMIN")

	requestID := fileWithdrawalRequest(t, member, 5000, 0)
	if err := repo.ApproveWithdrawal(ctx, requestID, admin); err != nil {
		t.Fatalf("approval of a request filed today: %v", err)
	}

	// Approval readies the request; it does not move money. The debit happens
	// when a worker pays it.
	var status string
	if err := testPool.QueryRow(ctx,
		`SELECT status::text FROM transactions WHERE id = $1`, requestID).Scan(&status); err != nil {
		t.Fatalf("read the approved request: %v", err)
	}
	if status != "PROCESSED" {
		t.Errorf("approved request status = %s, want PROCESSED", status)
	}
	if got := savingsOf(t, member); got != 20000 {
		t.Errorf("savings = %d after an approval, want 20000 — approving must move no money", got)
	}
}

// ---------------------------------------------------------------------------
// loan.missedPaymentsForDefault
// ---------------------------------------------------------------------------

// seedLoanBehindBy inserts an ACTIVE loan whose schedule started `months` ago
// with nothing paid, so exactly `months` instalments are overdue.
func seedLoanBehindBy(t *testing.T, borrower, guarantor string, remaining int64, months int) string {
	t.Helper()
	var loanID string
	err := testPool.QueryRow(context.Background(), `
		INSERT INTO loans (id, "loanNumber", "accountId", "borrowerId", "guarantorId",
			"principalAmount", "remainingAmount", "totalInstallments", "paidInstallments",
			"installmentAmount", purpose, status, "disbursementDate", "installmentStartDate",
			"createdAt", "updatedAt")
		VALUES (gen_random_uuid()::text, 'LOAN-ARREARS-' || $1, 'acct_' || $1, $1, $2,
			$3, $3, 12, 0, ($3/12)::bigint, 'arrears', 'ACTIVE',
			NOW() - ($4 || ' months')::interval,
			NOW() - ($4 || ' months')::interval,
			NOW(), NOW())
		RETURNING id
	`, borrower, guarantor, remaining, months).Scan(&loanID)
	if err != nil {
		t.Fatalf("seed loan in arrears: %v", err)
	}
	return loanID
}

func TestALoanCannotBeDefaultedBelowTheMissedPaymentThreshold(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	admin := seedStaff(t, "a1", "ADMIN")
	setConfig(t, "loan.missedPaymentsForDefault", "3")

	// Two instalments overdue against a policy of three.
	loanID := seedLoanBehindBy(t, borrower, guarantor, 12000, 2)

	err := repo.MarkLoanDefaulted(ctx, loanID, admin, "too early")
	if !errors.Is(err, ErrLoanNotYetDefaultable) {
		t.Fatalf("default at two missed payments: err = %v, want ErrLoanNotYetDefaultable", err)
	}

	// Nothing was taken. This is the assertion that matters: the waterfall
	// drains the borrower's savings and then the guarantor's, and a default
	// that should not have happened is not reversible by editing a row.
	if got := savingsOf(t, borrower); got != 20000 {
		t.Errorf("borrower savings = %d after a refused default, want 20000", got)
	}
	if got := savingsOf(t, guarantor); got != 30000 {
		t.Errorf("guarantor savings = %d after a refused default, want 30000", got)
	}

	var status string
	if err := testPool.QueryRow(ctx, `SELECT status::text FROM loans WHERE id = $1`, loanID).Scan(&status); err != nil {
		t.Fatalf("read loan: %v", err)
	}
	if status != "ACTIVE" {
		t.Errorf("loan status = %s after a refused default, want ACTIVE", status)
	}
}

func TestALoanCanBeDefaultedAtTheMissedPaymentThreshold(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 5000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	admin := seedStaff(t, "a1", "ADMIN")
	setConfig(t, "loan.missedPaymentsForDefault", "3")

	loanID := seedLoanBehindBy(t, borrower, guarantor, 12000, 3)

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "three missed"); err != nil {
		t.Fatalf("default at three missed payments: %v", err)
	}

	var status string
	if err := testPool.QueryRow(ctx, `SELECT status::text FROM loans WHERE id = $1`, loanID).Scan(&status); err != nil {
		t.Fatalf("read loan: %v", err)
	}
	if status != "DEFAULTED" {
		t.Errorf("loan status = %s, want DEFAULTED", status)
	}
	// The waterfall took the borrower's savings first.
	if got := savingsOf(t, borrower); got != 0 {
		t.Errorf("borrower savings = %d after settlement, want 0", got)
	}
}

// The threshold is a policy an admin sets, so raising it must actually make a
// loan undefaultable that was defaultable a moment ago.
func TestRaisingTheThresholdProtectsALoanThatWasDefaultable(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	admin := seedStaff(t, "a1", "ADMIN")

	loanID := seedLoanBehindBy(t, borrower, guarantor, 12000, 4)

	setConfig(t, "loan.missedPaymentsForDefault", "6")
	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "four missed, policy says six"); !errors.Is(err, ErrLoanNotYetDefaultable) {
		t.Fatalf("default at four missed against a policy of six: err = %v, want ErrLoanNotYetDefaultable", err)
	}

	setConfig(t, "loan.missedPaymentsForDefault", "4")
	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "four missed, policy says four"); err != nil {
		t.Fatalf("default at four missed against a policy of four: %v", err)
	}
}

// A loan that was approved but never put on a schedule has nothing overdue, so
// it cannot be defaulted. Before the threshold existed it could be, on the day
// it was created.
func TestALoanWithNoScheduleCannotBeDefaulted(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	admin := seedStaff(t, "a1", "ADMIN")

	var loanID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO loans (id, "loanNumber", "accountId", "borrowerId", "guarantorId",
			"principalAmount", "remainingAmount", "totalInstallments", "paidInstallments",
			"installmentAmount", purpose, status, "createdAt", "updatedAt")
		VALUES (gen_random_uuid()::text, 'LOAN-NOSCHED', 'acct_' || $1, $1, $2,
			12000, 12000, 12, 0, 1000, 'no schedule', 'ACTIVE', NOW(), NOW())
		RETURNING id
	`, borrower, guarantor).Scan(&loanID); err != nil {
		t.Fatalf("seed unscheduled loan: %v", err)
	}

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "never scheduled"); !errors.Is(err, ErrLoanNotYetDefaultable) {
		t.Fatalf("default on a loan with no schedule: err = %v, want ErrLoanNotYetDefaultable", err)
	}
	if got := savingsOf(t, borrower); got != 20000 {
		t.Errorf("borrower savings = %d, want 20000 untouched", got)
	}
}

// Paying instalments moves a borrower back out of default range.
func TestPaidInstalmentsCountAgainstTheMissedTotal(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	admin := seedStaff(t, "a1", "ADMIN")
	setConfig(t, "loan.missedPaymentsForDefault", "3")

	loanID := seedLoanBehindBy(t, borrower, guarantor, 12000, 4)
	// Four due, two paid — two missed, under the threshold.
	if _, err := testPool.Exec(ctx,
		`UPDATE loans SET "paidInstallments" = 2 WHERE id = $1`, loanID); err != nil {
		t.Fatalf("record payments: %v", err)
	}

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "two missed"); !errors.Is(err, ErrLoanNotYetDefaultable) {
		t.Fatalf("default with two of four instalments paid: err = %v, want ErrLoanNotYetDefaultable", err)
	}
}

// The borrower must be told. A default takes their savings and then their
// guarantor's, and a balance that changed with no message behind it is the
// worst way to learn.
func TestDefaultNotifiesTheBorrower(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 5000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	admin := seedStaff(t, "a1", "ADMIN")

	loanID := seedLoanBehindBy(t, borrower, guarantor, 12000, 6)
	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "six missed"); err != nil {
		t.Fatalf("default: %v", err)
	}

	var message string
	if err := testPool.QueryRow(ctx, `
		SELECT message FROM notifications
		WHERE "targetUserId" = $1 AND title = 'Loan marked defaulted'
	`, borrower).Scan(&message); err != nil {
		t.Fatalf("no default notification reached the borrower: %v", err)
	}
	// Whole taka with a separator, never paisa — the notify package's rule,
	// asserted here against a real row rather than only against the builder.
	if !strings.Contains(message, "BDT 12,000") {
		t.Errorf("default notification does not state the debt as whole taka: %q", message)
	}
	if strings.Contains(message, ".00") {
		t.Errorf("default notification prints paisa: %q", message)
	}
}
