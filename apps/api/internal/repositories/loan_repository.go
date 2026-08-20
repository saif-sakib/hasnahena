package repositories

// Lending, end to end: request, approval, disbursement, repayment, default and
// the guarantor recovery waterfall.
//
// ZERO INTEREST. Nothing here may compute a rate, a markup or a fee — that is a
// Shariah violation, not a feature (CLAUDE.md rule 3). The arithmetic lives in
// internal/money and is unit-tested; this file is the SQL around it.

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"hasnahena/apps/api/internal/money"
	"hasnahena/apps/api/internal/notify"
	"hasnahena/apps/api/internal/utils"
)

// Sentinel errors so handlers can map a lending failure to the status code the
// caller can act on. Before these, every one of them arrived as a generic 500,
// which told an admin the server was broken when in fact they had clicked the
// wrong loan (TEST-15, TEST-19).
var (
	ErrLoanIDRequired     = errors.New("loanId is required")
	ErrLoanNotFound       = errors.New("loan not found")
	ErrLoanNotDefaultable = errors.New("loan is not in a state that can be defaulted")
	// ErrLoanNotYetDefaultable means the loan is in a defaultable state but has
	// not missed enough instalments under `loan.missedPaymentsForDefault`.
	// Distinct from ErrLoanNotDefaultable because the answer to it is "wait",
	// not "this loan never can be".
	ErrLoanNotYetDefaultable = errors.New("loan has not missed enough payments to be defaulted")
)

func (r *UserRepository) ApproveLoan(ctx context.Context, loanID, approverID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var principalAmount int64
	var borrowerID, accountID, loanStatus, loanNumber string
	const loanQuery = `
		SELECT
			"principalAmount"::bigint,
			"borrowerId",
			"accountId",
			status::text,
			COALESCE("loanNumber", '')
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`
	if err := tx.QueryRow(ctx, loanQuery, loanID).Scan(&principalAmount, &borrowerID, &accountID, &loanStatus, &loanNumber); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("loan request not found")
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "PENDING_APPROVAL" {
		return errors.New("only pending loan requests can be approved")
	}

	const updateLoanQuery = `
		UPDATE loans
		SET status = 'ACTIVE',
			"disbursementDate" = NOW(),
			"approvedAt" = NOW(),
			"approvedBy" = $2,
			"remainingAmount" = $3,
			"updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateLoanQuery, loanID, approverID, principalAmount); err != nil {
		return err
	}

	var updatedLoanBalance, savingsBalance int64
	const updateAccountQuery = `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" + $2,
			"updatedAt" = NOW()
		WHERE id = $1
		RETURNING "loanBalance"::bigint, "savingsBalance"::bigint
	`
	if err := tx.QueryRow(ctx, updateAccountQuery, accountID, principalAmount).Scan(&updatedLoanBalance, &savingsBalance); err != nil {
		return err
	}

	const txnQuery = `
		INSERT INTO transactions (
			id,
			type,
			amount,
			description,
			status,
			"createdAt",
			"processedAt",
			"confirmedAt",
			"accountId",
			"userId",
			"loanId",
			"processedBy",
			"savingsAfter",
			"loanAfter"
		)
		VALUES (
			gen_random_uuid()::text,
			'LOAN_DISBURSEMENT',
			$1,
			'Loan approved and disbursed',
			'CONFIRMED',
			NOW(),
			NOW(),
			NOW(),
			$2,
			$3,
			$4,
			$5,
			$6,
			$7
		)
	`
	if _, err := tx.Exec(ctx, txnQuery, principalAmount, accountID, borrowerID, loanID, approverID, savingsBalance, updatedLoanBalance); err != nil {
		return err
	}

	// The wording lives in internal/notify, which renders whole taka and is table
	// tested (WO-52). Two defects have already come out of this one line: a /100
	// that told a member their ৳50,000 loan was "BDT 500.00", and the %.2f that
	// printed paisa in a ledger that has none.
	approvedTitle, approvedMessage := notify.LoanApproved(loanNumber, principalAmount)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		approvedTitle,
		approvedMessage,
		&borrowerID,
		nil,
	); err != nil {
		return fmt.Errorf("failed to notify member: %w", err)
	}

	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt")
		VALUES (gen_random_uuid()::text, 'APPROVE_LOAN', 'LOAN', $1, $2, NOW())
	`
	_, _ = tx.Exec(ctx, auditQuery, loanID, approverID)

	return tx.Commit(ctx)
}

func (r *UserRepository) RejectLoan(ctx context.Context, loanID, approverID, reason string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var borrowerID, loanStatus, loanNumber string
	if err := tx.QueryRow(ctx, `
		SELECT "borrowerId", status::text, COALESCE("loanNumber", '')
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`, loanID).Scan(&borrowerID, &loanStatus, &loanNumber); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("loan request not found")
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "PENDING_APPROVAL" {
		return errors.New("only pending loan requests can be rejected")
	}

	const updateQuery = `
		UPDATE loans
		SET status = 'REJECTED', "updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateQuery, loanID); err != nil {
		return err
	}

	rejectedTitle, rejectedMessage := notify.LoanRejected(loanNumber, reason)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		rejectedTitle,
		rejectedMessage,
		&borrowerID,
		nil,
	); err != nil {
		return fmt.Errorf("failed to notify member: %w", err)
	}

	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'REJECT_LOAN', 'LOAN', $1, $2, NOW(), $3)
	`
	_, _ = tx.Exec(ctx, auditQuery, loanID, approverID, reason)

	return tx.Commit(ctx)
}

func (r *UserRepository) CreateMemberLoanRepaymentRequest(ctx context.Context, memberID, loanID string, amount int64, bkashReference, notes string) (string, error) {
	reference := strings.TrimSpace(bkashReference)
	if reference == "" {
		return "", errors.New("bkash reference is required")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var memberStatus, accountID, memberName string
	if err := tx.QueryRow(ctx, `
		SELECT
			u.status::text,
			a.id::text,
			COALESCE(u."nameEn", '')
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1
		  AND u.role = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&memberStatus, &accountID, &memberName); err != nil {
		return "", errors.New("member not found")
	}
	if strings.ToUpper(strings.TrimSpace(memberStatus)) != "ACTIVE" {
		return "", errors.New("member not active")
	}

	var remainingAmount int64
	var loanStatus, loanNumber string
	if err := tx.QueryRow(ctx, `
		SELECT
			"remainingAmount"::bigint,
			status::text,
			COALESCE("loanNumber", '')
		FROM loans
		WHERE id = $1
		  AND "borrowerId" = $2
		FOR UPDATE
	`, loanID, memberID).Scan(&remainingAmount, &loanStatus, &loanNumber); err != nil {
		return "", errors.New("loan not found")
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "ACTIVE" {
		return "", errors.New("loan is not active")
	}
	if amount > remainingAmount {
		return "", errors.New("repayment exceeds remaining balance")
	}

	var existingRequestID string
	dupErr := tx.QueryRow(ctx, `
		SELECT t.id::text
		FROM transactions t
		WHERE t."userId" = $1
		  AND t.type = 'LOAN_REPAYMENT'
		  AND t.status = 'PENDING'
		  AND t."loanId" = $2
		  AND t.amount = $3
		  AND COALESCE(t."receiptNumber", '') = $4
		ORDER BY t."createdAt" DESC
		LIMIT 1
	`, memberID, loanID, amount, reference).Scan(&existingRequestID)
	if dupErr == nil {
		return "", errors.New("duplicate pending loan repayment request")
	}
	if !errors.Is(dupErr, pgx.ErrNoRows) {
		return "", dupErr
	}

	description := strings.TrimSpace(notes)
	if description == "" {
		description = "Member-submitted bKash loan repayment request"
	}

	var requestID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO transactions (
			id,
			type,
			amount,
			"receiptNumber",
			description,
			status,
			"createdAt",
			"accountId",
			"userId",
			"loanId"
		) VALUES (
			gen_random_uuid()::text,
			'LOAN_REPAYMENT',
			$1,
			$2,
			$3,
			'PENDING',
			NOW(),
			$4,
			$5,
			$6
		)
		RETURNING id::text
	`, amount, reference, description, accountID, memberID, loanID).Scan(&requestID); err != nil {
		return "", err
	}

	staffTitle, staffMessage := notify.LoanRepaymentRequestForStaff(memberName, loanNumber, reference, amount)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		staffTitle,
		staffMessage,
		nil,
		normalizedRolePtr("ADMIN"),
	); err != nil {
		return "", fmt.Errorf("failed to notify admins: %w", err)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		staffTitle,
		staffMessage,
		nil,
		normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to notify staff: %w", err)
	}
	memberTitle, memberMessage := notify.LoanRepaymentRequestSubmitted(amount)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		memberTitle,
		memberMessage,
		&memberID,
		nil,
	); err != nil {
		return "", fmt.Errorf("failed to notify member: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	return requestID, nil
}

// ==================== DEPOSIT & TRANSACTION MANAGEMENT ====================

func (r *UserRepository) GetAllLoans(ctx context.Context, filters map[string]interface{}) ([]map[string]interface{}, error) {
	query := `
		SELECT
			l.id,
			l."loanNumber",
			COALESCE(l."approvedAt", '0001-01-01'::timestamp),
			COALESCE(l."disbursementDate", '0001-01-01'::timestamp),
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l."totalInstallments",
			l."installmentAmount"::bigint,
			l."paidInstallments",
			-- The schedule's start, so the next due date and the arrears count
			-- come from money.NextDueDate rather than from whichever column was
			-- nearest to hand. This list used to return no due date at all, which
			-- rendered as "0 overdue" on a screen the worker's copy of showed 4.
			COALESCE(l."installmentStartDate", l."disbursementDate"),
			COALESCE(l."expectedEndDate", '0001-01-01'::timestamp),
			COALESCE(l."completedAt", '0001-01-01'::timestamp),
			l.purpose,
			l.status::text,
			l."createdAt",
			COALESCE(approver."nameEn", approver."nameBn", ''),
			COALESCE(ac."savingsBalance", 0)::bigint,
			COALESCE(b.id, ''),
			COALESCE(b."nameEn", ''),
			COALESCE(b."nameBn", ''),
			COALESCE(b."accountNo", ''),
			COALESCE(g.id, ''),
			COALESCE(g."nameEn", ''),
			COALESCE(g."accountNo", '')
		FROM loans l
		JOIN accounts ac ON ac.id = l."accountId"
		JOIN users b ON b.id = l."borrowerId"
		LEFT JOIN users g ON g.id = l."guarantorId"
		LEFT JOIN users approver ON approver.id = l."approvedBy"
		WHERE 1=1
	`

	args := []interface{}{}
	argCount := 0

	if statusFilter, ok := filters["status"].(string); ok && statusFilter != "" {
		argCount++
		query += fmt.Sprintf(` AND l.status = $%d`, argCount)
		args = append(args, statusFilter)
	}

	if search, ok := filters["search"].(string); ok && search != "" {
		argCount++
		query += fmt.Sprintf(` AND (b."nameEn" ILIKE $%d OR b."accountNo" ILIKE $%d OR l."loanNumber" ILIKE $%d)`, argCount, argCount, argCount)
		args = append(args, "%"+search+"%")
	}

	page := 1
	limit := 100
	if rawPage, ok := filters["page"].(string); ok && rawPage != "" {
		if parsed, err := strconv.Atoi(rawPage); err == nil && parsed > 0 {
			page = parsed
		}
	}
	if rawLimit, ok := filters["limit"].(string); ok && rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil && parsed > 0 {
			if parsed > 200 {
				parsed = 200
			}
			limit = parsed
		}
	}
	offset := (page - 1) * limit

	query += fmt.Sprintf(` ORDER BY l."createdAt" DESC LIMIT $%d OFFSET $%d`, argCount+1, argCount+2)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	loans := []map[string]interface{}{}
	for rows.Next() {
		var id, loanNumber, purpose, status, approvedBy, borrowerID, borrowerName, borrowerNameBn, borrowerAccountNo, guarantorID, guarantorName, guarantorAccountNo string
		var principalAmount, remainingAmount, installmentAmount, memberDeposit int64
		var totalInstallments, paidInstallments int
		var approvedAt, disbursementDate, expectedEndDate, completedAt, createdAt time.Time
		var installmentStart *time.Time

		if err := rows.Scan(&id, &loanNumber, &approvedAt, &disbursementDate, &principalAmount, &remainingAmount, &totalInstallments, &installmentAmount, &paidInstallments,
			&installmentStart, &expectedEndDate, &completedAt, &purpose, &status, &createdAt, &approvedBy, &memberDeposit,
			&borrowerID, &borrowerName, &borrowerNameBn, &borrowerAccountNo, &guarantorID, &guarantorName, &guarantorAccountNo); err != nil {
			continue
		}

		loan := map[string]interface{}{
			"id":                 id,
			"loanNumber":         loanNumber,
			"status":             status,
			"amount":             principalAmount,
			"paidAmount":         (principalAmount - remainingAmount),
			"remainingAmount":    remainingAmount,
			"installmentsPaid":   paidInstallments,
			"totalInstallments":  totalInstallments,
			"monthlyInstallment": installmentAmount,
			"purpose":            purpose,
			"member": map[string]interface{}{
				"id":        borrowerID,
				"accountNo": borrowerAccountNo,
				"name": func() string {
					if borrowerNameBn != "" {
						return borrowerNameBn
					}
					return borrowerName
				}(),
			},
			"guarantor": map[string]interface{}{
				"id":   guarantorID,
				"name": guarantorName,
			},
			"memberDeposit": memberDeposit,
			"createdAt":     createdAt.Format(time.RFC3339),
			"approvedBy":    approvedBy,

			// Backward-compat fields
			"principalAmount":         principalAmount,
			"totalInstallmentsLegacy": totalInstallments,
			"paidInstallments":        paidInstallments,
			"borrowerName":            borrowerName,
			"borrowerNameBn":          borrowerNameBn,
			"borrowerAccountNo":       borrowerAccountNo,
			"guarantorName":           guarantorName,
			"guarantorAccountNo":      guarantorAccountNo,
		}

		if !approvedAt.IsZero() && approvedAt.Year() > 1 {
			loan["approvedDate"] = approvedAt.Format(time.RFC3339)
		}
		if !disbursementDate.IsZero() {
			loan["disbursedDate"] = disbursementDate.Format(time.RFC3339)
			loan["disbursementDate"] = disbursementDate.Format(time.RFC3339)
		}
		if !expectedEndDate.IsZero() {
			loan["dueDate"] = expectedEndDate.Format(time.RFC3339)
			loan["expectedEndDate"] = expectedEndDate.Format(time.RFC3339)
		}
		if !completedAt.IsZero() && completedAt.Year() > 1 {
			loan["completedAt"] = completedAt.Format(time.RFC3339)
		}
		// `missedPayments` was a literal 0 here, so the admin's loan list reported
		// no arrears on any loan in the foundation.
		attachLoanSchedule(loan, status, installmentStart, totalInstallments, paidInstallments)
		loan["missedPayments"] = loan["missedInstallments"]

		loans = append(loans, loan)
	}

	return loans, nil
}

func (r *UserRepository) GetLoanStats(ctx context.Context) (map[string]interface{}, error) {
	query := `
		SELECT
			COALESCE(SUM(CASE WHEN status IN ` + disbursedLoanStatuses + ` THEN "principalAmount" ELSE 0 END)::bigint, 0) as total_disbursed,
			COALESCE(SUM(CASE WHEN status IN ` + disbursedLoanStatuses + ` THEN ("principalAmount" - "remainingAmount") ELSE 0 END)::bigint, 0) as total_recovered,
			COALESCE(COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END)::int, 0) as active_loans,
			COALESCE(COUNT(CASE WHEN status = 'DEFAULTED' THEN 1 END)::int, 0) as defaulted_loans,
			-- WO-71: was status = 'PENDING', the legacy label. Applications
			-- create PENDING_GUARANTOR or PENDING_APPROVAL, so this counted
			-- nothing and the admin dashboard reported zero pending loans no
			-- matter how many were waiting.
			COALESCE(COUNT(CASE WHEN status IN ('PENDING_GUARANTOR', 'PENDING_APPROVAL') THEN 1 END)::int, 0) as pending_loans,
			COALESCE(COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int, 0) as completed_loans
		FROM loans
	`

	var totalDisbursed, totalRecovered int64
	var activeLoans, defaultedLoans, pendingLoans, completedLoans int

	if err := r.db.QueryRow(ctx, query).Scan(&totalDisbursed, &totalRecovered, &activeLoans, &defaultedLoans, &pendingLoans, &completedLoans); err != nil {
		return nil, err
	}

	// Calculate recovery rate - CRITICAL FIX for hardcoded 98.5%
	recoveryRate := 100.0
	if totalDisbursed > 0 {
		recoveryRate = float64(totalRecovered) / float64(totalDisbursed) * 100
		// Round to 1 decimal place
		recoveryRate = float64(int(recoveryRate*10)) / 10
	}

	return map[string]interface{}{
		"totalDisbursed": totalDisbursed,
		"totalRecovered": totalRecovered,
		"recoveryRate":   recoveryRate,
		"activeLoans":    activeLoans,
		"defaultedLoans": defaultedLoans,
		"pendingLoans":   pendingLoans,
		"completedLoans": completedLoans,
	}, nil
}

func (r *UserRepository) GetLoanDetail(ctx context.Context, loanID string) (map[string]interface{}, error) {
	const loanQuery = `
		SELECT
			l.id,
			l."loanNumber",
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l."totalInstallments",
			l."installmentAmount"::bigint,
			l."paidInstallments",
			l."disbursementDate",
			l."installmentStartDate",
			l."expectedEndDate",
			COALESCE(l."completedAt", '0001-01-01'::timestamp),
			l.purpose,
			l.status::text,
			l."createdAt",
			COALESCE(b."nameEn", ''),
			COALESCE(b."nameBn", ''),
			COALESCE(b."accountNo", ''),
			COALESCE(b.phone, ''),
			COALESCE(g."nameEn", ''),
			COALESCE(g."nameBn", ''),
			COALESCE(g."accountNo", ''),
			COALESCE(g.phone, '')
		FROM loans l
		JOIN users b ON b.id = l."borrowerId"
		LEFT JOIN users g ON g.id = l."guarantorId"
		WHERE l.id = $1
	`

	var id, loanNumber, purpose, status, borrowerName, borrowerNameBn, borrowerAccountNo, borrowerPhone string
	var guarantorName, guarantorNameBn, guarantorAccountNo, guarantorPhone string
	var principalAmount, remainingAmount, installmentAmount int64
	var totalInstallments, paidInstallments int
	var disbursementDate, installmentStartDate, expectedEndDate, completedAt, createdAt time.Time

	if err := r.db.QueryRow(ctx, loanQuery, loanID).Scan(
		&id, &loanNumber, &principalAmount, &remainingAmount, &totalInstallments, &installmentAmount, &paidInstallments,
		&disbursementDate, &installmentStartDate, &expectedEndDate, &completedAt, &purpose, &status, &createdAt,
		&borrowerName, &borrowerNameBn, &borrowerAccountNo, &borrowerPhone,
		&guarantorName, &guarantorNameBn, &guarantorAccountNo, &guarantorPhone); err != nil {
		return nil, err
	}

	result := map[string]interface{}{
		"id":                id,
		"loanNumber":        loanNumber,
		"principalAmount":   principalAmount,
		"remainingAmount":   remainingAmount,
		"totalInstallments": totalInstallments,
		"installmentAmount": installmentAmount,
		"paidInstallments":  paidInstallments,
		"purpose":           purpose,
		"status":            status,
		"createdAt":         createdAt.Format(time.RFC3339),
		"borrower": map[string]interface{}{
			"name":      borrowerName,
			"nameBn":    borrowerNameBn,
			"accountNo": borrowerAccountNo,
			"phone":     borrowerPhone,
		},
	}

	if guarantorName != "" {
		result["guarantor"] = map[string]interface{}{
			"name":      guarantorName,
			"nameBn":    guarantorNameBn,
			"accountNo": guarantorAccountNo,
			"phone":     guarantorPhone,
		}
	}

	if !disbursementDate.IsZero() {
		result["disbursementDate"] = disbursementDate.Format(time.RFC3339)
	}
	if !installmentStartDate.IsZero() {
		result["installmentStartDate"] = installmentStartDate.Format(time.RFC3339)
	}
	if !expectedEndDate.IsZero() {
		result["expectedEndDate"] = expectedEndDate.Format(time.RFC3339)
	}
	if !completedAt.IsZero() && completedAt.Year() > 1 {
		result["completedAt"] = completedAt.Format(time.RFC3339)
	}

	// Get repayment history
	const repaymentQuery = `
		SELECT
			t.id,
			t.amount::bigint,
			t."receiptNumber",
			t.description,
			t."createdAt",
			COALESCE(u."nameEn", '') as processed_by
		FROM transactions t
		LEFT JOIN users u ON u.id = t."processedBy"
		WHERE t."loanId" = $1 AND t.type = 'LOAN_REPAYMENT'
		ORDER BY t."createdAt" ASC
	`

	rows, err := r.db.Query(ctx, repaymentQuery, loanID)
	if err == nil {
		defer rows.Close()
		repayments := []map[string]interface{}{}
		for rows.Next() {
			var txId, receipt, description, processedBy string
			var amount int64
			var createdAt time.Time
			if err := rows.Scan(&txId, &amount, &receipt, &description, &createdAt, &processedBy); err != nil {
				continue
			}
			repayments = append(repayments, map[string]interface{}{
				"id":          txId,
				"amount":      amount,
				"receipt":     receipt,
				"description": description,
				"date":        createdAt.Format(time.RFC3339),
				"processedBy": processedBy,
			})
		}
		result["repaymentHistory"] = repayments
	}

	return result, nil
}

// MarkLoanDefaulted writes the DEFAULTED status and runs the recovery waterfall
// in ONE transaction.
//
// It used to commit the status change and then call ProcessWaterfallRecovery,
// which opened a transaction of its own. When recovery failed — which it did for
// every loan without a guarantor, see waterfallRecoveryTx — the loan was already
// permanently defaulted with nothing recovered and no clean way to retry. A
// default that was never settled is not a state this domain has a name for.
// defaultableStatuses are the states a loan can be defaulted *from*. A loan
// that was never disbursed has no money to recover, and one already settled has
// nothing outstanding — in both cases marking it defaulted describes something
// that did not happen.
var defaultableStatuses = map[string]bool{
	"ACTIVE": true,
}

func (r *UserRepository) MarkLoanDefaulted(ctx context.Context, loanID, adminID, notes string) error {
	if strings.TrimSpace(loanID) == "" {
		return ErrLoanIDRequired
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after a successful commit is a no-op

	// Lock the row and read its status *before* changing anything.
	//
	// This used to be a bare `UPDATE ... WHERE id = $1`, which affects zero rows
	// and reports no error for a loan id that does not exist — so a typo wrote
	// an audit row about a loan nobody has and then failed further down with an
	// opaque 500. Worse, it did not look at the current status, so marking an
	// already-DEFAULTED loan defaulted a second time re-ran the whole recovery
	// waterfall: any savings the borrower or guarantor had deposited since the
	// first default were taken again, for a debt that had already been settled
	// against them. Two clicks on one button, and money left an account twice.
	var currentStatus, loanNumber, borrowerID string
	var totalInstallments, paidInstallments int
	var remainingAmount int64
	var installmentStart *time.Time
	err = tx.QueryRow(ctx, `
		SELECT
			status::text,
			"loanNumber",
			"borrowerId",
			"totalInstallments",
			"paidInstallments",
			"remainingAmount"::bigint,
			"installmentStartDate"
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`, loanID).Scan(&currentStatus, &loanNumber, &borrowerID, &totalInstallments, &paidInstallments, &remainingAmount, &installmentStart)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrLoanNotFound
	}
	if err != nil {
		return err
	}
	if !defaultableStatuses[currentStatus] {
		return fmt.Errorf("%w: loan is %s", ErrLoanNotDefaultable, currentStatus)
	}

	// `loan.missedPaymentsForDefault` is enforced HERE, and this is the only
	// place a loan becomes DEFAULTED.
	//
	// Until 2026-08-18 the setting was editable in the admin UI and read by
	// nothing: an admin could set "3 missed payments" and then default a loan
	// that had missed none, while the screen said the policy was in force. A
	// control that lies is worse than no control, and this one runs the
	// settlement waterfall — it takes the borrower's savings, then their
	// guarantor's.
	//
	// A loan with no installmentStartDate has never been put on a schedule, so
	// nothing can be overdue on it and MissedInstallments returns 0. That
	// correctly makes it undefaultable.
	threshold := r.getMissedPaymentsForDefaultTx(ctx, tx)
	var scheduleStart time.Time
	if installmentStart != nil {
		scheduleStart = *installmentStart
	}
	missed := money.MissedInstallments(scheduleStart, time.Now(), totalInstallments, paidInstallments)
	if !money.IsDefaultable(missed, threshold) {
		return fmt.Errorf("%w: %d of %d instalments missed, policy requires %d",
			ErrLoanNotYetDefaultable, missed, totalInstallments, threshold)
	}

	const updateQuery = `
		UPDATE loans
		SET status = 'DEFAULTED', "updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateQuery, loanID); err != nil {
		return err
	}

	// Create audit log. Checked: an unwritten audit row for a default is a
	// rule-6 problem, and this Exec used to discard its error entirely.
	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'MARK_LOAN_DEFAULTED', 'LOAN', $1, $2, NOW(), $3)
	`
	if _, err := tx.Exec(ctx, auditQuery, loanID, adminID, notes); err != nil {
		return fmt.Errorf("failed to write audit log: %w", err)
	}

	// The borrower is told before the waterfall runs, in the same transaction:
	// a default takes their savings and then their guarantor's, and finding
	// that out from a balance rather than from a message is not acceptable.
	defaultedTitle, defaultedMessage := notify.LoanDefaulted(loanNumber, remainingAmount)
	if err := r.insertNotificationTx(
		ctx, tx, "SYSTEM_ALERT", defaultedTitle, defaultedMessage, &borrowerID, nil,
	); err != nil {
		return fmt.Errorf("failed to notify borrower: %w", err)
	}

	if err := r.waterfallRecoveryTx(ctx, tx, loanID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// ProcessWaterfallRecovery runs the waterfall on its own. MarkLoanDefaulted no
// longer uses it — it shares its transaction via waterfallRecoveryTx — but the
// standalone form stays for re-running recovery against a loan already marked
// defaulted.
func (r *UserRepository) ProcessWaterfallRecovery(ctx context.Context, loanID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := r.waterfallRecoveryTx(ctx, tx, loanID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// waterfallRecoveryTx recovers a defaulted loan inside the caller's transaction:
// borrower's savings, then the guarantor's, then the donation pool, in that
// order and never past what is owed.
func (r *UserRepository) waterfallRecoveryTx(ctx context.Context, tx pgx.Tx, loanID string) error {
	// Get loan details.
	//
	// "guarantorId" is nullable — a loan below the guarantor threshold has none —
	// so it MUST be coalesced. Scanning NULL into a Go string fails, and because
	// this is the first statement the whole waterfall aborted before step 1 for
	// exactly those loans. The empty string is what the guarantor step below
	// already tests for.
	//
	// FOR UPDATE: recovery reads a balance, decides what to take, and writes it
	// back. Without the lock two concurrent defaults against one guarantor can
	// both draw the same savings.
	var remainingAmount int64
	var borrowerID, guarantorID, accountID string
	const loanQuery = `
		SELECT "remainingAmount", "borrowerId", COALESCE("guarantorId", ''), "accountId"
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`
	if err := tx.QueryRow(ctx, loanQuery, loanID).Scan(&remainingAmount, &borrowerID, &guarantorID, &accountID); err != nil {
		return err
	}

	amountToRecover := remainingAmount
	recoverySteps := []string{}

	// Step 1: Try to recover from borrower's savings
	if amountToRecover > 0 {
		var borrowerSavings int64
		var borrowerAccountID string
		err := tx.QueryRow(ctx, `SELECT "savingsBalance", id FROM accounts WHERE "userId" = $1 FOR UPDATE`, borrowerID).Scan(&borrowerSavings, &borrowerAccountID)
		if err == nil && borrowerSavings > 0 {
			deduction := money.RecoverFrom(amountToRecover, borrowerSavings)

			// Deduct from borrower. RETURNING gives the balance the ledger
			// row will record, rather than a second SELECT that could read a
			// different number (ADR-015).
			var newSavings int64
			if err := tx.QueryRow(ctx, `
				UPDATE accounts
				SET "savingsBalance" = "savingsBalance" - $1, "updatedAt" = NOW()
				WHERE id = $2
				RETURNING "savingsBalance"::bigint
			`, deduction, borrowerAccountID).Scan(&newSavings); err != nil {
				// Not skipped silently. This UPDATE failing used to leave the
				// step un-taken while the loan was still written down below,
				// so the debt vanished with nothing drawn against it.
				return fmt.Errorf("recover from borrower savings: %w", err)
			}

			// CONFIRMED, with both timestamps and the snapshot. The money moved
			// in this transaction; a PENDING withdrawal is a member's *notice*
			// that they intend to withdraw (FR-08, ADR-016), and writing one
			// here made every status-filtered aggregate under-count a recovery
			// that had already happened — including the reconciliation in
			// reconcile_repository.go, which is what found it.
			if _, err := tx.Exec(ctx, `
				INSERT INTO transactions (
					id, type, amount, description, status, "createdAt",
					"processedAt", "confirmedAt", "accountId", "userId", "loanId", "savingsAfter"
				)
				VALUES (
					gen_random_uuid()::text, 'WITHDRAWAL', $1, 'ডিফল্ট ঋণ পুনরুদ্ধার - ঋণগ্রহীতা', 'CONFIRMED', NOW(),
					NOW(), NOW(), $2, $3, $4, $5
				)
			`, deduction, borrowerAccountID, borrowerID, loanID, newSavings); err != nil {
				return err
			}

			amountToRecover -= deduction
			recoverySteps = append(recoverySteps, fmt.Sprintf("Recovered %d from borrower", deduction))
		}
	}

	// Step 2: Try to recover from guarantor's savings
	if amountToRecover > 0 && guarantorID != "" {
		var guarantorSavings int64
		var guarantorAccountID string
		err := tx.QueryRow(ctx, `SELECT "savingsBalance", id FROM accounts WHERE "userId" = $1 FOR UPDATE`, guarantorID).Scan(&guarantorSavings, &guarantorAccountID)
		if err == nil && guarantorSavings > 0 {
			deduction := money.RecoverFrom(amountToRecover, guarantorSavings)

			// Deduct from guarantor. Same shape as the borrower step above,
			// and the comments there apply here too.
			var newSavings int64
			if err := tx.QueryRow(ctx, `
				UPDATE accounts
				SET "savingsBalance" = "savingsBalance" - $1, "updatedAt" = NOW()
				WHERE id = $2
				RETURNING "savingsBalance"::bigint
			`, deduction, guarantorAccountID).Scan(&newSavings); err != nil {
				return fmt.Errorf("recover from guarantor savings: %w", err)
			}

			if _, err := tx.Exec(ctx, `
				INSERT INTO transactions (
					id, type, amount, description, status, "createdAt",
					"processedAt", "confirmedAt", "accountId", "userId", "loanId", "savingsAfter"
				)
				VALUES (
					gen_random_uuid()::text, 'WITHDRAWAL', $1, 'ডিফল্ট ঋণ পুনরুদ্ধার - জামিনদাতা', 'CONFIRMED', NOW(),
					NOW(), NOW(), $2, $3, $4, $5
				)
			`, deduction, guarantorAccountID, guarantorID, loanID, newSavings); err != nil {
				return err
			}

			amountToRecover -= deduction
			recoverySteps = append(recoverySteps, fmt.Sprintf("Recovered %d from guarantor", deduction))
		}
	}

	// Step 3: Use donation pool
	if amountToRecover > 0 {
		// The pool is what has been donated MINUS what earlier defaults already
		// drew from it. Summing donations alone let the same taka settle an
		// unlimited number of defaults, because nothing ever depleted the pool.
		var donationBalance int64
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(
				CASE WHEN type = 'DONATION' THEN amount ELSE -amount END
			)::bigint, 0)
			FROM transactions
			WHERE type = 'DONATION'
			   OR (type = 'FEE' AND "loanId" IS NOT NULL)
		`).Scan(&donationBalance); err != nil {
			return err
		}

		if donationBalance > 0 {
			deduction := money.RecoverFrom(amountToRecover, donationBalance)

			// "accountId" is NOT NULL, and this insert used to omit it — the row
			// silently failed while the loan was still written down, so the debt
			// vanished with no ledger entry behind it. The loan's own account
			// carries the entry, which keeps the draw traceable from the loan it
			// settled. The error is checked for the same reason.
			// CONFIRMED for the same reason as the two steps above: this row is
			// what depletes the pool, and the depletion query below sums it
			// without knowing that a status column exists. It moves no
			// `savingsBalance` — the pool is a balance of donations minus draws
			// — so it carries no `savingsAfter`.
			if _, err := tx.Exec(ctx, `
				INSERT INTO transactions (
					id, type, amount, description, status, "createdAt",
					"processedAt", "confirmedAt", "accountId", "userId", "loanId"
				)
				VALUES (
					gen_random_uuid()::text, 'FEE', $1, 'দাতব্য তহবিল থেকে ডিফল্ট ঋণ পুনরুদ্ধার', 'CONFIRMED', NOW(),
					NOW(), NOW(), $2, $3, $4
				)
			`, deduction, accountID, borrowerID, loanID); err != nil {
				return err
			}

			amountToRecover -= deduction
			recoverySteps = append(recoverySteps, fmt.Sprintf("Recovered %d from donation pool", deduction))
		}
	}

	// Update loan remaining amount
	newRemaining := amountToRecover
	if _, err := tx.Exec(ctx, `UPDATE loans SET "remainingAmount" = $1, "updatedAt" = NOW() WHERE id = $2`, newRemaining, loanID); err != nil {
		return err
	}

	// And the account's loanBalance, by the same amount, in the same
	// transaction.
	//
	// This was missing. The waterfall wrote the loan down and left
	// `accounts."loanBalance"` at the pre-default figure, so after any recovery
	// the member's dashboard showed a debt they no longer owed — permanently,
	// because nothing else ever recomputes it. Relative, per rule 2a: an
	// absolute write here would race the repayment path, which moves the same
	// column.
	if recovered := remainingAmount - newRemaining; recovered > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE accounts
			SET "loanBalance" = GREATEST("loanBalance" - $1, 0), "updatedAt" = NOW()
			WHERE id = $2
		`, recovered, accountID); err != nil {
			return fmt.Errorf("reduce loan balance after recovery: %w", err)
		}
	}

	// Create audit log. Checked, for the same reason as the one in
	// MarkLoanDefaulted: this row is the only record of which savings were drawn
	// to settle the debt, and it used to discard its error.
	recoveryDetails := fmt.Sprintf("Waterfall recovery completed. Steps: %v. Remaining: %d", recoverySteps, newRemaining)
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'WATERFALL_RECOVERY', 'LOAN', $1, NOW(), $2)
	`, loanID, recoveryDetails); err != nil {
		return fmt.Errorf("failed to write recovery audit log: %w", err)
	}

	return nil
}

// ==================== DONATION MANAGEMENT ====================

// CreateMemberLoan creates a loan for a member (worker action)
func (r *UserRepository) CreateMemberLoan(ctx context.Context, memberID, workerID string, amount int64, purpose string, installments int) (string, error) {
	minDepositRequired, maxLoanMultiplier, maxInstallmentMonths := r.getLoanPolicy(ctx)
	if installments < 1 || installments > maxInstallmentMonths {
		return "", errors.New("invalid installments")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Verify member exists, lock account row for consistent balance/eligibility checks.
	var status, accountID string
	var currentBalance, activeLoan int64
	err = tx.QueryRow(ctx, `
		SELECT
			u.status::text,
			a.id::text,
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status IN ('ACTIVE','PENDING_APPROVAL','PENDING_GUARANTOR')), 0)::bigint
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role::text = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&status, &accountID, &currentBalance, &activeLoan)
	if err != nil {
		return "", fmt.Errorf("member not found: %w", err)
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return "", errors.New("member not active")
	}
	if activeLoan > 0 {
		return "", errors.New("has active loan")
	}

	minDeposit := minDepositRequired
	if currentBalance < minDeposit {
		return "", errors.New("not eligible - insufficient deposit")
	}

	maxLoanAmount := money.MaxLoanAmount(currentBalance, maxLoanMultiplier)
	if amount > maxLoanAmount {
		return "", errors.New("exceeds limit")
	}

	loanNumber, err := r.nextDocumentNumber(ctx, tx, utils.SeriesLoan)
	if err != nil {
		return "", err
	}
	// The stored figure is the regular installment; the rounding remainder goes
	// into the final one, which the loan agreement PDF prints. See money.InstallmentPlan.
	installmentAmount, _ := money.InstallmentPlan(amount, installments)

	var loanID string
	err = tx.QueryRow(ctx, `
		INSERT INTO loans (
			id, "loanNumber", "accountId", "borrowerId", "principalAmount", "remainingAmount",
			"totalInstallments", "paidInstallments", "installmentAmount",
			purpose, status, "disbursementDate", "approvedAt", "approvedBy", "createdAt", "updatedAt"
		) VALUES (
			gen_random_uuid()::text, $1, $2, $3, $4, $5,
			$6, 0, $7,
			$8, 'ACTIVE', NOW(), NOW(), $9, NOW(), NOW()
		)
		RETURNING id
	`, loanNumber, accountID, memberID, amount, amount, installments, installmentAmount, purpose, workerID).Scan(&loanID)
	if err != nil {
		return "", fmt.Errorf("failed to create loan: %w", err)
	}

	var updatedLoanBalance int64
	err = tx.QueryRow(ctx, `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" + $1, "updatedAt" = NOW()
		WHERE id = $2
		RETURNING "loanBalance"::bigint
	`, amount, accountID).Scan(&updatedLoanBalance)
	if err != nil {
		return "", fmt.Errorf("failed to update account loan balance: %w", err)
	}

	description := purpose
	if strings.TrimSpace(description) == "" {
		description = "ঋণ বিতরণ"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (
			id, type, amount, "receiptNumber", description, status,
			"accountId", "userId", "loanId", "processedBy",
			"loanAfter", "processedAt", "confirmedAt", "createdAt"
		) VALUES (
			gen_random_uuid()::text, 'LOAN_DISBURSEMENT', $1, $2, $3, 'CONFIRMED',
			$4, $5, $6, $7,
			$8, NOW(), NOW(), NOW()
		)
	`, amount, loanNumber, description, accountID, memberID, loanID, workerID, updatedLoanBalance)
	if err != nil {
		return "", fmt.Errorf("failed to create loan disbursement transaction: %w", err)
	}

	memberTitle, memberMessage := notify.LoanDisbursed(loanNumber, amount)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"LOAN_APPROVED",
		memberTitle,
		memberMessage,
		&memberID,
		nil,
	); err != nil {
		return "", fmt.Errorf("failed to create member notification: %w", err)
	}
	staffTitle, staffMessage := notify.LoanDisbursedForStaff(loanNumber, memberID)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		staffTitle,
		staffMessage,
		nil,
		normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to create staff notification: %w", err)
	}

	if err := r.insertAuditLogTx(ctx, tx, "LOAN_DISBURSED", "LOAN", loanID, workerID,
		fmt.Sprintf("Loan %s of %d BDT disbursed to member %s over %d installments of %d", loanNumber, amount, memberID, installments, installmentAmount),
	); err != nil {
		return "", fmt.Errorf("failed to write audit log: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit loan creation: %w", err)
	}

	return loanNumber, nil
}

// AddMemberLoanPayment records a loan payment for a member

// AddMemberLoanPayment records a loan payment for a member
// ErrRepaymentExceedsBalance means the payment is larger than what is still
// owed. It is a sentinel because it is the outcome of a *race* as often as of a
// mistake, and the two are indistinguishable to the caller.
var ErrRepaymentExceedsBalance = errors.New("payment amount exceeds remaining balance")

func (r *UserRepository) AddMemberLoanPayment(ctx context.Context, memberID, processedByID, loanID string, amount int64, notes string) (string, error) {
	if amount <= 0 {
		return "", errors.New("amount must be positive")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after a successful commit is a no-op

	// Every read that a write depends on happens inside the transaction now.
	//
	// This method used to read the member, the account and the loan from the
	// pool *before* opening a transaction, check `amount > remainingAmount`
	// against that stale read, and then write back an absolute
	// `remainingAmount = remainingAmount - amount` computed in Go. That is
	// LEDGER-01 exactly (ADR-015), in a method the 2026-08-17 pass did not
	// reach: ten concurrent 1000-taka payments against a 5000-taka loan all
	// passed the check, all committed, and left `accounts."loanBalance"` at
	// -5000 with the loan's own remaining amount disagreeing with it. A member
	// double-tapping a button on a bad connection paid twice for one debt.
	var userId, accountId, status string
	if err := tx.QueryRow(ctx, `
		SELECT u.id, u.status::text, a.id
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role::text = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&userId, &status, &accountId); err != nil {
		return "", fmt.Errorf("member not found")
	}
	if status != "ACTIVE" {
		return "", fmt.Errorf("member account not active")
	}

	var loanStatus string
	if err := tx.QueryRow(ctx, `
		SELECT status::text
		FROM loans
		WHERE id = $1 AND "borrowerId" = $2
		FOR UPDATE
	`, loanID, memberID).Scan(&loanStatus); err != nil {
		return "", fmt.Errorf("loan not found")
	}
	if loanStatus != "ACTIVE" {
		return "", fmt.Errorf("loan is not active")
	}

	receiptNumber, err := r.nextDocumentNumber(ctx, tx, utils.SeriesLoanRepayment)
	if err != nil {
		return "", err
	}

	// Relative, guarded, and RETURNING the result (ADR-015). The
	// `"remainingAmount" >= $1` predicate is the overpayment check: it lives in
	// the same statement as the write, so there is no window between deciding
	// the payment fits and making it fit. Zero rows back means it no longer
	// does — someone else's payment landed first.
	var newRemaining int64
	err = tx.QueryRow(ctx, `
		UPDATE loans
		SET "remainingAmount" = "remainingAmount" - $1,
			"paidInstallments" = "paidInstallments" + 1,
			status = CASE WHEN "remainingAmount" - $1 <= 0 THEN 'COMPLETED'::"LoanStatus" ELSE status END,
			"completedAt" = CASE WHEN "remainingAmount" - $1 <= 0 THEN NOW() ELSE "completedAt" END,
			"updatedAt" = NOW()
		WHERE id = $2 AND "remainingAmount" >= $1
		RETURNING "remainingAmount"::bigint
	`, amount, loanID).Scan(&newRemaining)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrRepaymentExceedsBalance
	}
	if err != nil {
		return "", fmt.Errorf("failed to update loan: %w", err)
	}
	loanUpdateStatus := "ACTIVE"
	if newRemaining <= 0 {
		loanUpdateStatus = "COMPLETED"
	}

	// The account's loanBalance moves by the same amount, in the same
	// transaction, and RETURNING gives the value the receipt will carry —
	// rather than a second SELECT that could read a different number.
	var newLoanBalance int64
	if err := tx.QueryRow(ctx, `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" - $1,
			"updatedAt" = NOW()
		WHERE id = $2
		RETURNING "loanBalance"::bigint
	`, amount, accountId).Scan(&newLoanBalance); err != nil {
		return "", fmt.Errorf("failed to update account balance: %w", err)
	}

	// Create transaction record
	description := "Loan repayment"
	if notes != "" {
		description = notes
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (
			id, type, amount, "receiptNumber", description, status,
			"accountId", "userId", "loanId", "processedBy",
			"loanAfter", "processedAt", "confirmedAt", "createdAt"
		) VALUES (
			gen_random_uuid()::text, 'LOAN_REPAYMENT', $1, $2, $3, 'CONFIRMED',
			$4, $5, $6, $7,
			$8, NOW(), NOW(), NOW()
		)
	`, amount, receiptNumber, description, accountId, memberID, loanID, processedByID, newLoanBalance)
	if err != nil {
		return "", fmt.Errorf("failed to create transaction: %w", err)
	}

	memberTitle, memberMessage := notify.LoanRepaymentRecorded(amount, loanUpdateStatus == "COMPLETED")
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		memberTitle,
		memberMessage,
		&memberID,
		nil,
	); err != nil {
		return "", fmt.Errorf("failed to create member notification: %w", err)
	}
	staffTitle, staffMessage := notify.LoanRepaymentRecordedForStaff(memberID, amount)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		staffTitle,
		staffMessage,
		nil,
		normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to create staff notification: %w", err)
	}

	if err := r.insertAuditLogTx(ctx, tx, "LOAN_REPAYMENT_POSTED", "LOAN", loanID, processedByID,
		fmt.Sprintf("Repayment %d BDT on loan %s by member %s, receipt %s", amount, loanID, memberID, receiptNumber),
	); err != nil {
		return "", fmt.Errorf("failed to write audit log: %w", err)
	}

	// Commit transaction
	if err = tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit transaction: %w", err)
	}

	return receiptNumber, nil
}
