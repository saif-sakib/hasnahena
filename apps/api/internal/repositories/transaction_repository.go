package repositories

// Deposits, withdrawals and donations — the postings that change a savings
// balance.
//
// Every balance change in here runs in ONE transaction and writes an audit_logs
// row inside it, so a rolled-back posting cannot leave an audit row describing
// money that never moved (CLAUDE.md rules 2 and 6).

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"hasnahena/apps/api/internal/utils"
)

// ErrDonationPoolMissing means the HN-ACC-DONATION account does not exist.
// It is a deployment fault rather than a request fault, so the handler answers
// 503 and names the fix instead of 500 and naming nothing.
var ErrDonationPoolMissing = errors.New(
	"donation pool account HN-ACC-DONATION is missing — run `pnpm db:seed` against this database")

func (r *UserRepository) ApproveWithdrawal(ctx context.Context, requestID, approverID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var txType, txStatus, accountID, memberID, loanID string
	var amount int64
	const getQuery = `
		SELECT
			type::text,
			status::text,
			amount::bigint,
			"accountId",
			"userId",
			COALESCE("loanId"::text, '')
		FROM transactions
		WHERE id = $1
		FOR UPDATE
	`
	if err := tx.QueryRow(ctx, getQuery, requestID).Scan(&txType, &txStatus, &amount, &accountID, &memberID, &loanID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("transaction request not found")
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(txStatus)) != "PENDING" {
		return fmt.Errorf("only pending transactions can be approved")
	}
	txType = strings.ToUpper(strings.TrimSpace(txType))

	if txType == "DEPOSIT" {
		// Credited relatively, so the row's own value is the input (ADR-015).
		// This used to SELECT the balance and write back a total computed in Go,
		// which loses one of two concurrent approvals against the same account.
		var newSavings, loanBalance int64
		if err := tx.QueryRow(ctx, `
			UPDATE accounts
			SET "savingsBalance" = "savingsBalance" + $1, "updatedAt" = NOW()
			WHERE id = $2
			RETURNING "savingsBalance"::bigint, "loanBalance"::bigint
		`, amount, accountID).Scan(&newSavings, &loanBalance); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE transactions
			SET status = 'CONFIRMED', "processedAt" = NOW(), "confirmedAt" = NOW(), "processedBy" = $2, "savingsAfter" = $3, "loanAfter" = $4
			WHERE id = $1
		`, requestID, approverID, newSavings, loanBalance); err != nil {
			return err
		}
		amountTaka := float64(amount)
		if err := r.insertNotificationTx(
			ctx,
			tx,
			"DEPOSIT_CONFIRMED",
			"Deposit request approved",
			fmt.Sprintf("Your deposit request for BDT %.2f has been approved.", amountTaka),
			&memberID,
			nil,
		); err != nil {
			return fmt.Errorf("failed to notify member: %w", err)
		}
	} else if txType == "WITHDRAWAL" {
		if _, err := tx.Exec(ctx, `
			UPDATE transactions
			SET status = 'PROCESSED', "processedAt" = NOW(), "processedBy" = $2
			WHERE id = $1
		`, requestID, approverID); err != nil {
			return err
		}
	} else if txType == "LOAN_REPAYMENT" {
		if strings.TrimSpace(loanID) == "" {
			return fmt.Errorf("loan repayment request missing loan reference")
		}

		var remainingAmount int64
		var loanStatus string
		if err := tx.QueryRow(ctx, `
			SELECT "remainingAmount"::bigint, status::text
			FROM loans
			WHERE id = $1 AND "borrowerId" = $2
			FOR UPDATE
		`, loanID, memberID).Scan(&remainingAmount, &loanStatus); err != nil {
			return err
		}
		normalizedLoanStatus := strings.ToUpper(strings.TrimSpace(loanStatus))
		if normalizedLoanStatus != "ACTIVE" && normalizedLoanStatus != "APPROVED" {
			return fmt.Errorf("loan is not active")
		}
		if amount > remainingAmount {
			return fmt.Errorf("repayment exceeds remaining balance")
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
			WHERE id = $2
			RETURNING "loanBalance"::bigint, "savingsBalance"::bigint
		`, amount, accountID).Scan(&newLoanBalance, &savingsBalance); err != nil {
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

		amountTaka := float64(amount)
		memberTitle := "Loan repayment approved"
		memberMessage := fmt.Sprintf("Your loan repayment request for BDT %.2f has been approved.", amountTaka)
		if loanUpdateStatus == "COMPLETED" {
			memberTitle = "Loan completed"
			memberMessage = fmt.Sprintf("Your final repayment request for BDT %.2f has been approved and the loan is now completed.", amountTaka)
		}
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
	} else {
		return fmt.Errorf("unsupported transaction type")
	}

	_, _ = tx.Exec(ctx, `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt")
		VALUES (gen_random_uuid()::text, 'APPROVE_TRANSACTION', 'TRANSACTION', $1, $2, NOW())
	`, requestID, approverID)

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
			return errors.New("transaction request not found")
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(txStatus)) != "PENDING" {
		return fmt.Errorf("only pending transactions can be rejected")
	}
	txType = strings.ToUpper(strings.TrimSpace(txType))
	if txType != "DEPOSIT" && txType != "WITHDRAWAL" && txType != "LOAN_REPAYMENT" {
		return fmt.Errorf("unsupported transaction type")
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

	requestLabel := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(txType), "_", " "))
	notifyMessage := "Your payment request was rejected."
	if requestLabel != "" {
		notifyMessage = fmt.Sprintf("Your %s request was rejected.", requestLabel)
	}
	reason = strings.TrimSpace(reason)
	if reason != "" {
		notifyMessage = fmt.Sprintf("%s Reason: %s", notifyMessage, reason)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"Request rejected",
		notifyMessage,
		&memberID,
		nil,
	); err != nil {
		return fmt.Errorf("failed to notify member: %w", err)
	}

	_, _ = tx.Exec(ctx, `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'REJECT_TRANSACTION', 'TRANSACTION', $1, $2, NOW(), $3)
	`, requestID, approverID, reason)

	return tx.Commit(ctx)
}

func (r *UserRepository) CreateMemberDepositRequest(ctx context.Context, memberID string, amount int64, bkashReference, notes string) (string, error) {
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

	var existingRequestID string
	dupErr := tx.QueryRow(ctx, `
		SELECT t.id::text
		FROM transactions t
		WHERE t."userId" = $1
		  AND t.type = 'DEPOSIT'
		  AND t.status = 'PENDING'
		  AND t.amount = $2
		  AND COALESCE(t."receiptNumber", '') = $3
		ORDER BY t."createdAt" DESC
		LIMIT 1
	`, memberID, amount, reference).Scan(&existingRequestID)
	if dupErr == nil {
		return "", errors.New("duplicate pending deposit request")
	}
	if !errors.Is(dupErr, pgx.ErrNoRows) {
		return "", dupErr
	}

	description := strings.TrimSpace(notes)
	if description == "" {
		description = "Member-submitted bKash deposit request"
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
			"userId"
		) VALUES (
			gen_random_uuid()::text,
			'DEPOSIT',
			$1,
			$2,
			$3,
			'PENDING',
			NOW(),
			$4,
			$5
		)
		RETURNING id::text
	`, amount, reference, description, accountID, memberID).Scan(&requestID); err != nil {
		return "", err
	}

	amountTaka := float64(amount)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"New deposit request",
		fmt.Sprintf("%s submitted a deposit request for BDT %.2f (bKash ref: %s).", memberName, amountTaka, reference),
		nil,
		normalizedRolePtr("ADMIN"),
	); err != nil {
		return "", fmt.Errorf("failed to notify admins: %w", err)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"New deposit request",
		fmt.Sprintf("%s submitted a deposit request for BDT %.2f (bKash ref: %s).", memberName, amountTaka, reference),
		nil,
		normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to notify staff: %w", err)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"Deposit request submitted",
		fmt.Sprintf("Your deposit request for BDT %.2f has been submitted and is awaiting review.", amountTaka),
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
			COALESCE(t."receiptNumber", ''),
			COALESCE(t.description, ''),
			t."createdAt",
			COALESCE(t."processedAt", t."createdAt"),
			t."confirmedAt",
			COALESCE(t."savingsAfter", t."loanAfter", 0)::bigint,
			COALESCE(u.id, ''),
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."memberId", ''),
			COALESCE(processor."nameEn", '') as processor_name
		FROM transactions t
		JOIN users u ON  u.id = t."userId"
		LEFT JOIN users processor ON processor.id = t."processedBy"
		WHERE t.type IN ('DEPOSIT', 'WITHDRAWAL')
	`

	// Add filters
	args := []interface{}{}
	argCount := 0

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
				OR u."memberId" ILIKE $%d
				OR COALESCE(processor."nameEn", '') ILIKE $%d
				OR COALESCE(t."receiptNumber", '') ILIKE $%d
				OR t.id::text ILIKE $%d
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
		var id, txType, txStatus, receipt, description, memberUserID, memberName, memberNameBn, memberId, processorName string
		var amount, balanceAfter int64
		var createdAt, processedAt time.Time
		var confirmedAt *time.Time
		if err := rows.Scan(&id, &txType, &amount, &txStatus, &receipt, &description, &createdAt, &processedAt, &confirmedAt, &balanceAfter, &memberUserID, &memberName, &memberNameBn, &memberId, &processorName); err != nil {
			continue
		}
		item := map[string]interface{}{
			"id":            id,
			"type":          txType,
			"amount":        amount,
			"status":        txStatus,
			"receiptNumber": receipt,
			"notes":         description,
			"processedBy":   processorName,
			"processedDate": processedAt.Format(time.RFC3339),
			"balanceAfter":  balanceAfter,
			"member": map[string]interface{}{
				"id":       memberUserID,
				"memberId": memberId,
				"name": func() string {
					if memberNameBn != "" {
						return memberNameBn
					}
					return memberName
				}(),
			},
			"createdAt": createdAt.Format(time.RFC3339),

			// Backward-compat fields
			"receipt":      receipt,
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
			COALESCE(t."receiptNumber", ''),
			COALESCE(t.description, ''),
			t."createdAt",
			COALESCE(u."nameEn", '') as donor_name,
			COALESCE(u."nameBn", '') as donor_name_bn,
			COALESCE(u."memberId", '') as donor_id
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
		var id, receipt, description, donorName, donorNameBn, donorId string
		var amount int64
		var createdAt time.Time
		if err := rows.Scan(&id, &amount, &receipt, &description, &createdAt, &donorName, &donorNameBn, &donorId); err != nil {
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

	var donationAccID, donationUserID string
	var donationBalance int64
	err = tx.QueryRow(ctx, `
		SELECT id::text, "userId"::text, COALESCE("savingsBalance", 0)::bigint
		FROM accounts
		WHERE "accountNumber" = 'HN-ACC-DONATION'
		FOR UPDATE
	`).Scan(&donationAccID, &donationUserID, &donationBalance)
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing in the schema, the migrations or the application created this
		// row until 2026-08-17 — only a test did — so on a fresh deployment
		// every donation failed here and the admin saw "Failed to record
		// donation" with nothing to act on. `pnpm db:seed` creates it now; this
		// error exists so that if it is ever missing again, the message says
		// which row and which command (TEST-18).
		return "", ErrDonationPoolMissing
	}
	if err != nil {
		return "", fmt.Errorf("read donation account: %w", err)
	}

	// Allocated from document_sequences like every other reference number
	// (ADR-013). This used to be DON- plus a wall-clock stamp to the second, so
	// two donations recorded in the same second collided on a number a member is
	// handed on paper.
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

	// Credited relatively (ADR-015), even though the FOR UPDATE above already
	// serialises donations: the pool is a single row every donation contends on.
	var newDonationBalance int64
	if err := tx.QueryRow(ctx, `
		UPDATE accounts
		SET "savingsBalance" = "savingsBalance" + $1, "updatedAt" = NOW()
		WHERE id = $2
		RETURNING "savingsBalance"::bigint
	`, amount, donationAccID).Scan(&newDonationBalance); err != nil {
		return "", err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (
			id, type, amount, "receiptNumber", description, status,
			"accountId", "userId", "processedBy", "savingsAfter", "processedAt", "confirmedAt", "createdAt"
		) VALUES (
			gen_random_uuid()::text, 'DONATION', $1, $2, $3, 'CONFIRMED',
			$4, $5, $6, $7, NOW(), NOW(), NOW()
		)
	`, amount, receiptNumber, description, donationAccID, donationUserID, recordedByID, newDonationBalance)
	if err != nil {
		return "", err
	}

	// A donation changes a balance, so it leaves an audit row like every other
	// posting (CLAUDE.md rule 2). This was the only money method in the Go API
	// without one.
	if err := r.insertAuditLogTx(ctx, tx, "DONATION_RECORDED", "ACCOUNT", donationAccID, recordedByID,
		fmt.Sprintf("Donation %d BDT recorded, receipt %s, pool %d -> %d", amount, receiptNumber, donationBalance, newDonationBalance),
	); err != nil {
		return "", fmt.Errorf("failed to write audit log: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	return receiptNumber, nil
}

// ProcessDeposit was removed 2026-08-17 (WO-41). It was a second, worse deposit
// path behind POST /v1/dashboard/worker/deposit: no audit row, a receipt number
// taken from the request body instead of document_sequences, no transaction
// status, and the same lost update as AddMemberDeposit. No client ever called
// it — the worker UI posts to /worker/members/{id}/deposit — so it was a
// duplicate money path kept alive only by its route. AddMemberDeposit below is
// the one to use.

// AddMemberDeposit adds a deposit for a member (worker action)
func (r *UserRepository) AddMemberDeposit(ctx context.Context, memberID, workerID string, amount int64, notes string) (string, error) {
	if amount <= 0 {
		return "", errors.New("amount must be positive")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Inside the transaction and locked. This read used to come from the pool
	// before the transaction existed, so two workers posting to the same member
	// both saw the old balance and the second overwrote the first — twenty
	// concurrent deposits left one deposit's worth of money (ADR-015).
	var status, accountID string
	var currentBalance int64
	if err := tx.QueryRow(ctx, `
		SELECT u.status::text, a.id::text, COALESCE(a."savingsBalance", 0)::bigint
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&status, &accountID, &currentBalance); err != nil {
		return "", errors.New("member not found")
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return "", errors.New("member not active")
	}

	// Allocated inside the transaction so an abandoned deposit does not burn a
	// receipt number.
	receipt, err := r.nextDocumentNumber(ctx, tx, utils.SeriesDeposit)
	if err != nil {
		return "", err
	}

	// Credited relatively: the stored value is the input, not a total computed
	// in Go from a value that may already be stale.
	var newBalance int64
	if err := tx.QueryRow(ctx, `
		UPDATE accounts
		SET "savingsBalance" = "savingsBalance" + $1, "updatedAt" = NOW()
		WHERE id = $2
		RETURNING "savingsBalance"::bigint
	`, amount, accountID).Scan(&newBalance); err != nil {
		return "", err
	}

	// Create transaction record
	description := "জমা"
	if notes != "" {
		description = notes
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (id, type, amount, "receiptNumber", description, "savingsAfter", "createdAt", "accountId", "userId", "processedBy", status)
		VALUES (gen_random_uuid()::text, 'DEPOSIT', $1, $2, $3, $4, NOW(), $5, $6, $7, 'CONFIRMED')
	`, amount, receipt, description, newBalance, accountID, memberID, workerID)
	if err != nil {
		return "", err
	}

	amountTaka := float64(amount)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"DEPOSIT_CONFIRMED",
		"Deposit confirmed",
		fmt.Sprintf("A deposit of BDT %.2f has been confirmed in your account.", amountTaka),
		&memberID,
		nil,
	); err != nil {
		return "", fmt.Errorf("failed to create member notification: %w", err)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"Daily task update",
		fmt.Sprintf("Deposit recorded for member %s.", strings.ToUpper(memberID)),
		nil,
		normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to create staff notification: %w", err)
	}

	if err := r.insertAuditLogTx(ctx, tx, "DEPOSIT_POSTED", "ACCOUNT", accountID, workerID,
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

// AddMemberWithdrawal processes a withdrawal for a member (worker action)

// AddMemberWithdrawal processes a withdrawal for a member (worker action)
func (r *UserRepository) AddMemberWithdrawal(ctx context.Context, memberID, workerID string, amount int64, notes string) (string, error) {
	if amount <= 0 {
		return "", errors.New("amount must be positive")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Locked inside the transaction. Every eligibility test below is made
	// against this row, so it has to be the row the debit lands on — reading it
	// from the pool first let ten concurrent withdrawals of ৳5,000 all pass a
	// ৳10,000 balance check and all succeed (ADR-015).
	var status, accountID string
	var currentBalance, activeLoan int64
	var isGuarantor bool
	if err := tx.QueryRow(ctx, `
		SELECT
			u.status::text,
			a.id::text,
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status IN ('APPROVED','ACTIVE')), 0)::bigint,
			EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = u.id AND l.status IN ('APPROVED','ACTIVE'))
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&status, &accountID, &currentBalance, &activeLoan, &isGuarantor); err != nil {
		return "", errors.New("member not found")
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return "", errors.New("member not active")
	}
	if amount > currentBalance {
		return "", errors.New("insufficient balance")
	}
	if activeLoan > 0 && !r.getSystemConfigBool(ctx, "loan.allowActiveLoanWithdrawal", false) {
		return "", errors.New("has active loan")
	}
	if isGuarantor {
		return "", errors.New("is guarantor for active loan")
	}

	receipt, err := r.nextDocumentNumber(ctx, tx, utils.SeriesWithdrawal)
	if err != nil {
		return "", err
	}

	// Debited relatively, and the balance test is repeated in the WHERE clause
	// so the check and the debit are one atomic step rather than two. No row
	// back means the balance moved underneath us — the same answer the caller
	// already understands.
	var newBalance int64
	err = tx.QueryRow(ctx, `
		UPDATE accounts
		SET "savingsBalance" = "savingsBalance" - $1, "updatedAt" = NOW()
		WHERE id = $2 AND "savingsBalance" >= $1
		RETURNING "savingsBalance"::bigint
	`, amount, accountID).Scan(&newBalance)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errors.New("insufficient balance")
	}
	if err != nil {
		return "", err
	}

	// Create transaction record
	description := "উত্তোলন"
	if notes != "" {
		description = notes
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (id, type, amount, "receiptNumber", description, "savingsAfter", "createdAt", "accountId", "userId", "processedBy", status)
		VALUES (gen_random_uuid()::text, 'WITHDRAWAL', $1, $2, $3, $4, NOW(), $5, $6, $7, 'CONFIRMED')
	`, amount, receipt, description, newBalance, accountID, memberID, workerID)
	if err != nil {
		return "", err
	}

	amountTaka := float64(amount)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"Withdrawal processed",
		fmt.Sprintf("A withdrawal of BDT %.2f has been processed from your account.", amountTaka),
		&memberID,
		nil,
	); err != nil {
		return "", fmt.Errorf("failed to create member notification: %w", err)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"Daily task update",
		fmt.Sprintf("Withdrawal processed for member %s.", strings.ToUpper(memberID)),
		nil,
		normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to create staff notification: %w", err)
	}

	if err := r.insertAuditLogTx(ctx, tx, "WITHDRAWAL_POSTED", "ACCOUNT", accountID, workerID,
		fmt.Sprintf("Withdrawal %d BDT for member %s, receipt %s, balance %d -> %d", amount, memberID, receipt, currentBalance, newBalance),
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
