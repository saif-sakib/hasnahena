//go:build integration

// FR-08 and the default threshold — the two admin settings that were editable
// and read by nothing until 2026-08-18.
//
// Both were the same defect: a control that reports a policy the system does not
// apply. `loan.noticePeriodMonths` sat in the settings page above the words
// "Not enforced yet"; `loan.missedPaymentsForDefault` sat above "a loan is
// marked defaulted manually". An admin could set either and change nothing.
//
// These tests are the reason the words could be removed. Each one asserts the
// policy in BOTH directions — refused below the threshold, allowed at it —
// because a rule that only ever refuses is indistinguishable from a broken
// feature, and one that only ever allows is indistinguishable from no rule.
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
	"time"
)

// ---------------------------------------------------------------------------
// FR-08 — the withdrawal notice period
// ---------------------------------------------------------------------------

// backdateNotice moves a notice's createdAt into the past, which is the only
// way to test a three-month period in a test that runs in three milliseconds.
func backdateNotice(t *testing.T, noticeID string, months int) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		UPDATE transactions
		SET "createdAt" = NOW() - ($2 || ' months')::interval
		WHERE id = $1
	`, noticeID, months)
	if err != nil {
		t.Fatalf("backdate notice %s: %v", noticeID, err)
	}
}

func TestWithdrawalNoticeStartsTheClockAndReportsTheDate(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	setConfig(t, "loan.noticePeriodMonths", "3")

	notice, err := repo.CreateMemberWithdrawalNotice(ctx, member, 5000, "school fees")
	if err != nil {
		t.Fatalf("give notice: %v", err)
	}

	if notice.NoticePeriodMonths != 3 {
		t.Errorf("notice period = %d, want the configured 3", notice.NoticePeriodMonths)
	}
	// Roughly three months out — asserted as a range because month lengths vary
	// and the exact day is the calendar's business, not this test's.
	wait := time.Until(notice.EligibleFrom)
	if wait < 80*24*time.Hour || wait > 95*24*time.Hour {
		t.Errorf("eligible in %v, want about three months", wait)
	}

	// Giving notice moves no money. That is the whole distinction between a
	// notice and a withdrawal.
	if got := savingsOf(t, member); got != 20000 {
		t.Errorf("savings = %d after giving notice, want 20000 unchanged", got)
	}

	var status string
	if err := testPool.QueryRow(ctx,
		`SELECT status::text FROM transactions WHERE id = $1`, notice.RequestID).Scan(&status); err != nil {
		t.Fatalf("read notice: %v", err)
	}
	if status != "PENDING" {
		t.Errorf("notice status = %s, want PENDING", status)
	}
}

func TestWithdrawalIsRefusedBeforeTheNoticePeriodElapses(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")
	setConfig(t, "loan.noticePeriodMonths", "3")

	notice, err := repo.CreateMemberWithdrawalNotice(ctx, member, 5000, "")
	if err != nil {
		t.Fatalf("give notice: %v", err)
	}

	// Two months in: still short.
	backdateNotice(t, notice.RequestID, 2)
	_, err = repo.AddMemberWithdrawal(ctx, member, worker, 5000, "too early")
	if !errors.Is(err, ErrNoticePeriodNotElapsed) {
		t.Fatalf("payout two months into a three-month notice: err = %v, want ErrNoticePeriodNotElapsed", err)
	}
	if got := savingsOf(t, member); got != 20000 {
		t.Errorf("savings = %d after a refused payout, want 20000", got)
	}

	// The error has to say when, or the member is told "no" with no next step.
	if !strings.Contains(err.Error(), "payable from") {
		t.Errorf("refusal does not name the eligible date: %v", err)
	}

	// Three months in: due.
	backdateNotice(t, notice.RequestID, 3)
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 5000, "matured"); err != nil {
		t.Fatalf("payout after the notice period: %v", err)
	}
	if got := savingsOf(t, member); got != 15000 {
		t.Errorf("savings = %d after the payout, want 15000", got)
	}
}

// The notice becomes the posting. Two rows would mean every total over
// `transactions` counted the same withdrawal twice.
func TestASettledNoticeBecomesThePostingRatherThanASecondRow(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")

	noticeID := giveMaturedWithdrawalNotice(t, member, 5000)
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
		t.Errorf("%d WITHDRAWAL rows after settling one notice, want 1", rows)
	}

	var status, storedReceipt string
	if err := testPool.QueryRow(ctx,
		`SELECT status::text, COALESCE("receiptNumber", '') FROM transactions WHERE id = $1`,
		noticeID).Scan(&status, &storedReceipt); err != nil {
		t.Fatalf("read settled notice: %v", err)
	}
	if status != "CONFIRMED" {
		t.Errorf("settled notice status = %s, want CONFIRMED", status)
	}
	if storedReceipt != receipt {
		t.Errorf("settled notice carries receipt %q, want %q", storedReceipt, receipt)
	}
}

// Without a notice there is nothing to pay against. This is the rule-4 half of
// FR-08: a worker settles a member's request, never originates one.
func TestWithdrawalWithoutANoticeIsRefused(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")

	_, err := repo.AddMemberWithdrawal(ctx, member, worker, 5000, "no notice given")
	if !errors.Is(err, ErrNoWithdrawalNotice) {
		t.Fatalf("payout with no notice: err = %v, want ErrNoWithdrawalNotice", err)
	}
	if got := savingsOf(t, member); got != 20000 {
		t.Errorf("savings = %d, want 20000 unchanged", got)
	}
}

// A notice covers any amount up to what it announced: a member who gave notice
// for 10,000 and takes 6,000 is withdrawing less than they said they would.
// More than the notice needs its own notice.
func TestANoticeCoversUpToTheAmountAnnounced(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")
	giveMaturedWithdrawalNotice(t, member, 10000)

	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 12000, "more than announced"); !errors.Is(err, ErrNoWithdrawalNotice) {
		t.Fatalf("payout above the notice: err = %v, want ErrNoWithdrawalNotice", err)
	}
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 6000, "less than announced"); err != nil {
		t.Fatalf("payout below the notice was refused: %v", err)
	}
	if got := savingsOf(t, member); got != 14000 {
		t.Errorf("savings = %d, want 14000", got)
	}

	// **The settled row must carry what was PAID, not what was announced.**
	// Leaving the notice's 10,000 here would debit the account 6,000 and tell
	// the ledger 10,000 — a passbook that cannot be reconciled against the
	// balance beside it, which is the ADR-015 class of defect in a new place.
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

// The general form of the assertion above: for any sequence of notices and
// payouts, confirmed withdrawals must sum to exactly what left the account.
func TestSettledNoticesReconcileAgainstTheBalance(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 30000)
	worker := seedStaff(t, "w1", "WORKER")

	// Three notices, each settled for less than it announced.
	for _, pair := range [][2]int64{{10000, 6000}, {8000, 8000}, {5000, 1000}} {
		giveMaturedWithdrawalNotice(t, member, pair[0])
		if _, err := repo.AddMemberWithdrawal(ctx, member, worker, pair[1], "partial"); err != nil {
			t.Fatalf("payout of %d against a notice of %d: %v", pair[1], pair[0], err)
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

// A notice period of 0 suspends the policy. It is a legitimate configuration —
// a foundation may not run one — and must not silently fall back to 3.
func TestAZeroNoticePeriodPaysImmediately(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	worker := seedStaff(t, "w1", "WORKER")
	setConfig(t, "loan.noticePeriodMonths", "0")

	if _, err := repo.CreateMemberWithdrawalNotice(ctx, member, 5000, ""); err != nil {
		t.Fatalf("give notice: %v", err)
	}
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 5000, "no notice period"); err != nil {
		t.Fatalf("payout under a zero notice period: %v", err)
	}
	if got := savingsOf(t, member); got != 15000 {
		t.Errorf("savings = %d, want 15000", got)
	}
}

// Outstanding notices count against the balance, or a member could give three
// separate notices for their whole balance and present all three once matured.
func TestOutstandingNoticesCountAgainstTheBalance(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 10000)

	if _, err := repo.CreateMemberWithdrawalNotice(ctx, member, 7000, "first"); err != nil {
		t.Fatalf("first notice: %v", err)
	}
	if _, err := repo.CreateMemberWithdrawalNotice(ctx, member, 5000, "second"); err == nil {
		t.Fatal("a second notice taking the total past the balance was accepted")
	}
	// Within what is left, it is fine.
	if _, err := repo.CreateMemberWithdrawalNotice(ctx, member, 3000, "third"); err != nil {
		t.Fatalf("a notice within the remaining balance was refused: %v", err)
	}
}

// The guarantor and active-loan locks apply at notice time as well as payout
// time, so a member finds out now rather than in three months.
func TestNoticeIsRefusedWhileGuaranteeingALoan(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	seedLoanWithGuarantor(t, borrower, guarantor, 10000)

	if _, err := repo.CreateMemberWithdrawalNotice(ctx, guarantor, 1000, ""); err == nil {
		t.Fatal("a guarantor on an active loan was allowed to give notice")
	}
}

// Approving a notice before it matures must fail for the same reason paying it
// does — otherwise the gate is only on one of the two paths.
func TestApprovingAWithdrawalBeforeMaturityIsRefused(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-KH-33001", 20000)
	admin := seedStaff(t, "a1", "ADMIN")
	setConfig(t, "loan.noticePeriodMonths", "3")

	notice, err := repo.CreateMemberWithdrawalNotice(ctx, member, 5000, "")
	if err != nil {
		t.Fatalf("give notice: %v", err)
	}

	if err := repo.ApproveWithdrawal(ctx, notice.RequestID, admin); !errors.Is(err, ErrNoticePeriodNotElapsed) {
		t.Fatalf("approval before maturity: err = %v, want ErrNoticePeriodNotElapsed", err)
	}

	backdateNotice(t, notice.RequestID, 4)
	if err := repo.ApproveWithdrawal(ctx, notice.RequestID, admin); err != nil {
		t.Fatalf("approval after maturity: %v", err)
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
