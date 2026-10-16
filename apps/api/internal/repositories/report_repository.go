package repositories

// Aggregate reporting. Read-only, admin-gated at the router (SEC-02).

import (
	"context"
	"fmt"
)

func (r *UserRepository) GetMonthlyReport(ctx context.Context, year, month int) (map[string]interface{}, error) {
	queryCondition := "EXTRACT(YEAR FROM t.\"createdAt\") = $1"
	args := []interface{}{year}

	if month > 0 {
		queryCondition += " AND EXTRACT(MONTH FROM t.\"createdAt\") = $2"
		args = append(args, month)
	}

	// CONFIRMED only (rule 6a).
	queryCondition += " AND t.status = 'CONFIRMED'"

	query := fmt.Sprintf(`
		SELECT
			COALESCE(SUM(CASE WHEN t.type = 'DEPOSIT' THEN t.amount ELSE 0 END)::bigint, 0) as total_deposits,
			COALESCE(SUM(CASE WHEN t.type = 'WITHDRAWAL' THEN t.amount ELSE 0 END)::bigint, 0) as total_withdrawals,
			COALESCE(SUM(CASE WHEN t.type = 'LOAN_DISBURSEMENT' THEN t.amount ELSE 0 END)::bigint, 0) as loans_disbursed,
			COALESCE(SUM(CASE WHEN t.type = 'LOAN_REPAYMENT' THEN t.amount ELSE 0 END)::bigint, 0) as loans_recovered
		FROM transactions t
		WHERE %s
	`, queryCondition)

	var totalDeposits, totalWithdrawals, loansDisbursed, loansRecovered int64

	if err := r.db.QueryRow(ctx, query, args...).Scan(
		&totalDeposits, &totalWithdrawals, &loansDisbursed, &loansRecovered); err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"year":             year,
		"month":            month,
		"totalDeposits":    totalDeposits,
		"totalWithdrawals": totalWithdrawals,
		"loansDisbursed":   loansDisbursed,
		"loansRecovered":   loansRecovered,
		"netSavings":       (totalDeposits - totalWithdrawals),
	}, nil
}

func (r *UserRepository) GetYearlyReport(ctx context.Context, year int) (map[string]interface{}, error) {
	// Get yearly summary
	yearlyData, err := r.GetMonthlyReport(ctx, year, 0)
	if err != nil {
		return nil, err
	}

	// Get month-by-month breakdown
	monthlyBreakdown := []map[string]interface{}{}
	for month := 1; month <= 12; month++ {
		monthData, err := r.GetMonthlyReport(ctx, year, month)
		if err == nil {
			monthlyBreakdown = append(monthlyBreakdown, monthData)
		}
	}

	return map[string]interface{}{
		"year":             year,
		"summary":          yearlyData,
		"monthlyBreakdown": monthlyBreakdown,
	}, nil
}

func (r *UserRepository) GetLoanPerformanceReport(ctx context.Context) (map[string]interface{}, error) {
	const query = `
		SELECT
			COUNT(*)::int as total_loans,
			COALESCE(AVG("principalAmount")::bigint, 0) as avg_loan_amount,
			COALESCE(SUM(CASE WHEN status = 'DEFAULTED' THEN 1 ELSE 0 END)::int, 0) as defaulted_count,
			COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END)::int, 0) as completed_count,
			COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END)::int, 0) as active_count
		FROM loans
		WHERE status IN ('ACTIVE', 'COMPLETED', 'DEFAULTED')
	`

	var totalLoans, defaultedCount, completedCount, activeCount int
	var avgLoanAmount int64

	if err := r.db.QueryRow(ctx, query).Scan(&totalLoans, &avgLoanAmount, &defaultedCount, &completedCount, &activeCount); err != nil {
		return nil, err
	}

	var defaultRate float64 = 0
	if totalLoans > 0 {
		defaultRate = float64(defaultedCount) / float64(totalLoans)
		defaultRate = float64(int(defaultRate*10)) / 10
	}

	// Get loan stats for recovery rate
	loanStats, _ := r.GetLoanStats(ctx)

	return map[string]interface{}{
		"totalLoans":     totalLoans,
		"avgLoanAmount":  avgLoanAmount,
		"defaultedCount": defaultedCount,
		"completedCount": completedCount,
		"activeCount":    activeCount,
		"defaultRate":    defaultRate,
		"recoveryRate":   loanStats["recoveryRate"],
		"totalDisbursed": loanStats["totalDisbursed"],
		"totalRecovered": loanStats["totalRecovered"],
	}, nil
}

// ==================== PROFILE MANAGEMENT ====================
