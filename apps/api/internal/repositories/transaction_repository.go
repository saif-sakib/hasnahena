package repositories

// Deposits, withdrawals and donations. Every balance change runs in ONE
// transaction with its audit_logs row (rules 2 and 6).

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"hasnahena/apps/api/internal/notify"
	"hasnahena/apps/api/internal/utils"
)

// DonationFundUserID owns the donation pool account; set by `pnpm db:seed`.
// accounts.userId is unique, so the FOR UPDATE lookup names exactly one row.
const DonationFundUserID = "system_donation_fund"

// ErrDonationPoolMissing is a deployment fault: 503 naming the fix.
var ErrDonationPoolMissing = errors.New(
	"the donation pool account (owned by " + DonationFundUserID + ") is missing — run `pnpm db:seed` against this database")

// Withdrawal refusals are sentinels, matched with errors.Is (rule 2b). There is
// no notice-period gate (ADR-030); a payout still settles an outstanding
// PENDING withdrawal — see claimOutstandingWithdrawalNotice.
var (
	ErrMemberNotFound             = errors.New("member not found")
	ErrMemberNotActive            = errors.New("member not active")
	ErrInsufficientBalance        = errors.New("insufficient balance")
	ErrActiveLoanBlocksWithdrawal = errors.New("member has an active loan")
	ErrGuarantorBlocksWithdrawal  = errors.New("member is guarantor for an active loan")

	// The request → process → confirm lifecycle (rule 2b).
	ErrBkashReferenceRequired  = errors.New("bkash reference is required")
	ErrDuplicatePendingRequest = errors.New("duplicate pending request")
	ErrRequestNotFound         = errors.New("transaction request not found")
	ErrRequestNotPending       = errors.New("only pending transactions")
	ErrMissingLoanReference    = errors.New("loan repayment request missing loan reference")
	ErrUnsupportedRequestType  = errors.New("unsupported transaction type")
)

// formatNoticeDate matches the generated documents' en-GB date format.
func formatNoticeDate(t time.Time) string {
	return t.Format("02 Jan 2006")
}

func (r *UserRepository) ApproveWithdrawal(ctx context.Context, requestID, approverID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var txType, txStatus, memberID, loanID string
	var amount int64
	var createdAt time.Time
	const getQuery = `
		SELECT
			type::text,
			status::text,
			amount::bigint,
			"userId",
			COALESCE("loanId"::text, ''),
			"createdAt"
		FROM transactions
		WHERE id = $1
		FOR UPDATE
	`
	if err := tx.QueryRow(ctx, getQuery, requestID).Scan(&txType, &txStatus, &amount, &memberID, &loanID, &createdAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRequestNotFound
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(txStatus)) != "PENDING" {
		return fmt.Errorf("%w can be approved", ErrRequestNotPending)
	}
	txType = strings.ToUpper(strings.TrimSpace(txType))

	switch txType {
	case "DEPOSIT":
		// Credited relatively (ADR-015).
		var newSavings, loanBalance int64
		if err := tx.QueryRow(ctx, `
			UPDATE accounts
			SET "savingsBalance" = "savingsBalance" + $1, "updatedAt" = NOW()
			WHERE "userId" = $2
			RETURNING "savingsBalance"::bigint, "loanBalance"::bigint
		`, amount, memberID).Scan(&newSavings, &loanBalance); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE transactions
			SET status = 'CONFIRMED', "processedAt" = NOW(), "confirmedAt" = NOW(), "processedBy" = $2, "savingsAfter" = $3, "loanAfter" = $4
			WHERE id = $1
		`, requestID, approverID, newSavings, loanBalance); err != nil {
			return err
		}
		approvedTitle, approvedMessage := notify.DepositRequestApproved(amount)
		if err := r.insertNotificationTx(
			ctx,
			tx,
			"DEPOSIT_CONFIRMED",
			approvedTitle,
			approvedMessage,
			&memberID,
			nil,
		); err != nil {
			return fmt.Errorf("failed to notify member: %w", err)
		}
	case "WITHDRAWAL":
		// No maturity gate (ADR-030): marks the request ready for the desk.
		// Money moves in AddMemberWithdrawal, which settles this row.
		if _, err := tx.Exec(ctx, `
			UPDATE transactions
			SET status = 'PROCESSED', "processedAt" = NOW(), "processedBy" = $2
			WHERE id = $1
		`, requestID, approverID); err != nil {
			return err
		}
		readyTitle, readyMessage := notify.WithdrawalRequestReady(amount)
		if err := r.insertNotificationTx(
			ctx,
			tx,
			"SYSTEM_ALERT",
			readyTitle,
			readyMessage,
			&memberID,
			nil,
		); err != nil {
			return fmt.Errorf("failed to notify member: %w", err)
		}
	case "LOAN_REPAYMENT":
		if strings.TrimSpace(loanID) == "" {
			return ErrMissingLoanReference
		}

		var remainingAmount int64
		var loanStatus string
		if err := tx.QueryRow(ctx, `
			SELECT "remainingAmount"::bigint, status::text
			FROM loans
			WHERE id = $1 AND "borrowerId" = $2
			FOR UPDATE
		`, loanID, memberID).Scan(&remainingAmount, &loanStatus); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrLoanNotFound
			}
			return err
		}
		normalizedLoanStatus := strings.ToUpper(strings.TrimSpace(loanStatus))
		if normalizedLoanStatus != "ACTIVE" {
			return ErrLoanNotActive
		}
		if amount > remainingAmount {
			return ErrRepaymentExceedsBalance
		}

		newRemaining := remainingAmount - amount
		loanUpdateStatus := "ACTIVE"
		if newRemaining <= 0 {
			loanUpdateStatus = "COMPLETED"
		}

		if _, err := tx.Exec(ctx, `
			UPDATE loans
			SET "remainingAmount" = $1,
				"paidInstallments" = "paidInstallments" + 1,
				status = $2::"LoanStatus",
				"completedAt" = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE "completedAt" END,
				"updatedAt" = NOW()
			WHERE id = $3
		`, newRemaining, loanUpdateStatus, loanID); err != nil {
			return err
		}

		var newLoanBalance, savingsBalance int64
		if err := tx.QueryRow(ctx, `
			UPDATE accounts
			SET "loanBalance" = GREATEST("loanBalance" - $1, 0),
				"updatedAt" = NOW()
			WHERE "userId" = $2
			RETURNING "loanBalance"::bigint, "savingsBalance"::bigint
		`, amount, memberID).Scan(&newLoanBalance, &savingsBalance); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
			UPDATE transactions
			SET status = 'CONFIRMED',
				"processedAt" = NOW(),
				"confirmedAt" = NOW(),
				"processedBy" = $2,
				"savingsAfter" = $3,
				"loanAfter" = $4
			WHERE id = $1
		`, requestID, approverID, savingsBalance, newLoanBalance); err != nil {
			return err
		}

		memberTitle, memberMessage := notify.LoanRepaymentRequestApproved(amount, loanUpdateStatus == "COMPLETED")
		if err := r.insertNotificationTx(
			ctx,
			tx,
			"SYSTEM_ALERT",
			memberTitle,
			memberMessage,
			&memberID,
			nil,
		); err != nil {
			return fmt.Errorf("failed to notify member: %w", err)
		}
	default:
		return ErrUnsupportedRequestType
	}

	// Checked: a failed insert aborts the transaction, and the commit would fail without saying why.
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", "createdAt")
		VALUES ('APPROVE_TRANSACTION', 'TRANSACTION', $1, $2, NOW())
	`, requestID, approverID); err != nil {
		return fmt.Errorf("failed to write audit log: %w", err)
	}

	return tx.Commit(ctx)
}

func (r *UserRepository) RejectWithdrawal(ctx context.Context, requestID, approverID, reason string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var txStatus, txType, memberID string
	if err := tx.QueryRow(ctx, `
		SELECT status::text, type::text, "userId"
		FROM transactions
		WHERE id = $1
		FOR UPDATE
	`, requestID).Scan(&txStatus, &txType, &memberID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRequestNotFound
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(txStatus)) != "PENDING" {
		return fmt.Errorf("%w can be rejected", ErrRequestNotPending)
	}
	txType = strings.ToUpper(strings.TrimSpace(txType))
	if txType != "DEPOSIT" && txType != "WITHDRAWAL" && txType != "LOAN_REPAYMENT" {
		return ErrUnsupportedRequestType
	}

	if _, err := tx.Exec(ctx, `
		UPDATE transactions
		SET status = 'REJECTED',
			"processedAt" = NOW(),
			"processedBy" = $2,
			description = COALESCE(NULLIF($3, ''), description)
		WHERE id = $1
	`, requestID, approverID, reason); err != nil {
		return err
	}

	reason = strings.TrimSpace(reason)
	rejectedTitle, rejectedMessage := notify.TransactionRejected(txType, reason)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		rejectedTitle,
		rejectedMessage,
		&memberID,
		nil,
	); err != nil {
		return fmt.Errorf("failed to notify member: %w", err)
	}

	_, _ = tx.Exec(ctx, `
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES ('REJECT_TRANSACTION', 'TRANSACTION', $1, $2, NOW(), $3)
	`, requestID, approverID, reason)

	return tx.Commit(ctx)
}

func (r *UserRepository) CreateMemberDepositRequest(ctx context.Context, memberID string, amount int64, bkashReference, notes string) (string, error) {
	reference := strings.TrimSpace(bkashReference)
	if reference == "" {
		return "", ErrBkashReferenceRequired
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Account is still locked; its key is the member's id (ADR-044).
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
		return "", fmt.Errorf("read member for deposit request: %w", err)
	}
	if strings.ToUpper(strings.TrimSpace(memberStatus)) != "ACTIVE" {
		return "", ErrMemberNotActive
	}

	var existingRequestID string
	dupErr := tx.QueryRow(ctx, `
		SELECT t.id::text
		FROM transactions t
		WHERE t."userId" = $1
		  AND t.type = 'DEPOSIT'
		  AND t.status = 'PENDING'
		  AND t.amount = $2
		  AND COALESCE(t."externalReference", '') = $3
		ORDER BY t."createdAt" DESC
		LIMIT 1
	`, memberID, amount, reference).Scan(&existingRequestID)
	if dupErr == nil {
		return "", fmt.Errorf("%w: deposit %s", ErrDuplicatePendingRequest, existingRequestID)
	}
	if !errors.Is(dupErr, pgx.ErrNoRows) {
		return "", dupErr
	}

	description := strings.TrimSpace(notes)
	if description == "" {
		description = "Member-submitted bKash deposit request"
	}

	// The request number is the row id, allocated in-transaction.
	requestID, err := r.nextDocumentNumber(ctx, tx, utils.SeriesDeposit)
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
			"userId"
		) VALUES (
			$1,
			'DEPOSIT',
			$2,
			$3,
			$4,
			'PENDING',
			NOW(),
			$5
		)
	`, requestID, amount, reference, description, memberID); err != nil {
		return "", err
	}

	staffTitle, staffMessage := notify.DepositRequestForStaff(memberName, amount, reference)
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
	memberTitle, memberMessage := notify.DepositRequestSubmitted(amount)
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

func (r *UserRepository) GetAllDeposits(ctx context.Context, filters map[string]interface{}) (map[string]interface{}, error) {
	query := `
		SELECT
			t.id,
			t.type::text,
			t.amount::bigint,
			t.status::text,
			COALESCE(t."externalReference", ''),
			COALESCE(t.description, ''),
			t."createdAt",
			COALESCE(t."processedAt", t."createdAt"),
			t."confirmedAt",
			COALESCE(t."savingsAfter", t."loanAfter", 0)::bigint,
			COALESCE(u.id, ''),
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."accountNo", ''),
			-- Printed on the receipt.
			COALESCE(u.phone, ''),
			COALESCE(processor."nameEn", '') as processor_name
		FROM transactions t
		JOIN users u ON  u.id = t."userId"
		LEFT JOIN users processor ON processor.id = t."processedBy"
		WHERE TRUE
	`

	// Add filters
	args := []interface{}{}
	argCount := 0

	// Default: savings movements only; "all" adds every posting type.
	if scope, _ := filters["types"].(string); scope != "all" {
		query += ` AND t.type IN ('DEPOSIT', 'WITHDRAWAL')`
	}

	if typeFilter, ok := filters["type"].(string); ok && typeFilter != "" {
		argCount++
		query += fmt.Sprintf(` AND t.type = $%d`, argCount)
		args = append(args, typeFilter)
	}

	if search, ok := filters["search"].(string); ok && search != "" {
		argCount++
		query += fmt.Sprintf(`
			AND (
				u."nameEn" ILIKE $%d
				OR COALESCE(u."nameBn", '') ILIKE $%d
				OR u."accountNo" ILIKE $%d
				OR COALESCE(processor."nameEn", '') ILIKE $%d
				OR t.id ILIKE $%d
				OR COALESCE(t."externalReference", '') ILIKE $%d
			)
		`, argCount, argCount, argCount, argCount, argCount, argCount)
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

	query += fmt.Sprintf(` ORDER BY t."createdAt" DESC LIMIT $%d OFFSET $%d`, argCount+1, argCount+2)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deposits := []map[string]interface{}{}
	for rows.Next() {
		var id, txType, txStatus, externalRef, description, memberUserID, memberName, memberNameBn, accountNo, memberPhone, processorName string
		var amount, balanceAfter int64
		var createdAt, processedAt time.Time
		var confirmedAt *time.Time
		if err := rows.Scan(&id, &txType, &amount, &txStatus, &externalRef, &description, &createdAt, &processedAt, &confirmedAt, &balanceAfter, &memberUserID, &memberName, &memberNameBn, &accountNo, &memberPhone, &processorName); err != nil {
			continue
		}
		item := map[string]interface{}{
			"id":     id,
			"type":   txType,
			"amount": amount,
			"status": txStatus,
			// `id` is the receipt number; externalReference is the member's bKash TrxID.
			"externalReference": externalRef,
			"notes":             description,
			"processedBy":       processorName,
			"processedDate":     processedAt.Format(time.RFC3339),
			"balanceAfter":      balanceAfter,
			"memberPhone":       memberPhone,
			"member": map[string]interface{}{
				"id":        memberUserID,
				"accountNo": accountNo,
				"phone":     memberPhone,
				"name": func() string {
					if memberNameBn != "" {
						return memberNameBn
					}
					return memberName
				}(),
			},
			"createdAt": createdAt.Format(time.RFC3339),

			// Backward-compat fields
			"description":  description,
			"date":         createdAt.Format(time.RFC3339),
			"memberName":   memberName,
			"memberNameBn": memberNameBn,
		}
		if confirmedAt != nil {
			item["confirmedDate"] = confirmedAt.Format(time.RFC3339)
		}
		deposits = append(deposits, item)
	}

	// Get stats
	stats, _ := r.GetDepositStats(ctx)

	return map[string]interface{}{
		"deposits": deposits,
		"total":    len(deposits),
		"stats":    stats,
		"pagination": map[string]interface{}{
			"page":  page,
			"limit": limit,
		},
	}, nil
}

func (r *UserRepository) GetDepositStats(ctx context.Context) (map[string]interface{}, error) {
	const query = `
		SELECT
			COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END)::bigint, 0) as total_deposits,
			COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount ELSE 0 END)::bigint, 0) as total_withdrawals,
			COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE -amount END)::bigint, 0) as net_balance
		FROM transactions
		WHERE type IN ('DEPOSIT', 'WITHDRAWAL')
		  AND status = 'CONFIRMED'
	`

	var totalDeposits, totalWithdrawals, netBalance int64
	if err := r.db.QueryRow(ctx, query).Scan(&totalDeposits, &totalWithdrawals, &netBalance); err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"totalDeposits":    totalDeposits,
		"totalWithdrawals": totalWithdrawals,
		"netBalance":       netBalance,
	}, nil
}

// ==================== LOAN MANAGEMENT ====================

func (r *UserRepository) GetDonations(ctx context.Context) ([]map[string]interface{}, error) {
	const query = `
		SELECT
			t.id,
			t.amount::bigint,
			t.id,
			COALESCE(t.description, ''),
			t."createdAt",
			COALESCE(u."nameEn", '') as donor_name,
			COALESCE(u."nameBn", '') as donor_name_bn,
			COALESCE(u."accountNo", '') as donor_id,
			-- Every status; screens total the fund on a predicate.
			t.status::text
		FROM transactions t
		LEFT JOIN users u ON u.id = t."userId"
		WHERE t.type = 'DONATION'
		ORDER BY t."createdAt" DESC
	`

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	donations := []map[string]interface{}{}
	for rows.Next() {
		var id, receipt, description, donorName, donorNameBn, donorId, status string
		var amount int64
		var createdAt time.Time
		if err := rows.Scan(&id, &amount, &receipt, &description, &createdAt, &donorName, &donorNameBn, &donorId, &status); err != nil {
			continue
		}

		displayDonor := strings.TrimSpace(donorNameBn)
		if displayDonor == "" {
			displayDonor = strings.TrimSpace(donorName)
		}
		displayDonorBn := strings.TrimSpace(donorNameBn)
		displayDescription := strings.TrimSpace(description)
		if strings.HasPrefix(displayDescription, "DONOR:") {
			raw := strings.TrimSpace(strings.TrimPrefix(displayDescription, "DONOR:"))
			parts := strings.SplitN(raw, "|", 2)
			overrideDonor := strings.TrimSpace(parts[0])
			if overrideDonor != "" {
				displayDonor = overrideDonor
				displayDonorBn = overrideDonor
			}
			if len(parts) == 2 {
				displayDescription = strings.TrimSpace(parts[1])
			} else {
				displayDescription = ""
			}
		}
		if displayDonor == "" {
			displayDonor = "Unknown"
		}
		if displayDonorBn == "" {
			displayDonorBn = displayDonor
		}

		donations = append(donations, map[string]interface{}{
			"id":          id,
			"amount":      amount,
			"receipt":     receipt,
			"description": displayDescription,
			"date":        createdAt.Format(time.RFC3339),
			"donorName":   displayDonor,
			"donorNameBn": displayDonorBn,
			"donorId":     donorId,
			"status":      status,
		})
	}

	return donations, nil
}

func (r *UserRepository) RecordDonation(ctx context.Context, recordedByID string, amount int64, donorName, notes string) (string, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var donationUserID string
	var donationBalance int64
	err = tx.QueryRow(ctx, `
		SELECT "userId"::text, COALESCE("savingsBalance", 0)::bigint
		FROM accounts
		WHERE "userId" = $1
		FOR UPDATE
	`, DonationFundUserID).Scan(&donationUserID, &donationBalance)
	if errors.Is(err, pgx.ErrNoRows) {
		// Created by `pnpm db:seed` (TEST-18).
		return "", ErrDonationPoolMissing
	}
	if err != nil {
		return "", fmt.Errorf("read donation account: %w", err)
	}

	// From document_sequences (ADR-013).
	receiptNumber, err := r.nextDocumentNumber(ctx, tx, utils.SeriesDonation)
	if err != nil {
		return "", err
	}

	description := strings.TrimSpace(notes)
	if dn := strings.TrimSpace(donorName); dn != "" {
		if description != "" {
			description = fmt.Sprintf("DONOR:%s | %s", dn, description)
		} else {
			description = fmt.Sprintf("DONOR:%s", dn)
		}
	}

	// Credited relatively (ADR-015); the pool row is contended by every donation.
	var newDonationBalance int64
	if err := tx.QueryRow(ctx, `
		UPDATE accounts
		SET "savingsBalance" = "savingsBalance" + $1, "updatedAt" = NOW()
		WHERE "userId" = $2
		RETURNING "savingsBalance"::bigint
	`, amount, donationUserID).Scan(&newDonationBalance); err != nil {
		return "", err
	}

	// The receipt number IS the row's key (ADR-044).
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (
			id, type, amount, description, status,
			"userId", "processedBy", "savingsAfter", "processedAt", "confirmedAt", "createdAt"
		) VALUES (
			$1, 'DONATION', $2, $3, 'CONFIRMED',
			$4, $5, $6, NOW(), NOW(), NOW()
		)
	`, receiptNumber, amount, description, donationUserID, recordedByID, newDonationBalance)
	if err != nil {
		return "", err
	}

	if err := r.insertAuditLogTx(ctx, tx, "DONATION_RECORDED", "ACCOUNT", donationUserID, recordedByID,
		fmt.Sprintf("Donation %d BDT recorded, receipt %s, pool %d -> %d", amount, receiptNumber, donationBalance, newDonationBalance),
	); err != nil {
		return "", fmt.Errorf("failed to write audit log: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	return receiptNumber, nil
}

// AddMemberDeposit adds a deposit for a member (worker action).
func (r *UserRepository) AddMemberDeposit(ctx context.Context, memberID, workerID string, amount int64, notes string) (string, error) {
	if amount <= 0 {
		return "", errors.New("amount must be positive")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Locked inside the transaction (ADR-015).
	var status string
	var currentBalance int64
	if err := tx.QueryRow(ctx, `
		SELECT u.status::text, COALESCE(a."savingsBalance", 0)::bigint
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&status, &currentBalance); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrMemberNotFound
		}
		return "", fmt.Errorf("read member for deposit: %w", err)
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return "", ErrMemberNotActive
	}

	// In-transaction, so an abandoned deposit burns no receipt number.
	receipt, err := r.nextDocumentNumber(ctx, tx, utils.SeriesDeposit)
	if err != nil {
		return "", err
	}

	// Credited relatively (ADR-015).
	var newBalance int64
	if err := tx.QueryRow(ctx, `
		UPDATE accounts
		SET "savingsBalance" = "savingsBalance" + $1, "updatedAt" = NOW()
		WHERE "userId" = $2
		RETURNING "savingsBalance"::bigint
	`, amount, memberID).Scan(&newBalance); err != nil {
		return "", err
	}

	// Create transaction record
	description := "জমা"
	if notes != "" {
		description = notes
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (id, type, amount, description, "savingsAfter", "createdAt", "userId", "processedBy", status)
		VALUES ($1, 'DEPOSIT', $2, $3, $4, NOW(), $5, $6, 'CONFIRMED')
	`, receipt, amount, description, newBalance, memberID, workerID)
	if err != nil {
		return "", err
	}

	memberTitle, memberMessage := notify.DepositConfirmed(amount)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"DEPOSIT_CONFIRMED",
		memberTitle,
		memberMessage,
		&memberID,
		nil,
	); err != nil {
		return "", fmt.Errorf("failed to create member notification: %w", err)
	}
	staffTitle, staffMessage := notify.DepositPostedForStaff(memberID)
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

	if err := r.insertAuditLogTx(ctx, tx, "DEPOSIT_POSTED", "ACCOUNT", memberID, workerID,
		fmt.Sprintf("Deposit %d BDT for member %s, receipt %s, balance %d -> %d", amount, memberID, receipt, currentBalance, newBalance),
	); err != nil {
		return "", fmt.Errorf("failed to write audit log: %w", err)
	}

	err = tx.Commit(ctx)
	if err != nil {
		return "", err
	}

	return receipt, nil
}

// claimOutstandingWithdrawalNotice locks the oldest unpaid PENDING withdrawal
// whose amount covers this payout, so paying it closes that row instead of
// double-counting. found=false is the ordinary case (ADR-030).
func (r *UserRepository) claimOutstandingWithdrawalNotice(
	ctx context.Context,
	tx pgx.Tx,
	memberID string,
	amount int64,
) (noticeID string, requestedAt time.Time, found bool, err error) {
	err = tx.QueryRow(ctx, `
		SELECT id::text, "createdAt"
		FROM transactions
		WHERE "userId" = $1
		  AND type = 'WITHDRAWAL'
		  AND status IN ('PENDING', 'PROCESSED')
		  AND amount >= $2
		ORDER BY "createdAt" ASC
		LIMIT 1
		FOR UPDATE
	`, memberID, amount).Scan(&noticeID, &requestedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, false, nil
	}
	if err != nil {
		return "", time.Time{}, false, err
	}
	return noticeID, requestedAt, true, nil
}

func (r *UserRepository) AddMemberWithdrawal(ctx context.Context, memberID, workerID string, amount int64, notes string) (string, error) {
	if amount <= 0 {
		return "", errors.New("amount must be positive")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Locked inside the transaction; every check below is made on this row (ADR-015).
	var status string
	var currentBalance, activeLoan int64
	var isGuarantor bool
	if err := tx.QueryRow(ctx, `
		SELECT
			u.status::text,
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status = 'ACTIVE'), 0)::bigint,
			EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = u.id AND l.status = 'ACTIVE')
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&status, &currentBalance, &activeLoan, &isGuarantor); err != nil {
		return "", ErrMemberNotFound
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return "", ErrMemberNotActive
	}
	if amount > currentBalance {
		return "", fmt.Errorf("%w: balance is %d BDT", ErrInsufficientBalance, currentBalance)
	}
	if activeLoan > 0 && !r.getSystemConfigBoolTx(ctx, tx, "loan.allowActiveLoanWithdrawal", false) {
		return "", ErrActiveLoanBlocksWithdrawal
	}
	if isGuarantor {
		return "", ErrGuarantorBlocksWithdrawal
	}

	// No member request required (ADR-030); an outstanding one is settled.
	noticeID, requestedAt, settlesRequest, err := r.claimOutstandingWithdrawalNotice(ctx, tx, memberID, amount)
	if err != nil {
		return "", err
	}

	// A settled request keeps its own number; allocate only when there is none.
	receipt := noticeID
	if !settlesRequest {
		receipt, err = r.nextDocumentNumber(ctx, tx, utils.SeriesWithdrawal)
		if err != nil {
			return "", err
		}
	}

	// Relative debit with the balance test in the WHERE (ADR-015).
	var newBalance int64
	err = tx.QueryRow(ctx, `
		UPDATE accounts
		SET "savingsBalance" = "savingsBalance" - $1, "updatedAt" = NOW()
		WHERE "userId" = $2 AND "savingsBalance" >= $1
		RETURNING "savingsBalance"::bigint
	`, amount, memberID).Scan(&newBalance)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInsufficientBalance
	}
	if err != nil {
		return "", err
	}

	// Create transaction record
	description := "উত্তোলন"
	if notes != "" {
		description = notes
	}
	// One posting per withdrawal. A settled request BECOMES the posting, with
	// `amount` rewritten to what was actually paid. Otherwise insert CONFIRMED
	// (money changed hands at the desk; rule 6a).
	auditNote := fmt.Sprintf("Withdrawal %d BDT for member %s, receipt %s, balance %d -> %d",
		amount, memberID, receipt, currentBalance, newBalance)
	if settlesRequest {
		if _, err := tx.Exec(ctx, `
			UPDATE transactions
			SET status = 'CONFIRMED',
				amount = $5,
				description = $2,
				"savingsAfter" = $3,
				"processedBy" = $4,
				"processedAt" = NOW(),
				"confirmedAt" = NOW()
			WHERE id = $1
		`, noticeID, description, newBalance, workerID, amount); err != nil {
			return "", err
		}
		auditNote += fmt.Sprintf(", settling request %s made %s", noticeID, formatNoticeDate(requestedAt))
	} else {
		if _, err := tx.Exec(ctx, `
			INSERT INTO transactions (
				id, type, amount, description, status,
				"userId", "processedBy",
				"savingsAfter", "processedAt", "confirmedAt", "createdAt"
			) VALUES (
				$1, 'WITHDRAWAL', $2, $3, 'CONFIRMED',
				$4, $5,
				$6, NOW(), NOW(), NOW()
			)
		`, receipt, amount, description, memberID, workerID, newBalance); err != nil {
			return "", err
		}
	}

	memberTitle, memberMessage := notify.WithdrawalProcessed(amount)
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
	staffTitle, staffMessage := notify.WithdrawalPostedForStaff(memberID)
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

	if err := r.insertAuditLogTx(ctx, tx, "WITHDRAWAL_POSTED", "ACCOUNT", memberID, workerID,
		auditNote,
	); err != nil {
		return "", fmt.Errorf("failed to write audit log: %w", err)
	}

	err = tx.Commit(ctx)
	if err != nil {
		return "", err
	}

	return receipt, nil
}

// CreateMemberLoan creates a loan for a member (worker action)
