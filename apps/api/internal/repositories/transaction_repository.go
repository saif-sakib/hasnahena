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

	"hasnahena/apps/api/internal/notify"
	"hasnahena/apps/api/internal/utils"
)

// DonationFundUserID owns the donation pool account.
//
// The pool is found by its owner rather than by an account number, because
// there is no longer an account number: `accounts.accountNumber` was always a
// copy of the owner's accountNo and was removed (ADR-023). This id is set
// explicitly by `pnpm db:seed`, and `accounts.userId` is unique, so the lookup
// below names exactly one row — which matters, because it takes FOR UPDATE on a
// money path.
const DonationFundUserID = "system_donation_fund"

// ErrDonationPoolMissing means the donation pool account does not exist.
// It is a deployment fault rather than a request fault, so the handler answers
// 503 and names the fix instead of 500 and naming nothing.
var ErrDonationPoolMissing = errors.New(
	"the donation pool account (owned by " + DonationFundUserID + ") is missing — run `pnpm db:seed` against this database")

// FR-08. A member gives notice by requesting the withdrawal; the request row is
// the notice, and its createdAt starts the clock. Nothing may pay out against a
// notice that has not matured.
var (
	// ErrNoticePeriodNotElapsed means the notice exists but is not yet due.
	// The message carries the date, because "not yet" without a date is the
	// kind of answer that generates a support thread.
	ErrNoticePeriodNotElapsed = errors.New("withdrawal notice period has not elapsed")
	// ErrNoWithdrawalNotice means there is no matured notice to pay against.
	// Under rule 4 a worker never initiates money movement, so a payout with no
	// member request behind it is not a withdrawal — it is a transfer nobody
	// asked for.
	ErrNoWithdrawalNotice = errors.New("no matured withdrawal notice for this member")
)

// Why the reasons a withdrawal is refused are sentinels rather than strings.
//
// Every one of these is an ordinary, expected answer — the member has not given
// notice, the notice is not due yet, they guarantee somebody else's loan. The
// handler has to tell them apart to answer with the right status and the right
// sentence, and it used to do that with `strings.Contains(err.Error(), …)`.
//
// That failed twice at once. `"is guarantor for active loan"` also contains
// `"active loan"`, and the active-loan branch was tested first, so a guarantor
// was told they had a loan of their own. And the two FR-08 errors above matched
// no branch at all, so the single most common refusal — no notice on file — fell
// through to `500 Failed to process withdrawal`, which is how "admin member
// withdrawal is not working" was reported.
//
// The message text is deliberately unchanged from the strings it replaces, so
// any caller still matching on a substring keeps working while it is migrated.
var (
	ErrMemberNotFound             = errors.New("member not found")
	ErrMemberNotActive            = errors.New("member not active")
	ErrInsufficientBalance        = errors.New("insufficient balance")
	ErrActiveLoanBlocksWithdrawal = errors.New("member has an active loan")
	ErrGuarantorBlocksWithdrawal  = errors.New("member is guarantor for an active loan")
)

// noticeMaturityDate is when a notice given at createdAt becomes payable.
// Months rather than days: the policy is stated in months, and 3 months from
// 31 January has to mean the end of April rather than a date that does not
// exist. Go's AddDate normalises that (31 Jan + 3 months → 1 May), which is the
// conservative direction — it never matures a notice early.
func noticeMaturityDate(createdAt time.Time, noticePeriodMonths int) time.Time {
	if noticePeriodMonths <= 0 {
		return createdAt
	}
	return createdAt.AddDate(0, noticePeriodMonths, 0)
}

// formatNoticeDate is the one date format members see on a notice. It matches
// the generated documents (lib/documents/format.ts uses en-GB), so a member
// comparing a notification with a statement sees the same shape.
func formatNoticeDate(t time.Time) string {
	return t.Format("02 Jan 2006")
}

func (r *UserRepository) ApproveWithdrawal(ctx context.Context, requestID, approverID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var txType, txStatus, accountID, memberID, loanID string
	var amount int64
	var createdAt time.Time
	const getQuery = `
		SELECT
			type::text,
			status::text,
			amount::bigint,
			"accountId",
			"userId",
			COALESCE("loanId"::text, ''),
			"createdAt"
		FROM transactions
		WHERE id = $1
		FOR UPDATE
	`
	if err := tx.QueryRow(ctx, getQuery, requestID).Scan(&txType, &txStatus, &amount, &accountID, &memberID, &loanID, &createdAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("transaction request not found")
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(txStatus)) != "PENDING" {
		return fmt.Errorf("only pending transactions can be approved")
	}
	txType = strings.ToUpper(strings.TrimSpace(txType))

	switch txType {
	case "DEPOSIT":
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
		// FR-08. The request IS the notice, so approving it before the period
		// has run would make the policy advisory. Read the row's own createdAt
		// rather than trusting anything the caller passed.
		notice := r.getWithdrawalNoticePeriodMonthsTx(ctx, tx)
		eligibleFrom := noticeMaturityDate(createdAt, notice)
		if time.Now().Before(eligibleFrom) {
			return fmt.Errorf("%w: notice given %s, payable from %s",
				ErrNoticePeriodNotElapsed,
				formatNoticeDate(createdAt),
				formatNoticeDate(eligibleFrom))
		}
		if _, err := tx.Exec(ctx, `
			UPDATE transactions
			SET status = 'PROCESSED', "processedAt" = NOW(), "processedBy" = $2
			WHERE id = $1
		`, requestID, approverID); err != nil {
			return err
		}
		maturedTitle, maturedMessage := notify.WithdrawalNoticeMatured(amount)
		if err := r.insertNotificationTx(
			ctx,
			tx,
			"SYSTEM_ALERT",
			maturedTitle,
			maturedMessage,
			&memberID,
			nil,
		); err != nil {
			return fmt.Errorf("failed to notify member: %w", err)
		}
	case "LOAN_REPAYMENT":
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
		if normalizedLoanStatus != "ACTIVE" {
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
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'REJECT_TRANSACTION', 'TRANSACTION', $1, $2, NOW(), $3)
	`, requestID, approverID, reason)

	return tx.Commit(ctx)
}

// WithdrawalNotice is what a member gets back when they give notice.
type WithdrawalNotice struct {
	RequestID          string    `json:"requestId"`
	Amount             int64     `json:"amount"`
	NoticePeriodMonths int       `json:"noticePeriodMonths"`
	EligibleFrom       time.Time `json:"eligibleFrom"`
}

// CreateMemberWithdrawalNotice records a member's notice of withdrawal — FR-08.
//
// The notice IS the request: a PENDING WITHDRAWAL row whose createdAt starts
// the notice period. Nothing is debited here, and nothing may be debited until
// the period has run (ApproveWithdrawal and AddMemberWithdrawal both refuse).
//
// Every eligibility test a payout would make is made here as well, against the
// row locked FOR UPDATE. Checking twice is deliberate: refusing at notice time
// tells the member now rather than three months from now, and re-checking at
// payout time is what actually protects the balance, because three months is
// long enough for a guarantee, a loan or the balance itself to change.
func (r *UserRepository) CreateMemberWithdrawalNotice(ctx context.Context, memberID string, amount int64, notes string) (*WithdrawalNotice, error) {
	if amount <= 0 {
		return nil, errors.New("amount must be positive")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var memberStatus, accountID, memberName string
	var currentBalance, activeLoan, pendingNotices int64
	var isGuarantor bool
	if err := tx.QueryRow(ctx, `
		SELECT
			u.status::text,
			a.id::text,
			COALESCE(u."nameEn", ''),
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status = 'ACTIVE'), 0)::bigint,
			EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = u.id AND l.status = 'ACTIVE'),
			COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t."userId" = u.id AND t.type = 'WITHDRAWAL' AND t.status IN ('PENDING','PROCESSED')), 0)::bigint
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&memberStatus, &accountID, &memberName, &currentBalance, &activeLoan, &isGuarantor, &pendingNotices); err != nil {
		return nil, ErrMemberNotFound
	}
	if strings.ToUpper(strings.TrimSpace(memberStatus)) != "ACTIVE" {
		return nil, ErrMemberNotActive
	}
	// Outstanding notices count against the balance. Without this a member
	// could give three separate notices for their whole balance and, once all
	// three matured, present them one after another.
	if amount+pendingNotices > currentBalance {
		return nil, ErrInsufficientBalance
	}
	if activeLoan > 0 && !r.getSystemConfigBoolTx(ctx, tx, "loan.allowActiveLoanWithdrawal", false) {
		return nil, ErrActiveLoanBlocksWithdrawal
	}
	if isGuarantor {
		return nil, ErrGuarantorBlocksWithdrawal
	}

	description := strings.TrimSpace(notes)
	if description == "" {
		description = "Member-submitted withdrawal notice"
	}

	var requestID string
	var createdAt time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO transactions (
			id, type, amount, description, status, "createdAt", "accountId", "userId"
		) VALUES (
			gen_random_uuid()::text, 'WITHDRAWAL', $1, $2, 'PENDING', NOW(), $3, $4
		)
		RETURNING id::text, "createdAt"
	`, amount, description, accountID, memberID).Scan(&requestID, &createdAt); err != nil {
		return nil, err
	}

	noticePeriod := r.getWithdrawalNoticePeriodMonthsTx(ctx, tx)
	eligibleFrom := noticeMaturityDate(createdAt, noticePeriod)
	eligibleLabel := formatNoticeDate(eligibleFrom)

	memberTitle, memberMessage := notify.WithdrawalNoticeSubmitted(amount, noticePeriod, eligibleLabel)
	if err := r.insertNotificationTx(
		ctx, tx, "SYSTEM_ALERT", memberTitle, memberMessage, &memberID, nil,
	); err != nil {
		return nil, fmt.Errorf("failed to notify member: %w", err)
	}

	staffTitle, staffMessage := notify.WithdrawalNoticeForStaff(memberName, amount, eligibleLabel)
	if err := r.insertNotificationTx(
		ctx, tx, "SYSTEM_ALERT", staffTitle, staffMessage, nil, normalizedRolePtr("ADMIN"),
	); err != nil {
		return nil, fmt.Errorf("failed to notify admins: %w", err)
	}
	if err := r.insertNotificationTx(
		ctx, tx, "SYSTEM_ALERT", staffTitle, staffMessage, nil, normalizedRolePtr("WORKER"),
	); err != nil {
		return nil, fmt.Errorf("failed to notify staff: %w", err)
	}

	if err := r.insertAuditLogTx(ctx, tx, "WITHDRAWAL_NOTICE_GIVEN", "TRANSACTION", requestID, memberID,
		fmt.Sprintf("Notice to withdraw %d BDT, %d month notice period, payable from %s",
			amount, noticePeriod, eligibleLabel),
	); err != nil {
		return nil, fmt.Errorf("failed to write audit log: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &WithdrawalNotice{
		RequestID:          requestID,
		Amount:             amount,
		NoticePeriodMonths: noticePeriod,
		EligibleFrom:       eligibleFrom,
	}, nil
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
			COALESCE(t."receiptNumber", ''),
			COALESCE(t.description, ''),
			t."createdAt",
			COALESCE(t."processedAt", t."createdAt"),
			t."confirmedAt",
			COALESCE(t."savingsAfter", t."loanAfter", 0)::bigint,
			COALESCE(u.id, ''),
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."accountNo", ''),
			COALESCE(processor."nameEn", '') as processor_name
		FROM transactions t
		JOIN users u ON  u.id = t."userId"
		LEFT JOIN users processor ON processor.id = t."processedBy"
		WHERE TRUE
	`

	// Add filters
	args := []interface{}{}
	argCount := 0

	// The deposits screen wants savings movements; the transactions screen wants
	// every posting, disbursements and repayments included. Both read this one
	// query, so the caller says which — and the narrow set stays the default,
	// because that is what every existing caller means.
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
		var id, txType, txStatus, receipt, description, memberUserID, memberName, memberNameBn, accountNo, processorName string
		var amount, balanceAfter int64
		var createdAt, processedAt time.Time
		var confirmedAt *time.Time
		if err := rows.Scan(&id, &txType, &amount, &txStatus, &receipt, &description, &createdAt, &processedAt, &confirmedAt, &balanceAfter, &memberUserID, &memberName, &memberNameBn, &accountNo, &processorName); err != nil {
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
				"id":        memberUserID,
				"accountNo": accountNo,
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
			COALESCE(t."receiptNumber", ''),
			COALESCE(t.description, ''),
			t."createdAt",
			COALESCE(u."nameEn", '') as donor_name,
			COALESCE(u."nameBn", '') as donor_name_bn,
			COALESCE(u."accountNo", '') as donor_id,
			-- Every row, whatever its status: this is the ledger of donations and
			-- hiding one from the admin who has to explain it helps nobody. The
			-- status comes with it so the screens can total the *fund* on a
			-- predicate rather than on "everything the list happened to hold",
			-- which is how this sum and the admin dashboard's came apart.
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

	var donationAccID, donationUserID string
	var donationBalance int64
	err = tx.QueryRow(ctx, `
		SELECT id::text, "userId"::text, COALESCE("savingsBalance", 0)::bigint
		FROM accounts
		WHERE "userId" = $1
		FOR UPDATE
	`, DonationFundUserID).Scan(&donationAccID, &donationUserID, &donationBalance)
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
// claimMaturedWithdrawalNotice finds the notice a payout settles and locks it.
//
// "Covers the amount" rather than "equals" it: a member who gave notice for
// ৳10,000 and then asks for ৳6,000 at the desk is withdrawing less than they
// announced, which the notice period already covered. Asking for MORE than the
// notice is a different withdrawal and needs its own notice.
//
// Oldest first, so a member with several notices settles the one that has
// waited longest.
func (r *UserRepository) claimMaturedWithdrawalNotice(
	ctx context.Context,
	tx pgx.Tx,
	memberID string,
	amount int64,
	noticePeriodMonths int,
) (noticeID string, eligibleFrom time.Time, err error) {
	var createdAt time.Time
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
	`, memberID, amount).Scan(&noticeID, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, fmt.Errorf(
			"%w: the member must give notice before a withdrawal can be paid (FR-08)",
			ErrNoWithdrawalNotice)
	}
	if err != nil {
		return "", time.Time{}, err
	}

	eligibleFrom = noticeMaturityDate(createdAt, noticePeriodMonths)
	if time.Now().Before(eligibleFrom) {
		return "", time.Time{}, fmt.Errorf("%w: notice given %s, payable from %s",
			ErrNoticePeriodNotElapsed,
			formatNoticeDate(createdAt),
			formatNoticeDate(eligibleFrom))
	}
	return noticeID, eligibleFrom, nil
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
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status = 'ACTIVE'), 0)::bigint,
			EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = u.id AND l.status = 'ACTIVE')
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&status, &accountID, &currentBalance, &activeLoan, &isGuarantor); err != nil {
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

	// FR-08 — the payout gate.
	//
	// A worker posting at the desk must be settling a notice the member gave,
	// not originating a withdrawal (rule 4: workers never initiate money
	// movement). So this consumes the oldest notice that covers the amount and
	// has matured; with no such notice there is nothing to pay against.
	//
	// The gate lives HERE and not only in ApproveWithdrawal because this is the
	// method that moves money. A check on the approval path alone would be
	// bypassable by any caller that skips it, which is the shape of control the
	// settings page already warns about.
	noticePeriod := r.getWithdrawalNoticePeriodMonthsTx(ctx, tx)
	noticeID, eligibleFrom, err := r.claimMaturedWithdrawalNotice(ctx, tx, memberID, amount, noticePeriod)
	if err != nil {
		return "", err
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
	// The notice row becomes the posting. A second row would leave the ledger
	// carrying the same withdrawal twice — once as a request and once as a
	// payment — and every total over `transactions` would double it.
	//
	// **`amount` is rewritten to what was actually paid**, which is not always
	// what the notice announced: a notice covers any amount up to itself, so a
	// member who gave notice for ৳10,000 and took ৳6,000 settles it at ৳6,000.
	// Leaving the announced figure here would debit the account ৳6,000 and tell
	// the ledger ৳10,000 — the balance and the passbook disagreeing by ৳4,000,
	// which is the class of defect ADR-015 exists to prevent.
	if _, err := tx.Exec(ctx, `
		UPDATE transactions
		SET status = 'CONFIRMED',
			amount = $6,
			"receiptNumber" = $2,
			description = $3,
			"savingsAfter" = $4,
			"processedBy" = $5,
			"processedAt" = NOW(),
			"confirmedAt" = NOW()
		WHERE id = $1
	`, noticeID, receipt, description, newBalance, workerID, amount); err != nil {
		return "", err
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

	if err := r.insertAuditLogTx(ctx, tx, "WITHDRAWAL_POSTED", "ACCOUNT", accountID, workerID,
		fmt.Sprintf("Withdrawal %d BDT for member %s, receipt %s, balance %d -> %d, settling notice %s given %s",
			amount, memberID, receipt, currentBalance, newBalance, noticeID, formatNoticeDate(eligibleFrom)),
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
