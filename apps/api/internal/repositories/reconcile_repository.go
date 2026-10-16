package repositories

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Ledger reconciliation (WO-82): sums the transactions, compares them to the
// stored balances and reports what disagrees. It NEVER corrects (ADR-027).
// Settled = CONFIRMED plus DISPUTED: a dispute changes no balance (ADR-026).
const settledStatuses = `('CONFIRMED','DISPUTED')`

// Drift is one disagreement between what the ledger says and what it adds up to.
type Drift struct {
	// Check is a stable metric label.
	Check string
	// Entity is what to go and look at: ACCOUNT, LOAN or TRANSACTION.
	Entity   string
	EntityID string
	// Expected is what the ledger adds up to; Actual is what is stored.
	Expected int64
	Actual   int64
}

// Delta is stored minus expected, in whole taka.
func (d Drift) Delta() int64 { return d.Actual - d.Expected }

func (d Drift) String() string {
	return fmt.Sprintf("%s %s: stored %d, transactions say %d (delta %+d)",
		d.Entity, d.EntityID, d.Actual, d.Expected, d.Delta())
}

// ReconciliationReport is one pass over the whole ledger.
type ReconciliationReport struct {
	Drifts []Drift
	// Scanned per check: zero on a populated database means the query stopped
	// matching and the check is silently off.
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

// Check names; metric label values asserted by the integration tests.
const (
	CheckSavingsBalance  = "savings_balance"
	CheckLoanBalance     = "loan_balance"
	CheckLoanRemaining   = "loan_remaining"
	CheckSavingsSnapshot = "savings_snapshot"
)

// CheckHasAmount: every check is measurable in taka (transaction_owner went
// away with ADR-044).
func CheckHasAmount(string) bool { return true }

// AllChecks is every invariant this reconciles, in report order.
var AllChecks = []string{
	CheckSavingsBalance,
	CheckLoanBalance,
	CheckLoanRemaining,
	CheckSavingsSnapshot,
}

// savingsMovement is the signed effect of a row on savingsBalance, matching
// the writers: DEPOSIT and DONATION credit, WITHDRAWAL debits (incl. waterfall
// rows). LOAN_DISBURSEMENT and FEE move no savings; FEE counts in CheckLoanRemaining.
const savingsMovement = `
	CASE
		WHEN t.type IN ('DEPOSIT','DONATION') THEN t.amount
		WHEN t.type = 'WITHDRAWAL' THEN -t.amount
		ELSE 0
	END`

// Reconcile reports every disagreement. Read-only by construction.
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
			// Sum of what open loans still owe (DEFAULTED still owes).
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
			// Zero interest: owed = principal − repayments − waterfall draws
			// (WITHDRAWAL/FEE with this loanId). Disbursement excluded.
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
			// savingsAfter vs the running total — the receipt in a member's hand
			// vs their account. Rows without a snapshot are skipped.
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

// RecordDrift appends one audit row per drifting check (not per account), with
// performedBy NULL — no human did this.
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
