package repositories

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Ledger reconciliation — WO-82 (OPS-07).
//
// A wrong balance looks exactly like a correct balance until somebody adds it
// up. Every other control in this codebase guards the moment money moves: the
// CHECK constraints reject an impossible row, the concurrency tests prove a
// relative write cannot lose an update, the audit log records who did what.
// None of them can tell you that the totals still agree *today*, because none of
// them ever reads the ledger as a whole.
//
// That is what this does. It sums the transactions, compares them to the stored
// balances, and reports what disagrees. It is the one control that would have
// caught LEDGER-01 the night it landed rather than in an audit months later.
//
// ── It never corrects anything ───────────────────────────────────────────────
//
// Not as a simplification — as a rule. An automated correction to a ledger is a
// second defect written on top of the first, and it destroys the evidence needed
// to understand the first. `audit_logs` is append-only for the same reason
// (CLAUDE.md rule 6). This function returns a report. A human decides.
//
// ── Which statuses mean "money moved" ────────────────────────────────────────
//
// ADR-016 says only `CONFIRMED` moved money, and for aggregates over *requests*
// that is right: a `PENDING` withdrawal is a member's notice and a `PENDING`
// deposit is a request, and counting either as income was the defect that ADR
// exists to fix.
//
// Reconciliation needs one refinement. `PATCH /member/transactions/{id}/dispute`
// flips a **CONFIRMED** posting to `DISPUTED` and changes no balance — the
// dispute is a member's claim that the amount was wrong, not a reversal. So a
// disputed posting is money that moved, and a reconciliation that only counted
// `CONFIRMED` would report drift on every open dispute: alarms that are always
// firing, which is the same as no alarm at all.
//
// `REJECTED` and `REVERSED` are the statuses that mean the money did not move,
// and neither is in this list.
const settledStatuses = `('CONFIRMED','DISPUTED')`

// Drift is one disagreement between what the ledger says and what it adds up to.
type Drift struct {
	// Check is the stable identifier of the invariant that failed. It is a
	// metric label, so it is a fixed vocabulary rather than a message.
	Check string
	// Entity is what to go and look at: ACCOUNT, LOAN or TRANSACTION.
	Entity   string
	EntityID string
	// Expected is what the ledger adds up to; Actual is what is stored.
	Expected int64
	Actual   int64
}

// Delta is how far off the stored value is, in whole taka. Positive means the
// stored balance is larger than the transactions justify — money that exists
// nowhere but in the balance column.
func (d Drift) Delta() int64 { return d.Actual - d.Expected }

func (d Drift) String() string {
	return fmt.Sprintf("%s %s: stored %d, transactions say %d (delta %+d)",
		d.Entity, d.EntityID, d.Actual, d.Expected, d.Delta())
}

// ReconciliationReport is one pass over the whole ledger.
type ReconciliationReport struct {
	Drifts []Drift
	// Scanned is how many rows each check considered. A check that examined
	// nothing has not passed — it has abstained, and on an empty database that
	// is the correct and uninteresting answer. On a populated one it means the
	// query stopped matching and the check has been silently switched off.
	Scanned  map[string]int64
	Duration time.Duration
}

// DriftsFor returns the drifts a single check found.
func (r ReconciliationReport) DriftsFor(check string) []Drift {
	var out []Drift
	for _, d := range r.Drifts {
		if d.Check == check {
			out = append(out, d)
		}
	}
	return out
}

// Balanced reports whether the ledger agrees with itself.
func (r ReconciliationReport) Balanced() bool { return len(r.Drifts) == 0 }

// The check names. Exported because they are metric label values and the
// integration tests assert on them; a typo in one would silently create a second
// time series that nobody alerts on.
const (
	CheckSavingsBalance  = "savings_balance"
	CheckLoanBalance     = "loan_balance"
	CheckLoanRemaining   = "loan_remaining"
	CheckSavingsSnapshot = "savings_snapshot"
)

// CheckHasAmount says whether a check's drift is measurable in taka.
//
// All of them are, now. `transaction_owner` was the exception — it compared a
// posting's `userId` against the owner of the `accountId` beside it, and the
// answer was a member's name rather than a number of taka. That check is gone
// with the column it read: ADR-044 made the account's key the member's own id,
// so a posting names one person and there is no longer a second column for it to
// disagree with. An invariant the schema now makes unrepresentable is better
// than one a job re-checks every hour.
func CheckHasAmount(string) bool { return true }

// AllChecks is every invariant this reconciles, in report order.
var AllChecks = []string{
	CheckSavingsBalance,
	CheckLoanBalance,
	CheckLoanRemaining,
	CheckSavingsSnapshot,
}

// savingsMovement is the signed effect of one transaction row on the account's
// savings balance, and it has to match what the writers actually do:
//
//	DEPOSIT    credits (transaction_repository.go, ApproveWithdrawal/AddMemberDeposit)
//	DONATION   credits the donation pool's own account (RecordDonation)
//	WITHDRAWAL debits, including the two waterfall recovery rows
//
// LOAN_DISBURSEMENT moves no savings — the cash is handed over, and only
// `loanBalance` records it. FEE is the donation pool absorbing a defaulted
// loan; it is written against the borrower's account for traceability and
// changes no balance at all, which is why it is 0 here and counted in
// CheckLoanRemaining instead.
const savingsMovement = `
	CASE
		WHEN t.type IN ('DEPOSIT','DONATION') THEN t.amount
		WHEN t.type = 'WITHDRAWAL' THEN -t.amount
		ELSE 0
	END`

// Reconcile reads the whole ledger and reports every disagreement.
//
// Read-only by construction: there is no UPDATE, no INSERT and no transaction in
// this function. The caller writes the audit row.
func (r *UserRepository) Reconcile(ctx context.Context) (ReconciliationReport, error) {
	started := time.Now()
	report := ReconciliationReport{Scanned: map[string]int64{}}

	for _, check := range []struct {
		name    string
		entity  string
		scanned string
		query   string
	}{
		{
			name:    CheckSavingsBalance,
			entity:  "ACCOUNT",
			scanned: `SELECT COUNT(*) FROM accounts`,
			query: `
				SELECT a."userId", COALESCE(SUM(` + savingsMovement + `), 0)::bigint, a."savingsBalance"::bigint
				FROM accounts a
				LEFT JOIN transactions t
				  ON t."userId" = a."userId" AND t.status IN ` + settledStatuses + `
				GROUP BY a."userId", a."savingsBalance"
				HAVING a."savingsBalance" <> COALESCE(SUM(` + savingsMovement + `), 0)::bigint
			`,
		},
		{
			// The account's loanBalance is the sum of what its open loans still
			// owe. A loan that is COMPLETED, SETTLED or REJECTED owes nothing;
			// a DEFAULTED one still does, after whatever the waterfall
			// recovered.
			name:    CheckLoanBalance,
			entity:  "ACCOUNT",
			scanned: `SELECT COUNT(*) FROM accounts`,
			query: `
				SELECT a."userId", COALESCE(SUM(l."remainingAmount"), 0)::bigint, a."loanBalance"::bigint
				FROM accounts a
				LEFT JOIN loans l
				  ON l."borrowerId" = a."userId" AND l.status IN ('ACTIVE','DEFAULTED')
				GROUP BY a."userId", a."loanBalance"
				HAVING a."loanBalance" <> COALESCE(SUM(l."remainingAmount"), 0)::bigint
			`,
		},
		{
			// Zero interest is an invariant, not a policy setting: a loan can
			// never owe more than it was lent, minus everything paid against
			// it. LOAN_REPAYMENT is the member paying; WITHDRAWAL and FEE with
			// this loanId are the waterfall drawing on savings and on the
			// donation pool. LOAN_DISBURSEMENT carries the same loanId and is
			// the principal itself, so it is excluded.
			name:    CheckLoanRemaining,
			entity:  "LOAN",
			scanned: `SELECT COUNT(*) FROM loans WHERE status IN ('ACTIVE','DEFAULTED','COMPLETED','SETTLED')`,
			query: `
				SELECT l.id,
				       (l."principalAmount" - COALESCE(SUM(t.amount) FILTER (
				           WHERE t.type IN ('LOAN_REPAYMENT','WITHDRAWAL','FEE')
				             AND t.status IN ` + settledStatuses + `
				       ), 0))::bigint,
				       l."remainingAmount"::bigint
				FROM loans l
				LEFT JOIN transactions t ON t."loanId" = l.id
				WHERE l.status IN ('ACTIVE','DEFAULTED','COMPLETED','SETTLED')
				GROUP BY l.id, l."principalAmount", l."remainingAmount"
				HAVING l."remainingAmount" <> (l."principalAmount" - COALESCE(SUM(t.amount) FILTER (
				           WHERE t.type IN ('LOAN_REPAYMENT','WITHDRAWAL','FEE')
				             AND t.status IN ` + settledStatuses + `
				       ), 0))::bigint
			`,
		},
		{
			// The one that catches a lost update *retrospectively*. `savingsAfter`
			// is the balance as it stood when the posting was made, and it is
			// what a reprinted passbook and every receipt are built from — so a
			// snapshot that disagrees with the running total is a receipt in a
			// member's hand that disagrees with their account.
			//
			// Rows with no snapshot are skipped rather than failed: the loan
			// disbursement and waterfall rows legitimately record only
			// `loanAfter`, or nothing.
			name:    CheckSavingsSnapshot,
			entity:  "TRANSACTION",
			scanned: `SELECT COUNT(*) FROM transactions WHERE "savingsAfter" IS NOT NULL`,
			query: `
				WITH running AS (
					SELECT t.id,
					       t."savingsAfter"::bigint AS snapshot,
					       SUM(` + savingsMovement + `) OVER (
					           PARTITION BY t."userId"
					           ORDER BY t."createdAt", t.id
					           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
					       )::bigint AS total
					FROM transactions t
					WHERE t.status IN ` + settledStatuses + `
				)
				SELECT id, total, snapshot
				FROM running
				WHERE snapshot IS NOT NULL AND snapshot <> total
			`,
		},
	} {
		var scanned int64
		if err := r.db.QueryRow(ctx, check.scanned).Scan(&scanned); err != nil {
			return report, fmt.Errorf("reconcile %s: count: %w", check.name, err)
		}
		report.Scanned[check.name] = scanned

		rows, err := r.db.Query(ctx, check.query)
		if err != nil {
			return report, fmt.Errorf("reconcile %s: %w", check.name, err)
		}
		drifts, err := collectDrifts(rows, check.name, check.entity)
		if err != nil {
			return report, fmt.Errorf("reconcile %s: %w", check.name, err)
		}
		report.Drifts = append(report.Drifts, drifts...)
	}

	report.Duration = time.Since(started)
	return report, nil
}

func collectDrifts(rows pgx.Rows, check, entity string) ([]Drift, error) {
	defer rows.Close()

	var out []Drift
	for rows.Next() {
		d := Drift{Check: check, Entity: entity}
		if err := rows.Scan(&d.EntityID, &d.Expected, &d.Actual); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// RecordDrift appends one audit row per check that disagreed.
//
// One row per check rather than one per drifting account: a lost update on a
// popular account can produce thousands of drifting snapshots, and a job that
// writes thousands of audit rows every ten minutes turns the append-only log
// into the thing nobody can read. The row names the check, the count, the total
// taka and the first few entities.
//
// `performedBy` is NULL — no human did this, and inventing a system user id
// would put a row in the log attributing an action to somebody who does not
// exist.
func (r *UserRepository) RecordDrift(ctx context.Context, report ReconciliationReport) error {
	for _, check := range AllChecks {
		drifts := report.DriftsFor(check)
		if len(drifts) == 0 {
			continue
		}

		var total int64
		ids := make([]string, 0, len(drifts))
		for i, d := range drifts {
			total += d.Delta()
			if i < 10 {
				ids = append(ids, d.EntityID)
			}
		}
		suffix := ""
		if len(drifts) > len(ids) {
			suffix = fmt.Sprintf(" and %d more", len(drifts)-len(ids))
		}
		amount := ""
		if CheckHasAmount(check) {
			amount = fmt.Sprintf("; net %+d BDT", total)
		}

		details := fmt.Sprintf(
			"Reconciliation found %d %s disagreeing with the ledger%s. First: %s%s. "+
				"No correction was made automatically.",
			len(drifts), check, amount, strings.Join(ids, ", "), suffix,
		)

		if _, err := r.db.Exec(ctx, `
			INSERT INTO audit_logs (action, "entityType", "entityId", details, "createdAt")
			VALUES ('LEDGER_DRIFT_DETECTED', 'LEDGER', $1, $2, NOW())
		`, check, details); err != nil {
			return fmt.Errorf("record drift for %s: %w", check, err)
		}
	}
	return nil
}
