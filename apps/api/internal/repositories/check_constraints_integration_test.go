//go:build integration

package repositories

import (
	"context"
	"strings"
	"testing"
)

// WO-69. The database refuses states the application must never produce.
//
// Until this migration there was not one CHECK constraint in the schema. Every
// money invariant lived only in application code, in two backends that write the
// same tables — so the guarantee was "every current code path is careful",
// which is a statement about today's code rather than about the data.
//
// Each case below writes raw SQL, deliberately bypassing every repository
// method, because what is under test is the *database*. A test that went through
// the repositories would prove the repositories are careful, which was never in
// doubt and is not what a constraint is for.
//
// All of these were confirmed to succeed — i.e. the illegal row was accepted —
// before the migration existed.

// executeRawExpectingViolation runs a statement that must be rejected, and
// checks the rejection names the constraint rather than merely being an error.
// A NOT NULL failure or a typo would otherwise read as a pass.
func executeRawExpectingViolation(t *testing.T, constraint, sql string, args ...interface{}) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), sql, args...)
	if err == nil {
		t.Fatalf("the database accepted a row that %s exists to reject", constraint)
	}
	if !strings.Contains(err.Error(), constraint) {
		t.Fatalf("statement failed, but not on %s — got: %v", constraint, err)
	}
}

func TestDatabaseRefusesNegativeBalances(t *testing.T) {
	newTestRepo(t)

	userID := seedMember(t, "chk_bal", "CHK-BAL-1", 1000)
	accountID := "acct_" + userID

	// A relative write is the correct pattern (ADR-015). The point here is that
	// even a correct-looking relative write cannot take the balance below zero:
	// the lost update that drove loanBalance to -5000 was measured, not
	// hypothetical, and the code fix is guarded by a census that a new writer
	// could still be added around.
	executeRawExpectingViolation(t, "accounts_savings_non_negative",
		`UPDATE accounts SET "savingsBalance" = "savingsBalance" - $1 WHERE id = $2`,
		int64(5000), accountID)

	executeRawExpectingViolation(t, "accounts_loan_non_negative",
		`UPDATE accounts SET "loanBalance" = "loanBalance" - $1 WHERE id = $2`,
		int64(1), accountID)
}

func TestDatabaseRefusesNonPositivePostings(t *testing.T) {
	newTestRepo(t)

	userID := seedMember(t, "chk_txn", "CHK-TXN-1", 1000)
	accountID := "acct_" + userID

	for _, amount := range []int64{0, -1} {
		executeRawExpectingViolation(t, "transactions_amount_positive",
			`INSERT INTO transactions (id, type, amount, status, "createdAt", "accountId", "userId")
			 VALUES (gen_random_uuid()::text, 'DEPOSIT', $1, 'PENDING', NOW(), $2, $3)`,
			amount, accountID, userID)
	}
}

func TestDatabaseRefusesImpossibleLoans(t *testing.T) {
	newTestRepo(t)

	userID := seedMember(t, "chk_loan", "CHK-LOAN-1", 100000)
	accountID := "acct_" + userID

	insert := `INSERT INTO loans (id, "loanNumber", "principalAmount", "remainingAmount",
	                              "totalInstallments", "installmentAmount", "paidInstallments",
	                              status, "createdAt", "updatedAt", "accountId", "borrowerId")
	           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
	                   'ACTIVE', NOW(), NOW(), $7, $8)`

	// Owing more than was borrowed is either interest or a bug, and this
	// codebase permits neither.
	executeRawExpectingViolation(t, "loans_remaining_in_range",
		insert, "CHK-OVER", int64(10000), int64(10001), 10, int64(1000), 0, accountID, userID)

	executeRawExpectingViolation(t, "loans_principal_positive",
		insert, "CHK-ZERO", int64(0), int64(0), 10, int64(0), 0, accountID, userID)

	// More instalments paid than the schedule contains is how a loan reaches a
	// state no report can explain.
	executeRawExpectingViolation(t, "loans_installments_in_range",
		insert, "CHK-INST", int64(10000), int64(0), 10, int64(1000), 11, accountID, userID)
}

// Rule 3, at the layer that cannot be bypassed.
//
// `applicationFee` was already pinned in both directions by tests: the schema
// must keep `@default(0)`, and the one place that writes it must write zero.
// This adds no new policy — it moves the guarantee from "a test would catch it"
// to "the write fails", which is the right place for a Shariah constraint in a
// database two services write to.
func TestDatabaseRefusesALoanFee(t *testing.T) {
	newTestRepo(t)

	userID := seedMember(t, "chk_fee", "CHK-FEE-1", 100000)
	accountID := "acct_" + userID

	executeRawExpectingViolation(t, "loans_zero_fee",
		`INSERT INTO loans (id, "loanNumber", "principalAmount", "remainingAmount",
		                    "totalInstallments", "installmentAmount", "applicationFee",
		                    status, "createdAt", "updatedAt", "accountId", "borrowerId")
		 VALUES (gen_random_uuid()::text, 'CHK-FEE-1', 10000, 10000, 10, 1000, $1,
		         'ACTIVE', NOW(), NOW(), $2, $3)`,
		int64(1), accountID, userID)
}

// The constraints must not reject anything the application legitimately does.
// A constraint that blocks a real path is worse than none, because it will be
// dropped in a hurry rather than understood.
func TestTheConstraintsAcceptLegitimateRows(t *testing.T) {
	newTestRepo(t)
	ctx := context.Background()

	userID := seedMember(t, "chk_ok", "CHK-OK-1", 1000)
	accountID := "acct_" + userID

	// A zero balance is legitimate — it is the boundary, not a violation.
	if _, err := testPool.Exec(ctx,
		`UPDATE accounts SET "savingsBalance" = "savingsBalance" - $1 WHERE id = $2`,
		int64(1000), accountID); err != nil {
		t.Fatalf("draining an account to exactly zero was rejected: %v", err)
	}

	// A fully repaid loan has remainingAmount 0 and every instalment paid, which
	// is both boundaries of two different constraints at once.
	if _, err := testPool.Exec(ctx,
		`INSERT INTO loans (id, "loanNumber", "principalAmount", "remainingAmount",
		                    "totalInstallments", "installmentAmount", "paidInstallments",
		                    status, "createdAt", "updatedAt", "accountId", "borrowerId")
		 VALUES (gen_random_uuid()::text, 'CHK-OK-1', 10000, 0, 10, 1000, 10,
		         'COMPLETED', NOW(), NOW(), $1, $2)`,
		accountID, userID); err != nil {
		t.Fatalf("a fully repaid loan was rejected: %v", err)
	}
}
