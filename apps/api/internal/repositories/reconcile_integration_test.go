//go:build integration

// WO-82 — the reconciliation job. Each test plants one disagreement with raw
// SQL and asserts it is reported. Identifiers are namespaced `rc*`.
package repositories

import (
	"context"
	"strings"
	"testing"
)

// seedBackedDeposit writes the CONFIRMED deposit behind a seeded balance, so
// the starting ledger is consistent.
func seedBackedDeposit(t *testing.T, userID string, amount int64, minutesAgo int) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO transactions (id, type, amount, description, status, "createdAt",
			"processedAt", "confirmedAt", "userId", "savingsAfter")
		VALUES (gen_random_uuid()::text, 'DEPOSIT', $2, 'seed', 'CONFIRMED',
			NOW() - ($3 || ' minutes')::interval, NOW(), NOW(), $1, $4)
	`, userID, amount, minutesAgo, amount)
	if err != nil {
		t.Fatalf("seed backed deposit for %s: %v", userID, err)
	}
}

func reconcileOrFail(t *testing.T, repo *UserRepository) ReconciliationReport {
	t.Helper()
	report, err := repo.Reconcile(context.Background())
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	return report
}

// ---------------------------------------------------------------------------
// A ledger that agrees with itself reports nothing
// ---------------------------------------------------------------------------

func TestReconcileReportsNothingOnACleanLedger(t *testing.T) {
	repo := newTestRepo(t)

	member := seedMember(t, "rc1", "ACC-KH-82001", 5000)
	seedBackedDeposit(t, member, 5000, 60)

	report := reconcileOrFail(t, repo)

	if !report.Balanced() {
		t.Fatalf("clean ledger reported drift: %v", report.Drifts)
	}
	// A pass that examined nothing is not a pass. If these queries ever stop
	// matching rows, every test below still goes green while checking nothing.
	if report.Scanned[CheckSavingsBalance] == 0 {
		t.Error("the savings check scanned no accounts, so it proved nothing")
	}
	if report.Scanned[CheckSavingsSnapshot] == 0 {
		t.Error("the snapshot check scanned no transactions, so it proved nothing")
	}
}

func TestReconcileReportsNothingOnAnEmptyDatabase(t *testing.T) {
	repo := newTestRepo(t)

	report := reconcileOrFail(t, repo)

	if !report.Balanced() {
		t.Fatalf("empty database reported drift: %v", report.Drifts)
	}
}

// ---------------------------------------------------------------------------
// One planted disagreement per invariant
// ---------------------------------------------------------------------------

// driftCase plants exactly one inconsistency and says what should be reported.
type driftCase struct {
	name         string
	check        string
	entity       string
	plant        func(t *testing.T, repo *UserRepository) (entityID string, expected, actual int64)
	whyItMatters string
}

func driftCases() []driftCase {
	return []driftCase{
		{
			name:   "savings balance larger than the postings justify",
			check:  CheckSavingsBalance,
			entity: "ACCOUNT",
			whyItMatters: "this is the shape of LEDGER-01: a lost update leaves the column " +
				"holding money no posting ever created",
			plant: func(t *testing.T, repo *UserRepository) (string, int64, int64) {
				member := seedMember(t, "rc1", "ACC-KH-82001", 5000)
				seedBackedDeposit(t, member, 5000, 60)
				mustExec(t, `UPDATE accounts SET "savingsBalance" = 9000 WHERE "userId" = $1`, member)
				return member, 5000, 9000
			},
		},
		{
			name:   "loan balance disagreeing with what the loans still owe",
			check:  CheckLoanBalance,
			entity: "ACCOUNT",
			whyItMatters: "a member is shown a debt that no loan record supports, and nothing " +
				"in the application ever recomputes it",
			plant: func(t *testing.T, repo *UserRepository) (string, int64, int64) {
				member := seedMember(t, "rc1", "ACC-KH-82001", 0)
				seedActiveLoan(t, member, 12000, 12000)
				mustExec(t, `UPDATE accounts SET "loanBalance" = 20000 WHERE "userId" = $1`, member)
				return member, 12000, 20000
			},
		},
		{
			name:   "a loan owing more than principal minus what was paid",
			check:  CheckLoanRemaining,
			entity: "LOAN",
			whyItMatters: "zero interest is an invariant, not a setting — a loan that owes more " +
				"than it was lent minus what was repaid is interest by another name (rule 3)",
			plant: func(t *testing.T, repo *UserRepository) (string, int64, int64) {
				member := seedMember(t, "rc1", "ACC-KH-82001", 0)
				loanID := seedActiveLoan(t, member, 12000, 12000)
				seedRepayment(t, member, loanID, 2000)
				// Paid 2000 against 12000, so 10000 is owed. The row says 11500.
				mustExec(t, `UPDATE loans SET "remainingAmount" = 11500 WHERE id = $1`, loanID)
				mustExec(t, `UPDATE accounts SET "loanBalance" = 11500 WHERE "userId" = $1`, member)
				return loanID, 10000, 11500
			},
		},
		{
			name:   "a balance snapshot that disagrees with the running total",
			check:  CheckSavingsSnapshot,
			entity: "TRANSACTION",
			whyItMatters: "this is the one that catches a lost update retrospectively: the " +
				"snapshot is what a reprinted passbook and every receipt are built from",
			plant: func(t *testing.T, repo *UserRepository) (string, int64, int64) {
				member := seedMember(t, "rc1", "ACC-KH-82001", 5000)
				seedBackedDeposit(t, member, 5000, 60)
				var id string
				mustQuery(t, `
					UPDATE transactions SET "savingsAfter" = 7777
					WHERE "userId" = $1 RETURNING id
				`, []any{member}, &id)
				return id, 5000, 7777
			},
		},
	}
}

func TestReconcileFindsEachPlantedDrift(t *testing.T) {
	for _, tc := range driftCases() {
		t.Run(tc.name, func(t *testing.T) {
			repo := newTestRepo(t)

			entityID, expected, actual := tc.plant(t, repo)
			report := reconcileOrFail(t, repo)

			found := report.DriftsFor(tc.check)
			if len(found) != 1 {
				t.Fatalf("%s reported %d drifts, want 1 (%s). Full report: %v",
					tc.check, len(found), tc.whyItMatters, report.Drifts)
			}
			d := found[0]
			if d.EntityID != entityID {
				t.Errorf("drift is on %s, want %s", d.EntityID, entityID)
			}
			if d.Entity != tc.entity {
				t.Errorf("drift entity = %s, want %s", d.Entity, tc.entity)
			}
			if d.Expected != expected || d.Actual != actual {
				t.Errorf("drift = stored %d vs ledger %d, want stored %d vs ledger %d",
					d.Actual, d.Expected, actual, expected)
			}
		})
	}
}

// TestEveryCheckIsExercised: each AllChecks entry needs a planted drift.
func TestEveryCheckIsExercised(t *testing.T) {
	covered := map[string]bool{}
	for _, tc := range driftCases() {
		covered[tc.check] = true
	}
	for _, check := range AllChecks {
		if !covered[check] {
			t.Errorf("no test plants a drift for %q. A check nobody has ever seen fail is a "+
				"check that may not work — write a case in driftCases().", check)
		}
	}
}

// ---------------------------------------------------------------------------
// It reports; it never repairs
// ---------------------------------------------------------------------------

func TestReconcileCorrectsNothing(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "rc1", "ACC-KH-82001", 5000)
	seedBackedDeposit(t, member, 5000, 60)
	mustExec(t, `UPDATE accounts SET "savingsBalance" = 9000 WHERE "userId" = $1`, member)

	if _, err := repo.Reconcile(ctx); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	// The wrong number must still be there for a human (ADR-027).
	if got := savingsOf(t, member); got != 9000 {
		t.Fatalf("savings = %d after reconciliation, want 9000 untouched — the job repaired "+
			"the drift instead of reporting it", got)
	}
}

func TestRecordDriftAppendsOneAuditRowPerCheck(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "rc1", "ACC-KH-82001", 5000)
	seedBackedDeposit(t, member, 5000, 60)
	// One drift in savings and one in the snapshot, from a single edit.
	mustExec(t, `UPDATE accounts SET "savingsBalance" = 9000 WHERE "userId" = $1`, member)

	report := reconcileOrFail(t, repo)
	if err := repo.RecordDrift(ctx, report); err != nil {
		t.Fatalf("record drift: %v", err)
	}

	if n := countAuditLogs(t, CheckSavingsBalance, "LEDGER_DRIFT_DETECTED"); n != 1 {
		t.Errorf("audit rows for %s = %d, want 1", CheckSavingsBalance, n)
	}
	// One row per check, not per account.
	var total int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_logs WHERE action = 'LEDGER_DRIFT_DETECTED'`).Scan(&total); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if total > len(AllChecks) {
		t.Errorf("wrote %d audit rows for %d checks", total, len(AllChecks))
	}

	var details string
	if err := testPool.QueryRow(ctx, `
		SELECT details FROM audit_logs WHERE action = 'LEDGER_DRIFT_DETECTED' AND "entityId" = $1
	`, CheckSavingsBalance).Scan(&details); err != nil {
		t.Fatalf("read audit row: %v", err)
	}
	if !strings.Contains(details, "No correction was made automatically") {
		t.Errorf("audit row does not say the drift was left alone: %q", details)
	}
}

func TestACleanLedgerWritesNoAuditRow(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "rc1", "ACC-KH-82001", 5000)
	seedBackedDeposit(t, member, 5000, 60)

	report := reconcileOrFail(t, repo)
	if err := repo.RecordDrift(ctx, report); err != nil {
		t.Fatalf("record drift: %v", err)
	}

	var n int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_logs WHERE action = 'LEDGER_DRIFT_DETECTED'`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("a balanced ledger wrote %d drift rows; an alert that always fires is no alert", n)
	}
}

// ---------------------------------------------------------------------------
// A dispute is not a reversal
// ---------------------------------------------------------------------------

// A dispute changes no balance, so DISPUTED still counts as moved (ADR-026).
func TestADisputedPostingIsStillMoneyThatMoved(t *testing.T) {
	repo := newTestRepo(t)

	member := seedMember(t, "rc1", "ACC-KH-82001", 5000)
	seedBackedDeposit(t, member, 5000, 60)
	mustExec(t, `UPDATE transactions SET status = 'DISPUTED' WHERE "userId" = $1`, member)

	report := reconcileOrFail(t, repo)

	if !report.Balanced() {
		t.Fatalf("an open dispute was reported as ledger drift: %v", report.Drifts)
	}
}

// A REJECTED request, by contrast, moved nothing — and a balance that reflects
// one is real drift.
func TestARejectedRequestIsNotMoneyThatMoved(t *testing.T) {
	repo := newTestRepo(t)

	member := seedMember(t, "rc1", "ACC-KH-82001", 5000)
	seedBackedDeposit(t, member, 5000, 60)
	mustExec(t, `UPDATE transactions SET status = 'REJECTED' WHERE "userId" = $1`, member)

	report := reconcileOrFail(t, repo)

	if len(report.DriftsFor(CheckSavingsBalance)) != 1 {
		t.Fatalf("a balance backed only by a REJECTED request was not reported: %v", report.Drifts)
	}
}

// ---------------------------------------------------------------------------
// The waterfall, end to end
// ---------------------------------------------------------------------------

// TestWaterfallRecoveryLeavesTheLedgerBalanced: recovery rows are CONFIRMED
// and accounts.loanBalance is reduced.
func TestWaterfallRecoveryLeavesTheLedgerBalanced(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "rc1", "ACC-KH-82001", 5000)
	guarantor := seedMember(t, "rc2", "ACC-KH-82002", 30000)
	admin := seedStaff(t, "rca", "ADMIN")
	seedBackedDeposit(t, borrower, 5000, 120)
	seedBackedDeposit(t, guarantor, 30000, 120)
	setConfig(t, "loan.missedPaymentsForDefault", "3")

	loanID := seedLoanBehindBy(t, borrower, guarantor, 12000, 3)
	// A real disbursement would have moved this; seedLoanBehindBy writes the
	// loan only.
	mustExec(t, `UPDATE accounts SET "loanBalance" = 12000 WHERE "userId" = $1`, borrower)

	if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "three missed"); err != nil {
		t.Fatalf("mark defaulted: %v", err)
	}

	// The waterfall took everything: 5000 from the borrower, 7000 from the
	// guarantor, nothing left owing.
	if got := savingsOf(t, borrower); got != 0 {
		t.Errorf("borrower savings = %d after recovery, want 0", got)
	}
	if got := savingsOf(t, guarantor); got != 23000 {
		t.Errorf("guarantor savings = %d after recovery, want 23000", got)
	}
	if got := loanBalanceOf(t, borrower); got != 0 {
		t.Errorf("borrower loanBalance = %d after full recovery, want 0 — the waterfall wrote "+
			"the loan down and left the account showing a debt that no longer exists", got)
	}

	var pending int
	if err := testPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM transactions WHERE "loanId" = $1 AND status = 'PENDING'
	`, loanID).Scan(&pending); err != nil {
		t.Fatalf("count pending recovery rows: %v", err)
	}
	if pending != 0 {
		t.Errorf("%d recovery rows are PENDING. The money moved in the same transaction that "+
			"wrote them; a PENDING withdrawal is a notice of intent, not a posting (ADR-016)", pending)
	}

	report := reconcileOrFail(t, repo)
	if !report.Balanced() {
		t.Fatalf("the ledger does not balance after a default recovery: %v", report.Drifts)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func mustExec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %s: %v", sql, err)
	}
}

func mustQuery(t *testing.T, sql string, args []any, dest ...any) {
	t.Helper()
	if err := testPool.QueryRow(context.Background(), sql, args...).Scan(dest...); err != nil {
		t.Fatalf("query %s: %v", sql, err)
	}
}

func seedActiveLoan(t *testing.T, borrower string, principal, remaining int64) string {
	t.Helper()
	var loanID string
	mustQuery(t, `
		INSERT INTO loans (id, "borrowerId",
			"principalAmount", "remainingAmount", "totalInstallments", "paidInstallments",
			"installmentAmount", purpose, status, "disbursementDate", "createdAt", "updatedAt")
		VALUES ('LOAN-RC-' || $1, $1,
			$2, $3, 12, 0, ($2/12)::bigint, 'reconcile fixture', 'ACTIVE', NOW(), NOW(), NOW())
		RETURNING id
	`, []any{borrower, principal, remaining}, &loanID)
	mustExec(t, `UPDATE accounts SET "loanBalance" = $2 WHERE "userId" = $1`, borrower, remaining)
	return loanID
}

func seedRepayment(t *testing.T, borrower, loanID string, amount int64) {
	t.Helper()
	mustExec(t, `
		INSERT INTO transactions (id, type, amount, description, status, "createdAt",
			"processedAt", "confirmedAt", "userId", "loanId")
		VALUES (gen_random_uuid()::text, 'LOAN_REPAYMENT', $3, 'seed repayment', 'CONFIRMED',
			NOW(), NOW(), NOW(), $1, $2)
	`, borrower, loanID, amount)
}

// Every check reports a taka figure.
func TestEveryCheckReportsAnAmount(t *testing.T) {
	for _, check := range AllChecks {
		if !CheckHasAmount(check) {
			t.Errorf("%s is not reported in taka, but its drift is a difference between two sums", check)
		}
	}
}
