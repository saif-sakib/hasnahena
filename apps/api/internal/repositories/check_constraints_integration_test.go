//go:build integration

package repositories

import (
	"context"
	"strings"
	"testing"
)

// WO-69 — the database refuses states the application must never produce.
// Raw SQL on purpose: the database is under test, not the repositories.

// executeRawExpectingViolation requires the rejection to name the constraint.
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

	// Even a relative write cannot take a balance below zero.
	executeRawExpectingViolation(t, "accounts_savings_non_negative",
		`UPDATE accounts SET "savingsBalance" = "savingsBalance" - $1 WHERE "userId" = $2`,
		int64(5000), userID)

	executeRawExpectingViolation(t, "accounts_loan_non_negative",
		`UPDATE accounts SET "loanBalance" = "loanBalance" - $1 WHERE "userId" = $2`,
		int64(1), userID)
}

func TestDatabaseRefusesNonPositivePostings(t *testing.T) {
	newTestRepo(t)

	userID := seedMember(t, "chk_txn", "CHK-TXN-1", 1000)

	for _, amount := range []int64{0, -1} {
		executeRawExpectingViolation(t, "transactions_amount_positive",
			`INSERT INTO transactions (id, type, amount, status, "createdAt", "userId")
			 VALUES ('DEP-2026-900001', 'DEPOSIT', $1, 'PENDING', NOW(), $2)`,
			amount, userID)
	}
}

func TestDatabaseRefusesImpossibleLoans(t *testing.T) {
	newTestRepo(t)

	userID := seedMember(t, "chk_loan", "CHK-LOAN-1", 100000)

	insert := `INSERT INTO loans (id, "principalAmount", "remainingAmount",
	                              "totalInstallments", "installmentAmount", "paidInstallments",
	                              status, "createdAt", "updatedAt", "borrowerId")
	           VALUES ($1, $2, $3, $4, $5, $6,
	                   'ACTIVE', NOW(), NOW(), $7)`

	// Owing more than was borrowed is either interest or a bug, and this
	// codebase permits neither.
	executeRawExpectingViolation(t, "loans_remaining_in_range",
		insert, "LOAN-2026-900001", int64(10000), int64(10001), 10, int64(1000), 0, userID)

	executeRawExpectingViolation(t, "loans_principal_positive",
		insert, "LOAN-2026-900002", int64(0), int64(0), 10, int64(0), 0, userID)

	// More instalments paid than the schedule contains is how a loan reaches a
	// state no report can explain.
	executeRawExpectingViolation(t, "loans_installments_in_range",
		insert, "LOAN-2026-900003", int64(10000), int64(0), 10, int64(1000), 11, userID)
}

// Rule 3 at the layer that cannot be bypassed: a non-zero fee fails the write.
func TestDatabaseRefusesALoanFee(t *testing.T) {
	newTestRepo(t)

	userID := seedMember(t, "chk_fee", "CHK-FEE-1", 100000)

	executeRawExpectingViolation(t, "loans_zero_fee",
		`INSERT INTO loans (id, "principalAmount", "remainingAmount",
		                    "totalInstallments", "installmentAmount", "applicationFee",
		                    status, "createdAt", "updatedAt", "borrowerId")
		 VALUES ('LOAN-2026-900004', 10000, 10000, 10, 1000, $1,
		         'ACTIVE', NOW(), NOW(), $2)`,
		int64(1), userID)
}

// The constraints accept everything the application legitimately does.
func TestTheConstraintsAcceptLegitimateRows(t *testing.T) {
	newTestRepo(t)
	ctx := context.Background()

	userID := seedMember(t, "chk_ok", "CHK-OK-1", 1000)

	// A zero balance is legitimate — it is the boundary, not a violation.
	if _, err := testPool.Exec(ctx,
		`UPDATE accounts SET "savingsBalance" = "savingsBalance" - $1 WHERE "userId" = $2`,
		int64(1000), userID); err != nil {
		t.Fatalf("draining an account to exactly zero was rejected: %v", err)
	}

	// A fully repaid loan has remainingAmount 0 and every instalment paid, which
	// is both boundaries of two different constraints at once.
	if _, err := testPool.Exec(ctx,
		`INSERT INTO loans (id, "principalAmount", "remainingAmount",
		                    "totalInstallments", "installmentAmount", "paidInstallments",
		                    status, "createdAt", "updatedAt", "borrowerId")
		 VALUES ('LOAN-2026-900005', 10000, 0, 10, 1000, 10,
		         'COMPLETED', NOW(), NOW(), $1)`,
		userID); err != nil {
		t.Fatalf("a fully repaid loan was rejected: %v", err)
	}
}
