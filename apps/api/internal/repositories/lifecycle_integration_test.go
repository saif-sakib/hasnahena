//go:build integration

// TEST-22 — the lifecycle state machines, and TEST-21's database half.
//
// The lifecycle is the product's central rule: **Request → Process → Confirm**,
// with workers never initiating money movement (CLAUDE.md rule 4). A state
// machine that only guards the transitions someone remembered to guard is not a
// state machine — it is a happy path with a comment. So these tests drive every
// status a record can hold at every transition, from a table, and require the
// illegal ones to be refused *and to have moved nothing*.
//
// The "moved nothing" half matters as much as the refusal. An approval that is
// rejected after it has already credited an account is worse than one that
// succeeds, because the ledger and the request record then disagree and nothing
// says which is right.
package repositories

import (
	"context"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// seedTransactionInStatus creates a pending-style transaction row in a chosen
// status, so a transition can be attempted *from* it.
func seedTransactionInStatus(t *testing.T, memberID, txType, status string, amount int64) string {
	t.Helper()
	var id string
	err := testPool.QueryRow(context.Background(), `
		INSERT INTO transactions (id, type, amount, description, status,
			"accountId", "userId", "createdAt")
		VALUES (gen_random_uuid()::text, $2::"TransactionType", $3, 'lifecycle',
			$4::"TransactionStatus", 'acct_' || $1, $1, NOW())
		RETURNING id
	`, memberID, txType, amount, status).Scan(&id)
	if err != nil {
		t.Fatalf("seed %s transaction in %s: %v", txType, status, err)
	}
	return id
}

func statusOfTransaction(t *testing.T, id string) string {
	t.Helper()
	var status string
	if err := testPool.QueryRow(context.Background(),
		`SELECT status::text FROM transactions WHERE id = $1`, id).Scan(&status); err != nil {
		t.Fatalf("read transaction status: %v", err)
	}
	return status
}

// allTransactionStatuses is the enum, in full. Driving the table off this
// rather than off a hand-picked subset is what makes a new value fail the test
// until somebody decides what it means here.
var allTransactionStatuses = []string{
	"PENDING", "PROCESSED", "CONFIRMED", "REJECTED", "DISPUTED", "REVERSED",
}

// ---------------------------------------------------------------------------
// Withdrawal / deposit request lifecycle
// ---------------------------------------------------------------------------

func TestOnlyAPendingRequestCanBeApproved(t *testing.T) {
	for _, status := range allTransactionStatuses {
		t.Run("DEPOSIT/"+status, func(t *testing.T) {
			repo := newTestRepo(t)
			ctx := context.Background()
			member := seedMember(t, "m1", "ACC-KH-50001", 1000)
			admin := seedStaff(t, "a1", "ADMIN")
			id := seedTransactionInStatus(t, member, "DEPOSIT", status, 500)

			err := repo.ApproveWithdrawal(ctx, id, admin)

			if status == "PENDING" {
				if err != nil {
					t.Fatalf("a PENDING deposit must be approvable: %v", err)
				}
				if got := savingsOf(t, member); got != 1500 {
					t.Fatalf("approved deposit left the balance at %d, want 1500", got)
				}
				return
			}

			if err == nil {
				t.Fatalf("a %s deposit was approved; only PENDING may be", status)
			}
			// Refused *and* inert: no money moved and the status is untouched.
			if got := savingsOf(t, member); got != 1000 {
				t.Fatalf("a refused approval moved the balance to %d", got)
			}
			if got := statusOfTransaction(t, id); got != status {
				t.Fatalf("a refused approval changed the status to %s", got)
			}
		})
	}
}

func TestOnlyAPendingRequestCanBeRejected(t *testing.T) {
	for _, status := range allTransactionStatuses {
		t.Run("WITHDRAWAL/"+status, func(t *testing.T) {
			repo := newTestRepo(t)
			ctx := context.Background()
			member := seedMember(t, "m1", "ACC-KH-50002", 5000)
			admin := seedStaff(t, "a1", "ADMIN")
			id := seedTransactionInStatus(t, member, "WITHDRAWAL", status, 1000)

			err := repo.RejectWithdrawal(ctx, id, admin, "lifecycle")

			if status == "PENDING" {
				if err != nil {
					t.Fatalf("a PENDING withdrawal must be rejectable: %v", err)
				}
				if got := statusOfTransaction(t, id); got != "REJECTED" {
					t.Fatalf("status = %s, want REJECTED", got)
				}
				// A rejection must never move money, in either direction.
				if got := savingsOf(t, member); got != 5000 {
					t.Fatalf("a rejection moved the balance to %d", got)
				}
				return
			}

			if err == nil {
				t.Fatalf("a %s withdrawal was rejected; only PENDING may be", status)
			}
			if got := statusOfTransaction(t, id); got != status {
				t.Fatalf("a refused rejection changed the status to %s", got)
			}
		})
	}
}

// TestARequestCannotBeApprovedTwice is the replay case for the money path a
// worker touches most often.
func TestARequestCannotBeApprovedTwice(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	member := seedMember(t, "m1", "ACC-KH-50003", 1000)
	admin := seedStaff(t, "a1", "ADMIN")
	id := seedTransactionInStatus(t, member, "DEPOSIT", "PENDING", 2000)

	if err := repo.ApproveWithdrawal(ctx, id, admin); err != nil {
		t.Fatalf("first approval: %v", err)
	}
	if err := repo.ApproveWithdrawal(ctx, id, admin); err == nil {
		t.Fatalf("the same deposit was approved twice")
	}
	if got := savingsOf(t, member); got != 3000 {
		t.Fatalf("balance = %d, want 3000 — the deposit was credited %s",
			got, map[bool]string{true: "twice", false: "not at all"}[got > 3000])
	}
}

func TestARejectedRequestCannotThenBeApproved(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	member := seedMember(t, "m1", "ACC-KH-50004", 1000)
	admin := seedStaff(t, "a1", "ADMIN")
	id := seedTransactionInStatus(t, member, "DEPOSIT", "PENDING", 2000)

	if err := repo.RejectWithdrawal(ctx, id, admin, "wrong reference"); err != nil {
		t.Fatalf("reject: %v", err)
	}
	// The member disputes, the admin reconsiders and clicks approve. Without a
	// guard this credits an account for a request already refused, with the
	// rejection notification already sent.
	if err := repo.ApproveWithdrawal(ctx, id, admin); err == nil {
		t.Fatalf("a REJECTED request was approved")
	}
	if got := savingsOf(t, member); got != 1000 {
		t.Fatalf("balance = %d, want 1000 — a rejected deposit was credited", got)
	}
}

func TestAnApprovedRequestCannotThenBeRejected(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	member := seedMember(t, "m1", "ACC-KH-50005", 1000)
	admin := seedStaff(t, "a1", "ADMIN")
	id := seedTransactionInStatus(t, member, "DEPOSIT", "PENDING", 2000)

	if err := repo.ApproveWithdrawal(ctx, id, admin); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if err := repo.RejectWithdrawal(ctx, id, admin, "changed my mind"); err == nil {
		t.Fatalf("a CONFIRMED request was rejected — the money had already moved")
	}
	if got := savingsOf(t, member); got != 3000 {
		t.Fatalf("balance = %d, want 3000 — a rejection unwound a confirmed deposit", got)
	}
}

func TestApprovingARequestThatDoesNotExist(t *testing.T) {
	repo := newTestRepo(t)
	admin := seedStaff(t, "a1", "ADMIN")
	err := repo.ApproveWithdrawal(context.Background(), "no-such-request", admin)
	if err == nil {
		t.Fatalf("approving a nonexistent request succeeded")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("error should say the request was not found, got %q", err)
	}
}

// ---------------------------------------------------------------------------
// Loan lifecycle
// ---------------------------------------------------------------------------

var allLoanStatuses = []string{
	"PENDING", "APPROVED", "PENDING_GUARANTOR", "PENDING_APPROVAL",
	"ACTIVE", "COMPLETED", "SETTLED", "DEFAULTED", "REJECTED",
}

func TestOnlyAPendingApprovalLoanCanBeApproved(t *testing.T) {
	for _, status := range allLoanStatuses {
		t.Run(status, func(t *testing.T) {
			repo := newTestRepo(t)
			ctx := context.Background()
			borrower := seedMember(t, "m1", "ACC-KH-51001", 20000)
			admin := seedStaff(t, "a1", "ADMIN")
			loanID := seedLoanInStatus(t, borrower, "", status, 5000)

			err := repo.ApproveLoan(ctx, loanID, admin)

			if status == "PENDING_APPROVAL" {
				if err != nil {
					t.Fatalf("a PENDING_APPROVAL loan must be approvable: %v", err)
				}
				if got := statusOfLoan(t, loanID); got != "ACTIVE" {
					t.Fatalf("approved loan is %s, want ACTIVE", got)
				}
				// Approval disburses: the account's loan balance must reflect it.
				if got := loanBalanceOf(t, borrower); got != 5000 {
					t.Fatalf("loanBalance = %d after disbursement, want 5000", got)
				}
				return
			}

			if err == nil {
				t.Fatalf("a %s loan was approved; only PENDING_APPROVAL may be", status)
			}
			if got := statusOfLoan(t, loanID); got != status {
				t.Fatalf("a refused approval changed the status to %s", got)
			}
			if got := loanBalanceOf(t, borrower); got != 0 {
				t.Fatalf("a refused approval disbursed %d", got)
			}
		})
	}
}

func TestOnlyAPendingApprovalLoanCanBeRejected(t *testing.T) {
	for _, status := range allLoanStatuses {
		t.Run(status, func(t *testing.T) {
			repo := newTestRepo(t)
			ctx := context.Background()
			borrower := seedMember(t, "m1", "ACC-KH-51002", 20000)
			admin := seedStaff(t, "a1", "ADMIN")
			loanID := seedLoanInStatus(t, borrower, "", status, 5000)

			err := repo.RejectLoan(ctx, loanID, admin, "insufficient savings")

			if status == "PENDING_APPROVAL" {
				if err != nil {
					t.Fatalf("a PENDING_APPROVAL loan must be rejectable: %v", err)
				}
				if got := statusOfLoan(t, loanID); got != "REJECTED" {
					t.Fatalf("status = %s, want REJECTED", got)
				}
				return
			}

			if err == nil {
				t.Fatalf("a %s loan was rejected; only PENDING_APPROVAL may be", status)
			}
			if got := statusOfLoan(t, loanID); got != status {
				t.Fatalf("a refused rejection changed the status to %s", got)
			}
		})
	}
}

func TestALoanCannotBeApprovedTwice(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	borrower := seedMember(t, "m1", "ACC-KH-51003", 20000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanInStatus(t, borrower, "", "PENDING_APPROVAL", 5000)

	if err := repo.ApproveLoan(ctx, loanID, admin); err != nil {
		t.Fatalf("first approval: %v", err)
	}
	if err := repo.ApproveLoan(ctx, loanID, admin); err == nil {
		t.Fatalf("the same loan was approved twice — it would be disbursed twice")
	}
	if got := loanBalanceOf(t, borrower); got != 5000 {
		t.Fatalf("loanBalance = %d, want 5000 — the loan was disbursed twice", got)
	}
}

// TestRepaymentClosesTheLoanExactlyOnce walks the whole happy path and stops at
// the boundary: the final installment must close the loan, and a payment after
// that must be refused because a COMPLETED loan is no longer active.
func TestRepaymentClosesTheLoanExactlyOnce(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	borrower := seedMember(t, "m1", "ACC-KH-51004", 0)
	worker := seedStaff(t, "w1", "WORKER")
	loanID := seedLoanInStatus(t, borrower, "", "ACTIVE", 3000)
	if _, err := testPool.Exec(ctx,
		`UPDATE accounts SET "loanBalance" = 3000 WHERE "userId" = $1`, borrower); err != nil {
		t.Fatalf("set loan balance: %v", err)
	}

	for i := range 3 {
		if _, err := repo.AddMemberLoanPayment(ctx, borrower, worker, loanID, 1000, "installment"); err != nil {
			t.Fatalf("payment %d: %v", i+1, err)
		}
	}

	if got := statusOfLoan(t, loanID); got != "COMPLETED" {
		t.Fatalf("loan is %s after the final installment, want COMPLETED", got)
	}
	if got := loanBalanceOf(t, borrower); got != 0 {
		t.Fatalf("loanBalance = %d after full repayment, want 0", got)
	}

	// One more taka. Under Qard al-Hasan the member owes the principal and not
	// one taka more, so this must be refused rather than accepted as a credit.
	if _, err := repo.AddMemberLoanPayment(ctx, borrower, worker, loanID, 1, "one too many"); err == nil {
		t.Fatalf("a payment against a COMPLETED loan was accepted")
	}
	if got := loanBalanceOf(t, borrower); got != 0 {
		t.Fatalf("loanBalance = %d after an over-payment, want 0", got)
	}
}

// ---------------------------------------------------------------------------
// TEST-21 — the Shariah invariant, at the database
// ---------------------------------------------------------------------------

// TestTotalRepaidNeverExceedsPrincipal is the invariant, stated over the ledger
// rather than over the arithmetic.
//
// `internal/money` proves the *schedule* sums to the principal. This proves the
// *postings* do: whatever sequence of repayments is accepted, the sum of
// LOAN_REPAYMENT rows for a loan can never exceed what was disbursed. One taka
// more is riba, however it got there.
func TestTotalRepaidNeverExceedsPrincipal(t *testing.T) {
	// Deliberately awkward splits, including ones that do not divide evenly.
	cases := []struct {
		name      string
		principal int64
		payments  []int64
	}{
		{"exact installments", 3000, []int64{1000, 1000, 1000}},
		{"uneven, final absorbs the remainder", 10000, []int64{3333, 3333, 3334}},
		{"one lump sum", 5000, []int64{5000}},
		{"many small payments", 1000, []int64{1, 1, 1, 997}},
		{"a payment larger than what is left", 3000, []int64{2000, 5000, 1000}},
		{"repeated attempts after closing", 1000, []int64{1000, 1000, 1000}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := newTestRepo(t)
			ctx := context.Background()
			borrower := seedMember(t, "m1", "ACC-KH-52001", 0)
			worker := seedStaff(t, "w1", "WORKER")
			loanID := seedLoanInStatus(t, borrower, "", "ACTIVE", tc.principal)
			if _, err := testPool.Exec(ctx,
				`UPDATE accounts SET "loanBalance" = $2 WHERE "userId" = $1`, borrower, tc.principal); err != nil {
				t.Fatalf("set loan balance: %v", err)
			}

			for _, amount := range tc.payments {
				// Errors are expected and ignored: the point is that whatever
				// the caller tries, the ledger cannot end up above the principal.
				_, _ = repo.AddMemberLoanPayment(ctx, borrower, worker, loanID, amount, "invariant")
			}

			var totalRepaid int64
			if err := testPool.QueryRow(ctx, `
				SELECT COALESCE(SUM(amount)::bigint, 0)
				FROM transactions
				WHERE "loanId" = $1 AND type = 'LOAN_REPAYMENT' AND status = 'CONFIRMED'
			`, loanID).Scan(&totalRepaid); err != nil {
				t.Fatalf("sum repayments: %v", err)
			}

			if totalRepaid > tc.principal {
				t.Fatalf("the member repaid %d against a principal of %d — %d taka of riba",
					totalRepaid, tc.principal, totalRepaid-tc.principal)
			}
			// And the loan's own record agrees with the ledger.
			var remaining int64
			if err := testPool.QueryRow(ctx,
				`SELECT "remainingAmount"::bigint FROM loans WHERE id = $1`, loanID).Scan(&remaining); err != nil {
				t.Fatalf("read remaining: %v", err)
			}
			if remaining != tc.principal-totalRepaid {
				t.Fatalf("remaining = %d but principal − repaid = %d", remaining, tc.principal-totalRepaid)
			}
			if remaining < 0 {
				t.Fatalf("remaining went negative: %d", remaining)
			}
		})
	}
}

// TestNoLoanEverCarriesAFee guards the schema's one fee-shaped column.
//
// `loans.applicationFee` exists and defaults to 0. Nothing sets it, which is
// the correct state — but "nothing sets it" is a property of today's code, and
// a column called applicationFee is an invitation. This fails the moment
// anything writes a non-zero value, which is the moment to have the
// conversation rather than after a member has been charged (rule 3).
func TestNoLoanEverCarriesAFee(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-53001", 50000)
	worker := seedStaff(t, "w1", "WORKER")
	admin := seedStaff(t, "a1", "ADMIN")

	// Every path that can bring a loan into existence.
	if _, err := repo.CreateMemberLoan(ctx, borrower, worker, 10000, "worker-created", 12); err != nil {
		t.Fatalf("worker loan: %v", err)
	}
	approvalLoan := seedLoanInStatus(t, borrower, "", "PENDING_APPROVAL", 5000)
	if err := repo.ApproveLoan(ctx, approvalLoan, admin); err != nil {
		t.Fatalf("approve loan: %v", err)
	}

	var maxFee, loanCount int64
	if err := testPool.QueryRow(ctx,
		`SELECT COALESCE(MAX("applicationFee")::bigint, 0), COUNT(*) FROM loans`).Scan(&maxFee, &loanCount); err != nil {
		t.Fatalf("read fees: %v", err)
	}
	if loanCount == 0 {
		t.Fatal("no loans were created, so this proved nothing")
	}
	if maxFee != 0 {
		t.Fatalf("a loan carries an applicationFee of %d — Qard al-Hasan permits no fee (rule 3)", maxFee)
	}

	// And no FEE transaction is ever raised against a member. The waterfall
	// uses type FEE for the donation-pool draw, which is the pool paying the
	// foundation, not the member paying anything — so it always carries a
	// loanId. A FEE row without one would be a charge to a person.
	var memberFees int64
	if err := testPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM transactions WHERE type = 'FEE' AND "loanId" IS NULL
	`).Scan(&memberFees); err != nil {
		t.Fatalf("count member fees: %v", err)
	}
	if memberFees != 0 {
		t.Fatalf("%d FEE transactions exist with no loan behind them — a charge to a member (rule 3)", memberFees)
	}
}
