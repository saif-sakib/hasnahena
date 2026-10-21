package repositories

// Lending, end to end: request, approval, disbursement, repayment, default and
// the guarantor recovery waterfall. ZERO INTEREST (rule 3) — arithmetic lives
// in internal/money; this file is the SQL around it.

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

// Sentinel errors so handlers can answer 4xx, not 500 (rule 2b).
var (
	ErrLoanIDRequired     = errors.New("loanId is required")
	ErrLoanNotFound       = errors.New("loan not found")
	ErrLoanNotDefaultable = errors.New("loan is not in a state that can be defaulted")
	// ErrLoanNotYetDefaultable: not enough missed instalments yet — "wait",
	// not "never".
	ErrLoanNotYetDefaultable = errors.New("loan has not missed enough payments to be defaulted")
	ErrLoanNotPending        = errors.New("only pending loan requests")
)

func (r *UserRepository) ApproveLoan(ctx context.Context, loanID, approverID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// loanID is the loan number (ADR-044).
	loanNumber := loanID
	var principalAmount int64
	var borrowerID, loanStatus string
	const loanQuery = `
		SELECT
			"principalAmount"::bigint,
			"borrowerId",
			status::text
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`
	if err := tx.QueryRow(ctx, loanQuery, loanID).Scan(&principalAmount, &borrowerID, &loanStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLoanNotFound
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "PENDING_APPROVAL" {
		return fmt.Errorf("%w can be approved", ErrLoanNotPending)
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
		WHERE "userId" = $1
		RETURNING "loanBalance"::bigint, "savingsBalance"::bigint
	`
	if err := tx.QueryRow(ctx, updateAccountQuery, borrowerID, principalAmount).Scan(&updatedLoanBalance, &savingsBalance); err != nil {
		return err
	}

	disbursementNo, err := r.nextDocumentNumber(ctx, tx, utils.SeriesDisbursement)
	if err != nil {
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
			"userId",
			"loanId",
			"processedBy",
			"savingsAfter",
			"loanAfter"
		)
		VALUES (
			$1,
			'LOAN_DISBURSEMENT',
			$2,
			'Loan approved and disbursed',
			'CONFIRMED',
			NOW(),
			NOW(),
			NOW(),
			$3,
			$4,
			$5,
			$6,
			$7
		)
	`
	if _, err := tx.Exec(ctx, txnQuery, disbursementNo, principalAmount, borrowerID, loanID, approverID, savingsBalance, updatedLoanBalance); err != nil {
		return err
	}

	// Wording lives in internal/notify (WO-52).
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
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", "createdAt")
		VALUES ('APPROVE_LOAN', 'LOAN', $1, $2, NOW())
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

	loanNumber := loanID
	var borrowerID, loanStatus string
	if err := tx.QueryRow(ctx, `
		SELECT "borrowerId", status::text
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`, loanID).Scan(&borrowerID, &loanStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLoanNotFound
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "PENDING_APPROVAL" {
		return fmt.Errorf("%w can be rejected", ErrLoanNotPending)
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
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES ('REJECT_LOAN', 'LOAN', $1, $2, NOW(), $3)
	`
	_, _ = tx.Exec(ctx, auditQuery, loanID, approverID, reason)

	return tx.Commit(ctx)
}

func (r *UserRepository) CreateMemberLoanRepaymentRequest(ctx context.Context, memberID, loanID string, amount int64, bkashReference, notes string) (string, error) {
	reference := strings.TrimSpace(bkashReference)
	if reference == "" {
		return "", ErrBkashReferenceRequired
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var memberStatus, memberName string
	if err := tx.QueryRow(ctx, `
		SELECT
			u.status::text,
			COALESCE(u."nameEn", '')
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1
		  AND u.role = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&memberStatus, &memberName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrMemberNotFound
		}
		return "", fmt.Errorf("read member for repayment request: %w", err)
	}
	if strings.ToUpper(strings.TrimSpace(memberStatus)) != "ACTIVE" {
		return "", ErrMemberNotActive
	}

	var remainingAmount int64
	loanNumber := loanID
	var loanStatus string
	if err := tx.QueryRow(ctx, `
		SELECT
			"remainingAmount"::bigint,
			status::text
		FROM loans
		WHERE id = $1
		  AND "borrowerId" = $2
		FOR UPDATE
	`, loanID, memberID).Scan(&remainingAmount, &loanStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrLoanNotFound
		}
		return "", fmt.Errorf("read loan for repayment request: %w", err)
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "ACTIVE" {
		return "", ErrLoanNotActive
	}
	if amount > remainingAmount {
		return "", ErrRepaymentExceedsBalance
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
		  AND COALESCE(t."externalReference", '') = $4
		ORDER BY t."createdAt" DESC
		LIMIT 1
	`, memberID, loanID, amount, reference).Scan(&existingRequestID)
	if dupErr == nil {
		return "", fmt.Errorf("%w: loan repayment %s", ErrDuplicatePendingRequest, existingRequestID)
	}
	if !errors.Is(dupErr, pgx.ErrNoRows) {
		return "", dupErr
	}

	description := strings.TrimSpace(notes)
	if description == "" {
		description = "Member-submitted bKash loan repayment request"
	}

	// The repayment receipt number is the row id, issued at request time.
	requestID, err := r.nextDocumentNumber(ctx, tx, utils.SeriesLoanRepayment)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO transactions (
			id,
			type,
			amount,
			"externalReference",
			description,
			status,
			"createdAt",
			"userId",
			"loanId"
		) VALUES (
			$1,
			'LOAN_REPAYMENT',
			$2,
			$3,
			$4,
			'PENDING',
			NOW(),
			$5,
			$6
		)
	`, requestID, amount, reference, description, memberID, loanID); err != nil {
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
			COALESCE(l."approvedAt", '0001-01-01'::timestamp),
			COALESCE(l."disbursementDate", '0001-01-01'::timestamp),
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l."totalInstallments",
			l."installmentAmount"::bigint,
			l."paidInstallments",
			-- Schedule start, for money.NextDueDate.
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
		JOIN accounts ac ON ac."userId" = l."borrowerId"
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
		query += fmt.Sprintf(` AND (b."nameEn" ILIKE $%d OR b."accountNo" ILIKE $%d OR l.id ILIKE $%d)`, argCount, argCount, argCount)
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
		var id, purpose, status, approvedBy, borrowerID, borrowerName, borrowerNameBn, borrowerAccountNo, guarantorID, guarantorName, guarantorAccountNo string
		var principalAmount, remainingAmount, installmentAmount, memberDeposit int64
		var totalInstallments, paidInstallments int
		var approvedAt, disbursementDate, expectedEndDate, completedAt, createdAt time.Time
		var installmentStart *time.Time

		if err := rows.Scan(&id, &approvedAt, &disbursementDate, &principalAmount, &remainingAmount, &totalInstallments, &installmentAmount, &paidInstallments,
			&installmentStart, &expectedEndDate, &completedAt, &purpose, &status, &createdAt, &approvedBy, &memberDeposit,
			&borrowerID, &borrowerName, &borrowerNameBn, &borrowerAccountNo, &guarantorID, &guarantorName, &guarantorAccountNo); err != nil {
			continue
		}

		loan := map[string]interface{}{
			// `id` is the loan number (ADR-044); there is no second field for it.
			"id":                 id,
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
			-- Both pending labels (WO-71).
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

	var id, purpose, status, borrowerName, borrowerNameBn, borrowerAccountNo, borrowerPhone string
	var guarantorName, guarantorNameBn, guarantorAccountNo, guarantorPhone string
	var principalAmount, remainingAmount, installmentAmount int64
	var totalInstallments, paidInstallments int
	var disbursementDate, installmentStartDate, expectedEndDate, completedAt, createdAt time.Time

	if err := r.db.QueryRow(ctx, loanQuery, loanID).Scan(
		&id, &principalAmount, &remainingAmount, &totalInstallments, &installmentAmount, &paidInstallments,
		&disbursementDate, &installmentStartDate, &expectedEndDate, &completedAt, &purpose, &status, &createdAt,
		&borrowerName, &borrowerNameBn, &borrowerAccountNo, &borrowerPhone,
		&guarantorName, &guarantorNameBn, &guarantorAccountNo, &guarantorPhone); err != nil {
		return nil, err
	}

	result := map[string]interface{}{
		"id":                id,
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
			var txId, description, processedBy string
			var amount int64
			var createdAt time.Time
			if err := rows.Scan(&txId, &amount, &description, &createdAt, &processedBy); err != nil {
				continue
			}
			repayments = append(repayments, map[string]interface{}{
				"id":          txId,
				"amount":      amount,
				"description": description,
				"date":        createdAt.Format(time.RFC3339),
				"processedBy": processedBy,
			})
		}
		result["repaymentHistory"] = repayments
	}

	return result, nil
}

// defaultableStatuses are the states a loan can be defaulted from: never
// disbursed or already settled means nothing to recover.
var defaultableStatuses = map[string]bool{
	"ACTIVE": true,
}

// MarkLoanDefaulted writes DEFAULTED and runs the recovery waterfall in ONE
// transaction, so a failed recovery leaves the loan untouched.
func (r *UserRepository) MarkLoanDefaulted(ctx context.Context, loanID, adminID, notes string) error {
	if strings.TrimSpace(loanID) == "" {
		return ErrLoanIDRequired
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after a successful commit is a no-op

	// Lock the row and check status first: a missing id must not write an
	// audit row, and re-defaulting re-ran the waterfall and took money twice.
	loanNumber := loanID
	var currentStatus, borrowerID string
	var totalInstallments, paidInstallments int
	var remainingAmount int64
	var installmentStart *time.Time
	err = tx.QueryRow(ctx, `
		SELECT
			status::text,
			"borrowerId",
			"totalInstallments",
			"paidInstallments",
			"remainingAmount"::bigint,
			"installmentStartDate"
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`, loanID).Scan(&currentStatus, &borrowerID, &totalInstallments, &paidInstallments, &remainingAmount, &installmentStart)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrLoanNotFound
	}
	if err != nil {
		return err
	}
	if !defaultableStatuses[currentStatus] {
		return fmt.Errorf("%w: loan is %s", ErrLoanNotDefaultable, currentStatus)
	}

	// `loan.missedPaymentsForDefault` is enforced HERE, the only place a loan
	// becomes DEFAULTED. A loan with no installmentStartDate is undefaultable.
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

	// Audit write is checked (rule 6).
	const auditQuery = `
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES ('MARK_LOAN_DEFAULTED', 'LOAN', $1, $2, NOW(), $3)
	`
	if _, err := tx.Exec(ctx, auditQuery, loanID, adminID, notes); err != nil {
		return fmt.Errorf("failed to write audit log: %w", err)
	}

	// The borrower is notified in the same transaction, before the waterfall.
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

// waterfallRecoveryTx recovers a defaulted loan inside the caller's transaction:
// borrower's savings, then the guarantor's, then the donation pool, in that
// order and never past what is owed.
func (r *UserRepository) waterfallRecoveryTx(ctx context.Context, tx pgx.Tx, loanID string) error {
	// guarantorId is nullable (small loans have none) and must be coalesced.
	// FOR UPDATE so concurrent defaults cannot draw the same savings.
	var remainingAmount int64
	var borrowerID, guarantorID string
	const loanQuery = `
		SELECT "remainingAmount", "borrowerId", COALESCE("guarantorId", '')
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`
	if err := tx.QueryRow(ctx, loanQuery, loanID).Scan(&remainingAmount, &borrowerID, &guarantorID); err != nil {
		return err
	}

	amountToRecover := remainingAmount
	recoverySteps := []string{}

	// Step 1: Try to recover from borrower's savings
	if amountToRecover > 0 {
		var borrowerSavings int64
		err := tx.QueryRow(ctx, `SELECT "savingsBalance" FROM accounts WHERE "userId" = $1 FOR UPDATE`, borrowerID).Scan(&borrowerSavings)
		if err == nil && borrowerSavings > 0 {
			deduction := money.RecoverFrom(amountToRecover, borrowerSavings)

			// RETURNING gives the balance the ledger row records (ADR-015).
			var newSavings int64
			if err := tx.QueryRow(ctx, `
				UPDATE accounts
				SET "savingsBalance" = "savingsBalance" - $1, "updatedAt" = NOW()
				WHERE "userId" = $2
				RETURNING "savingsBalance"::bigint
			`, deduction, borrowerID).Scan(&newSavings); err != nil {
				return fmt.Errorf("recover from borrower savings: %w", err)
			}

			// CONFIRMED: the money moved here; PENDING would vanish from every
			// status-filtered aggregate (ADR-016). Gets a withdrawal receipt.
			borrowerReceipt, err := r.nextDocumentNumber(ctx, tx, utils.SeriesWithdrawal)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO transactions (
					id, type, amount, description, status, "createdAt",
					"processedAt", "confirmedAt", "userId", "loanId", "savingsAfter"
				)
				VALUES (
					$1, 'WITHDRAWAL', $2, 'ডিফল্ট ঋণ পুনরুদ্ধার - ঋণগ্রহীতা', 'CONFIRMED', NOW(),
					NOW(), NOW(), $3, $4, $5
				)
			`, borrowerReceipt, deduction, borrowerID, loanID, newSavings); err != nil {
				return err
			}

			amountToRecover -= deduction
			recoverySteps = append(recoverySteps, fmt.Sprintf("Recovered %d from borrower", deduction))
		}
	}

	// Step 2: Try to recover from guarantor's savings
	if amountToRecover > 0 && guarantorID != "" {
		var guarantorSavings int64
		err := tx.QueryRow(ctx, `SELECT "savingsBalance" FROM accounts WHERE "userId" = $1 FOR UPDATE`, guarantorID).Scan(&guarantorSavings)
		if err == nil && guarantorSavings > 0 {
			deduction := money.RecoverFrom(amountToRecover, guarantorSavings)

			// Same shape as the borrower step.
			var newSavings int64
			if err := tx.QueryRow(ctx, `
				UPDATE accounts
				SET "savingsBalance" = "savingsBalance" - $1, "updatedAt" = NOW()
				WHERE "userId" = $2
				RETURNING "savingsBalance"::bigint
			`, deduction, guarantorID).Scan(&newSavings); err != nil {
				return fmt.Errorf("recover from guarantor savings: %w", err)
			}

			guarantorReceipt, err := r.nextDocumentNumber(ctx, tx, utils.SeriesWithdrawal)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO transactions (
					id, type, amount, description, status, "createdAt",
					"processedAt", "confirmedAt", "userId", "loanId", "savingsAfter"
				)
				VALUES (
					$1, 'WITHDRAWAL', $2, 'ডিফল্ট ঋণ পুনরুদ্ধার - জামিনদাতা', 'CONFIRMED', NOW(),
					NOW(), NOW(), $3, $4, $5
				)
			`, guarantorReceipt, deduction, guarantorID, loanID, newSavings); err != nil {
				return err
			}

			amountToRecover -= deduction
			recoverySteps = append(recoverySteps, fmt.Sprintf("Recovered %d from guarantor", deduction))
		}
	}

	// Step 3: Use donation pool
	if amountToRecover > 0 {
		// Pool = donations MINUS earlier draws, or one taka settles many defaults.
		// Settled rows only: a posting that moved no money cannot fund a recovery (ADR-016).
		var donationBalance int64
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(
				CASE WHEN type = 'DONATION' THEN amount ELSE -amount END
			)::bigint, 0)
			FROM transactions
			WHERE status IN `+settledStatuses+`
			  AND (type = 'DONATION' OR (type = 'FEE' AND "loanId" IS NOT NULL))
		`).Scan(&donationBalance); err != nil {
			return err
		}

		if donationBalance > 0 {
			deduction := money.RecoverFrom(amountToRecover, donationBalance)

			// ADJ series, not FEE — the platform charges none (rule 3).
			// CONFIRMED so the depletion query counts it; moves no savingsBalance.
			poolReceipt, err := r.nextDocumentNumber(ctx, tx, utils.SeriesAdjustment)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO transactions (
					id, type, amount, description, status, "createdAt",
					"processedAt", "confirmedAt", "userId", "loanId"
				)
				VALUES (
					$1, 'FEE', $2, 'দাতব্য তহবিল থেকে ডিফল্ট ঋণ পুনরুদ্ধার', 'CONFIRMED', NOW(),
					NOW(), NOW(), $3, $4
				)
			`, poolReceipt, deduction, borrowerID, loanID); err != nil {
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

	// accounts.loanBalance moves by the same amount, relatively (rule 2a).
	if recovered := remainingAmount - newRemaining; recovered > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE accounts
			SET "loanBalance" = GREATEST("loanBalance" - $1, 0), "updatedAt" = NOW()
			WHERE "userId" = $2
		`, recovered, borrowerID); err != nil {
			return fmt.Errorf("reduce loan balance after recovery: %w", err)
		}
	}

	// Audit write is checked: the only record of which savings were drawn.
	recoveryDetails := fmt.Sprintf("Waterfall recovery completed. Steps: %v. Remaining: %d", recoverySteps, newRemaining)
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (action, "entityType", "entityId", "createdAt", details)
		VALUES ('WATERFALL_RECOVERY', 'LOAN', $1, NOW(), $2)
	`, loanID, recoveryDetails); err != nil {
		return fmt.Errorf("failed to write recovery audit log: %w", err)
	}

	return nil
}

// CreateMemberLoan creates a loan for a member (worker action).
func (r *UserRepository) CreateMemberLoan(ctx context.Context, memberID, workerID string, amount int64, purpose string, installments int) (string, error) {
	minDepositRequired, maxLoanMultiplier, maxInstallmentMonths := r.getLoanPolicy(ctx)
	if installments < 1 || installments > maxInstallmentMonths {
		return "", ErrInvalidInstallments
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Verify member exists, lock account row for consistent balance/eligibility checks.
	var status string
	var currentBalance, activeLoan int64
	err = tx.QueryRow(ctx, `
		SELECT
			u.status::text,
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status IN ('ACTIVE','PENDING_APPROVAL','PENDING_GUARANTOR')), 0)::bigint
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role::text = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&status, &currentBalance, &activeLoan)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrMemberNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read member for loan: %w", err)
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return "", ErrMemberNotActive
	}
	if activeLoan > 0 {
		return "", ErrActiveLoanExists
	}

	minDeposit := minDepositRequired
	if currentBalance < minDeposit {
		return "", ErrLoanNotEligible
	}

	maxLoanAmount := money.MaxLoanAmount(currentBalance, maxLoanMultiplier)
	if amount > maxLoanAmount {
		return "", ErrLoanExceedsLimit
	}

	loanNumber, err := r.nextDocumentNumber(ctx, tx, utils.SeriesLoan)
	if err != nil {
		return "", err
	}
	// Regular instalment stored; the remainder goes in the final one (money.InstallmentPlan).
	installmentAmount, _ := money.InstallmentPlan(amount, installments)

	// The loan number IS the row (ADR-044), so there is nothing to read back.
	loanID := loanNumber
	if _, err = tx.Exec(ctx, `
		INSERT INTO loans (
			id, "borrowerId", "principalAmount", "remainingAmount",
			"totalInstallments", "paidInstallments", "installmentAmount",
			purpose, status, "disbursementDate", "approvedAt", "approvedBy", "createdAt", "updatedAt"
		) VALUES (
			$1, $2, $3, $4,
			$5, 0, $6,
			$7, 'ACTIVE', NOW(), NOW(), $8, NOW(), NOW()
		)
	`, loanNumber, memberID, amount, amount, installments, installmentAmount, purpose, workerID); err != nil {
		return "", fmt.Errorf("failed to create loan: %w", err)
	}

	var updatedLoanBalance int64
	err = tx.QueryRow(ctx, `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" + $1, "updatedAt" = NOW()
		WHERE "userId" = $2
		RETURNING "loanBalance"::bigint
	`, amount, memberID).Scan(&updatedLoanBalance)
	if err != nil {
		return "", fmt.Errorf("failed to update account loan balance: %w", err)
	}

	description := purpose
	if strings.TrimSpace(description) == "" {
		description = "ঋণ বিতরণ"
	}
	// The posting gets a DSB- number of its own, distinct from the loan's.
	disbursementNo, err := r.nextDocumentNumber(ctx, tx, utils.SeriesDisbursement)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (
			id, type, amount, description, status,
			"userId", "loanId", "processedBy",
			"loanAfter", "processedAt", "confirmedAt", "createdAt"
		) VALUES (
			$1, 'LOAN_DISBURSEMENT', $2, $3, 'CONFIRMED',
			$4, $5, $6,
			$7, NOW(), NOW(), NOW()
		)
	`, disbursementNo, amount, description, memberID, loanID, workerID, updatedLoanBalance)
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

// Sentinels for the worker loan path (rule 2b).
var (
	ErrInvalidInstallments = errors.New("invalid installments")
	ErrActiveLoanExists    = errors.New("has active loan")
	ErrLoanNotEligible     = errors.New("not eligible - insufficient deposit")
	ErrLoanExceedsLimit    = errors.New("exceeds limit")
)

// Sentinels for the top-up path (rule 2b).
var (
	// ErrLoanNotActive: adding to a COMPLETED/DEFAULTED loan would resurrect it.
	ErrLoanNotActive = errors.New("loan is not active")
	// ErrTopUpExceedsLimit: the TOTAL owed would exceed loan.maxLoanMultiplier ×
	// savings (measured on the total, not the increment).
	ErrTopUpExceedsLimit = errors.New("top-up would exceed the member's borrowing limit")
)

// AddLoanTopUp adds principal to a running loan (staff action), keeping its
// number and history. principalAmount and remainingAmount both rise;
// totalInstallments does not, so remaining instalments grow (money.TopUpPlan).
// No rate or fee (rule 3). Writes one CONFIRMED LOAN_DISBURSEMENT row.
func (r *UserRepository) AddLoanTopUp(ctx context.Context, memberID, staffID, loanID string, amount int64, notes string) (string, error) {
	if amount <= 0 {
		return "", errors.New("amount must be positive")
	}
	if strings.TrimSpace(loanID) == "" {
		return "", ErrLoanIDRequired
	}

	// Pool read BEFORE the transaction (ADR-017).
	_, maxLoanMultiplier, _ := r.getLoanPolicy(ctx)

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after a successful commit is a no-op

	// Account then loan — the lock order every money path uses.
	var memberStatus string
	var savingsBalance int64
	if err := tx.QueryRow(ctx, `
		SELECT u.status::text, COALESCE(a."savingsBalance", 0)::bigint
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role::text = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&memberStatus, &savingsBalance); err != nil {
		return "", ErrMemberNotFound
	}
	if strings.ToUpper(strings.TrimSpace(memberStatus)) != "ACTIVE" {
		return "", ErrMemberNotActive
	}

	loanNumber := loanID
	var loanStatus string
	var principal, remaining int64
	var totalInstallments, paidInstallments int
	if err := tx.QueryRow(ctx, `
		SELECT status::text,
			"principalAmount"::bigint, "remainingAmount"::bigint,
			"totalInstallments", "paidInstallments"
		FROM loans
		WHERE id = $1 AND "borrowerId" = $2
		FOR UPDATE
	`, loanID, memberID).Scan(
		&loanStatus, &principal, &remaining, &totalInstallments, &paidInstallments,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrLoanNotFound
		}
		return "", err
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "ACTIVE" {
		return "", fmt.Errorf("%w: loan %s is %s", ErrLoanNotActive, loanNumber, loanStatus)
	}

	newRemaining := remaining + amount
	maxLoanAmount := money.MaxLoanAmount(savingsBalance, maxLoanMultiplier)
	if newRemaining > maxLoanAmount {
		return "", fmt.Errorf("%w: this member may owe at most %d BDT against savings of %d BDT, and would owe %d",
			ErrTopUpExceedsLimit, maxLoanAmount, savingsBalance, newRemaining)
	}

	installmentAmount, _ := money.TopUpPlan(newRemaining, totalInstallments, paidInstallments)

	// Relative write with RETURNING (ADR-015).
	var updatedPrincipal, updatedRemaining int64
	if err := tx.QueryRow(ctx, `
		UPDATE loans
		SET "principalAmount" = "principalAmount" + $1,
			"remainingAmount" = "remainingAmount" + $1,
			"installmentAmount" = $2,
			"updatedAt" = NOW()
		WHERE id = $3 AND status = 'ACTIVE'
		RETURNING "principalAmount"::bigint, "remainingAmount"::bigint
	`, amount, installmentAmount, loanID).Scan(&updatedPrincipal, &updatedRemaining); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrLoanNotActive
		}
		return "", err
	}

	var updatedLoanBalance int64
	if err := tx.QueryRow(ctx, `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" + $1, "updatedAt" = NOW()
		WHERE "userId" = $2
		RETURNING "loanBalance"::bigint
	`, amount, memberID).Scan(&updatedLoanBalance); err != nil {
		return "", fmt.Errorf("failed to update account loan balance: %w", err)
	}

	// DSB-, not LOAN-: a top-up is a posting, not a new loan.
	receipt, err := r.nextDocumentNumber(ctx, tx, utils.SeriesDisbursement)
	if err != nil {
		return "", err
	}

	description := strings.TrimSpace(notes)
	if description == "" {
		description = fmt.Sprintf("ঋণ বৃদ্ধি (%s)", loanNumber)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO transactions (
			id, type, amount, description, status,
			"userId", "loanId", "processedBy",
			"loanAfter", "processedAt", "confirmedAt", "createdAt"
		) VALUES (
			$1, 'LOAN_DISBURSEMENT', $2, $3, 'CONFIRMED',
			$4, $5, $6,
			$7, NOW(), NOW(), NOW()
		)
	`, receipt, amount, description, memberID, loanID, staffID, updatedLoanBalance); err != nil {
		return "", fmt.Errorf("failed to record the top-up: %w", err)
	}

	memberTitle, memberMessage := notify.LoanToppedUp(loanNumber, amount, updatedRemaining, installmentAmount)
	if err := r.insertNotificationTx(
		ctx, tx, "LOAN_APPROVED", memberTitle, memberMessage, &memberID, nil,
	); err != nil {
		return "", fmt.Errorf("failed to create member notification: %w", err)
	}
	staffTitle, staffMessage := notify.LoanToppedUpForStaff(loanNumber, memberID)
	if err := r.insertNotificationTx(
		ctx, tx, "SYSTEM_ALERT", staffTitle, staffMessage, nil, normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to create staff notification: %w", err)
	}

	if err := r.insertAuditLogTx(ctx, tx, "LOAN_TOPPED_UP", "LOAN", loanID, staffID,
		fmt.Sprintf("Loan %s increased by %d BDT for member %s, receipt %s, principal %d -> %d, owing %d -> %d, instalment now %d over %d remaining of %d",
			loanNumber, amount, memberID, receipt, principal, updatedPrincipal,
			remaining, updatedRemaining,
			installmentAmount, money.RemainingInstallments(totalInstallments, paidInstallments), totalInstallments),
	); err != nil {
		return "", fmt.Errorf("failed to write audit log: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit loan top-up: %w", err)
	}

	return receipt, nil
}

// ErrRepaymentExceedsBalance: overpayment, often the loser of a race.
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

	// Every read a write depends on happens inside the transaction (ADR-015).
	var userId, status string
	if err := tx.QueryRow(ctx, `
		SELECT u.id, u.status::text
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role::text = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&userId, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrMemberNotFound
		}
		return "", fmt.Errorf("read member for repayment: %w", err)
	}
	if status != "ACTIVE" {
		return "", ErrMemberNotActive
	}

	var loanStatus string
	if err := tx.QueryRow(ctx, `
		SELECT status::text
		FROM loans
		WHERE id = $1 AND "borrowerId" = $2
		FOR UPDATE
	`, loanID, memberID).Scan(&loanStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrLoanNotFound
		}
		return "", fmt.Errorf("read loan for repayment: %w", err)
	}
	if loanStatus != "ACTIVE" {
		return "", ErrLoanNotActive
	}

	receiptNumber, err := r.nextDocumentNumber(ctx, tx, utils.SeriesLoanRepayment)
	if err != nil {
		return "", err
	}

	// Relative write; `"remainingAmount" >= $1` is the overpayment check in
	// the same statement. Zero rows means another payment landed first.
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

	// loanBalance moves by the same amount; RETURNING feeds the receipt.
	var newLoanBalance int64
	if err := tx.QueryRow(ctx, `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" - $1,
			"updatedAt" = NOW()
		WHERE "userId" = $2
		RETURNING "loanBalance"::bigint
	`, amount, memberID).Scan(&newLoanBalance); err != nil {
		return "", fmt.Errorf("failed to update account balance: %w", err)
	}

	// Create transaction record
	description := "Loan repayment"
	if notes != "" {
		description = notes
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (
			id, type, amount, description, status,
			"userId", "loanId", "processedBy",
			"loanAfter", "processedAt", "confirmedAt", "createdAt"
		) VALUES (
			$1, 'LOAN_REPAYMENT', $2, $3, 'CONFIRMED',
			$4, $5, $6,
			$7, NOW(), NOW(), NOW()
		)
	`, receiptNumber, amount, description, memberID, loanID, processedByID, newLoanBalance)
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
