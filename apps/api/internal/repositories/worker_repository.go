package repositories

// The field worker's view and the postings they process; the member confirms
// afterwards (rule 4).

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"hasnahena/apps/api/internal/money"
)

func (r *UserRepository) GetWorkerDashboard(ctx context.Context) (map[string]interface{}, error) {
	const statsQuery = `
		SELECT
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND status = 'ACTIVE'), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM users WHERE status = 'PENDING'), 0)::bigint,
			-- CONFIRMED only: PENDING rows are money not yet handed over.
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'DEPOSIT' AND status = 'CONFIRMED' AND "createdAt"::date = CURRENT_DATE), 0)::bigint,
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'WITHDRAWAL' AND status = 'CONFIRMED' AND "createdAt"::date = CURRENT_DATE), 0)::bigint,
			COALESCE((SELECT SUM("principalAmount") FROM loans WHERE status = 'ACTIVE' AND "createdAt"::date = CURRENT_DATE), 0)::bigint
	`
	var totalMembers, pendingRequests, todayDeposits, todayWithdrawals, todayLoans int64
	if err := r.db.QueryRow(ctx, statsQuery).Scan(&totalMembers, &pendingRequests, &todayDeposits, &todayWithdrawals, &todayLoans); err != nil {
		return nil, err
	}

	const pendingQuery = `
		SELECT
			t.id::text,
			CASE WHEN t.type = 'DEPOSIT' THEN 'DEPOSIT' ELSE 'WITHDRAWAL' END as req_type,
			COALESCE(u."nameEn", ''),
			t.amount::bigint,
			t."createdAt"
		FROM transactions t
		JOIN users u ON u.id = t."userId"
		WHERE t.type IN ('DEPOSIT', 'WITHDRAWAL')
		ORDER BY t."createdAt" DESC
		LIMIT 8
	`
	rows, err := r.db.Query(ctx, pendingQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	pending := make([]map[string]interface{}, 0)
	for rows.Next() {
		var id, reqType, member string
		var amount int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &reqType, &member, &amount, &createdAt); scanErr != nil {
			continue
		}
		pending = append(pending, map[string]interface{}{
			"id":     id,
			"type":   reqType,
			"member": member,
			"amount": amount,
			"time":   createdAt.Format(time.RFC3339),
		})
	}

	return map[string]interface{}{
		"stats": map[string]interface{}{
			"totalMembers":     totalMembers,
			"pendingRequests":  pendingRequests,
			"todayDeposits":    todayDeposits,
			"todayWithdrawals": todayWithdrawals,
			"todayLoans":       todayLoans,
		},
		"pendingRequests": pending,
	}, nil
}

func (r *UserRepository) GetWorkerProfile(ctx context.Context, userID string) (map[string]interface{}, error) {
	const query = `
		SELECT
			u.id,
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u.email, ''),
			u.phone,
			u.role::text,
			u.status::text,
			COALESCE(u."avatarUrl", ''),
			COALESCE(u."accountNo", ''),
			-- Branch is a joined row (WO-72).
			COALESCE(b.name, ''),
			-- The branch id IS its code since 2026-08-27.
			COALESCE(b.id, ''),
			u."createdAt",
			COALESCE((SELECT COUNT(*)::int FROM transactions WHERE "processedBy" = u.id), 0) as transactions_processed
		FROM users u
		LEFT JOIN branches b ON b.id = u."assignedBranchId"
		WHERE u.id = $1
	`

	var id, nameEn, nameBn, email, phone, role, status, avatarUrl, accountNo string
	var branchName, branchCode string
	var createdAt time.Time
	var transactionsProcessed int

	if err := r.db.QueryRow(ctx, query, userID).Scan(
		&id, &nameEn, &nameBn, &email, &phone, &role, &status, &avatarUrl, &accountNo,
		&branchName, &branchCode, &createdAt, &transactionsProcessed); err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"id":                    id,
		"nameEn":                nameEn,
		"nameBn":                nameBn,
		"email":                 email,
		"phone":                 phone,
		"role":                  role,
		"status":                status,
		"avatarUrl":             avatarUrl,
		"accountNo":             accountNo,
		"assignedBranch":        branchName,
		"assignedBranchCode":    branchCode,
		"joinedAt":              createdAt.Format(time.RFC3339),
		"transactionsProcessed": transactionsProcessed,
	}, nil
}

func (r *UserRepository) GetWorkerRequests(ctx context.Context, workerID string) ([]map[string]interface{}, error) {
	// For now, return empty - would need a requests table or pending transactions
	return []map[string]interface{}{}, nil
}

func (r *UserRepository) GetWorkerLoans(ctx context.Context, workerID string) ([]map[string]interface{}, error) {
	// Every loan — members have no branch, so there is no branch filter, and
	// /worker/loans and /admin/loans must return the same rows.
	const query = `
		SELECT
			l.id::text,
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l."paidInstallments"::int,
			l."totalInstallments"::int,
			l."installmentAmount"::bigint,
			l.status::text,
			u.id::text,
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."accountNo", ''),
			COALESCE(u.phone, ''),
			COALESCE(g."nameEn", g."nameBn", ''),
			COALESCE(l."installmentStartDate", l."disbursementDate"),
			l."createdAt"
		FROM loans l
		JOIN users u ON u.id = l."borrowerId"
		LEFT JOIN users g ON g.id = l."guarantorId"
		-- Every loan, including APPROVED and REJECTED (same rows as GetAllLoans).
		ORDER BY l."createdAt" DESC
		LIMIT 100
	`

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	loans := []map[string]interface{}{}
	for rows.Next() {
		var id, status, memberUserID, memberName, memberNameBn, memberID, memberPhone, guarantorName string
		var principalAmount, remainingAmount, installmentAmount int64
		var paidInstallments, totalInstallments int
		var installmentStart *time.Time
		var createdAt time.Time

		if err := rows.Scan(
			&id,
			&principalAmount,
			&remainingAmount,
			&paidInstallments,
			&totalInstallments,
			&installmentAmount,
			&status,
			&memberUserID,
			&memberName,
			&memberNameBn,
			&memberID,
			&memberPhone,
			&guarantorName,
			&installmentStart,
			&createdAt,
		); err != nil {
			continue
		}

		loan := map[string]interface{}{
			"id":                id,
			"principalAmount":   principalAmount,
			"remainingAmount":   remainingAmount,
			"paidInstallments":  paidInstallments,
			"totalInstallments": totalInstallments,
			"installmentAmount": installmentAmount,
			"status":            strings.ToUpper(status),
			"memberUserId":      memberUserID,
			"memberName":        memberName,
			"memberNameBn":      memberNameBn,
			"accountNo":         memberID,
			"memberPhone":       memberPhone,
			"guarantorName":     guarantorName,
			"createdAt":         createdAt.Format(time.RFC3339),
		}
		// Next due date from attachLoanSchedule, never installmentStart.
		attachLoanSchedule(loan, status, installmentStart, totalInstallments, paidInstallments)
		loans = append(loans, loan)
	}

	return loans, nil
}

// GetWorkerTransactions lists the postings this member of staff processed.
func (r *UserRepository) GetWorkerTransactions(ctx context.Context, workerID string) ([]map[string]interface{}, error) {
	const query = `
		SELECT
			t.id::text,
			t.type::text,
			t.amount::bigint,
			COALESCE(t.description, ''),
			t.status::text,
			COALESCE(t."savingsAfter", 0)::bigint,
			t."createdAt",
			u.id::text,
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."accountNo", ''),
			COALESCE(u.phone, ''),
			-- The processor's name comes from the posting; receipts name who took the money.
			COALESCE(processor."nameEn", '')
		FROM transactions t
		JOIN users u ON u.id = t."userId"
		LEFT JOIN users processor ON processor.id = t."processedBy"
		WHERE t."processedBy" = $1
		ORDER BY t."createdAt" DESC
		LIMIT 100
	`

	rows, err := r.db.Query(ctx, query, workerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	transactions := []map[string]interface{}{}
	for rows.Next() {
		var id, txType, description, status, memberUserID, memberName, memberNameBn, memberID, memberPhone, processorName string
		var amount, balanceAfter int64
		var createdAt time.Time

		if err := rows.Scan(
			&id,
			&txType,
			&amount,
			&description,
			&status,
			&balanceAfter,
			&createdAt,
			&memberUserID,
			&memberName,
			&memberNameBn,
			&memberID,
			&memberPhone,
			&processorName,
		); err != nil {
			continue
		}

		transactions = append(transactions, map[string]interface{}{
			"id":           id,
			"type":         strings.ToUpper(txType),
			"amount":       amount,
			"description":  description,
			"status":       strings.ToUpper(status),
			"balanceAfter": balanceAfter,
			"date":         createdAt.Format(time.RFC3339),
			"memberName":   memberName,
			"memberNameBn": memberNameBn,
			"memberUserId": memberUserID,
			"accountNo":    memberID,
			"memberPhone":  memberPhone,
			"processedBy":  processorName,
		})
	}

	return transactions, nil
}

// GetMemberDetailForWorker returns detailed information about a member for staff view
func (r *UserRepository) GetMemberDetailForWorker(ctx context.Context, memberID string) (map[string]interface{}, error) {
	// Get member basic info
	const memberQuery = `
		SELECT
			u.id::text,
			COALESCE(u."accountNo", '') AS account_no,
			COALESCE(u."nameEn", ''),
			COALESCE(u.email, ''),
			u.phone,
			COALESCE(u."nidNumber", ''),
			u.status::text,
			u."createdAt",
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status = 'ACTIVE'), 0)::bigint,
			COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t."userId" = u.id AND t.type = 'DEPOSIT' AND t.status = 'CONFIRMED'), 0)::bigint,
			COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t."userId" = u.id AND t.type = 'WITHDRAWAL' AND t.status = 'CONFIRMED'), 0)::bigint,
			COALESCE(addr.district, '') || ', ' || COALESCE(addr."policeStation", '') || ', ' || COALESCE(addr.village, ''),
			EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = u.id AND l.status = 'ACTIVE')
		FROM users u
		LEFT JOIN accounts a ON a."userId" = u.id
		LEFT JOIN addresses addr ON addr."userId" = u.id AND addr.type = 'PERMANENT' 
		WHERE u.id = $1 AND u.role::text = 'MEMBER'
	`
	var id, accountNo, name, email, phone, nid, status, address string
	var createdAt time.Time
	var savingsBalance, activeLoan, totalDeposited, totalWithdrawn int64
	var isGuarantor bool

	err := r.db.QueryRow(ctx, memberQuery, memberID).Scan(
		&id, &accountNo, &name, &email, &phone, &nid, &status, &createdAt,
		&savingsBalance, &activeLoan, &totalDeposited, &totalWithdrawn, &address, &isGuarantor,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrMemberNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load member detail: %w", err)
	}

	// Calculate loan eligibility
	minDepositRequired, maxLoanMultiplier, _ := r.getLoanPolicy(ctx)
	minDeposit := minDepositRequired
	eligibility := money.EvaluateEligibility(savingsBalance, minDeposit, maxLoanMultiplier, activeLoan > 0)
	maxLoanAmount := eligibility.MaxLoanAmount
	eligible := eligibility.Eligible
	eligibilityReason := eligibility.Reason

	member := map[string]interface{}{
		"id":                       id,
		"uid":                      accountNo,
		"accountNo":                accountNo,
		"name":                     name,
		"email":                    email,
		"phone":                    phone,
		"nidNumber":                nid,
		"status":                   strings.ToUpper(status),
		"joinDate":                 createdAt.Format(time.RFC3339),
		"currentDeposit":           savingsBalance,
		"activeLoan":               activeLoan,
		"totalDeposited":           totalDeposited,
		"totalWithdrawn":           totalWithdrawn,
		"address":                  strings.TrimSuffix(strings.TrimPrefix(address, ", "), ", "),
		"isGuarantorForActiveLoan": isGuarantor,
		"loanEligibility": map[string]interface{}{
			"eligible":      eligible,
			"maxLoanAmount": maxLoanAmount,
			"reason":        eligibilityReason,
		},
	}

	// Outstanding withdrawal requests (pre-ADR-030). They gate nothing; listed
	// so a worker settles one instead of paying twice.
	const pendingWithdrawalQuery = `
		SELECT
			t.id::text,
			t.amount::bigint,
			t."createdAt",
			t.status::text
		FROM transactions t
		WHERE t."userId" = $1
		  AND t.type = 'WITHDRAWAL'
		  AND t.status IN ('PENDING', 'PROCESSED')
		ORDER BY t."createdAt" ASC
	`
	pendingRows, err := r.db.Query(ctx, pendingWithdrawalQuery, memberID)
	if err != nil {
		return nil, err
	}
	defer pendingRows.Close()

	pendingWithdrawals := make([]map[string]interface{}, 0)
	for pendingRows.Next() {
		var requestID, requestStatus string
		var requestAmount int64
		var requestedAt time.Time
		if err := pendingRows.Scan(&requestID, &requestAmount, &requestedAt, &requestStatus); err != nil {
			continue
		}
		pendingWithdrawals = append(pendingWithdrawals, map[string]interface{}{
			"id":          requestID,
			"amount":      requestAmount,
			"status":      strings.ToUpper(requestStatus),
			"requestedAt": requestedAt.Format(time.RFC3339),
		})
	}
	if err := pendingRows.Err(); err != nil {
		return nil, err
	}
	member["pendingWithdrawals"] = pendingWithdrawals

	// Get recent transactions
	const txnQuery = `
		SELECT
			t.id::text,
			t.type::text,
			t.amount::bigint,
			COALESCE(t."savingsAfter", 0)::bigint,
			t.status::text,
			t."createdAt",
			COALESCE(t.description, '')
		FROM transactions t
		WHERE t."userId" = $1
		ORDER BY t."createdAt" DESC
		LIMIT 20
	`
	txnRows, err := r.db.Query(ctx, txnQuery, memberID)
	if err != nil {
		return nil, err
	}
	defer txnRows.Close()

	transactions := make([]map[string]interface{}, 0)
	for txnRows.Next() {
		var txnID, txnType, txnStatus, notes string
		var amount, balanceAfter int64
		var txnCreatedAt time.Time
		if err := txnRows.Scan(&txnID, &txnType, &amount, &balanceAfter, &txnStatus, &txnCreatedAt, &notes); err != nil {
			continue
		}
		transactions = append(transactions, map[string]interface{}{
			"id":           txnID,
			"type":         strings.ToUpper(txnType),
			"amount":       amount,
			"balanceAfter": balanceAfter,
			"status":       strings.ToUpper(txnStatus),
			"createdAt":    txnCreatedAt.Format(time.RFC3339),
			"notes":        notes,
		})
	}

	// Get loans
	const loanQuery = `
		SELECT
			l.id::text,
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l."totalInstallments"::int,
			l."paidInstallments"::int,
			l."installmentAmount"::bigint,
			l.status::text,
			l."disbursementDate",
			COALESCE(l."installmentStartDate", l."disbursementDate")
		FROM loans l
		WHERE l."borrowerId" = $1
		ORDER BY l."createdAt" DESC
		LIMIT 10
	`
	loanRows, err := r.db.Query(ctx, loanQuery, memberID)
	if err != nil {
		return nil, err
	}
	defer loanRows.Close()

	loans := make([]map[string]interface{}, 0)
	for loanRows.Next() {
		var loanID, loanStatus string
		var principal, remaining, installmentAmt int64
		var totalInst, paidInst int
		var disbursementDate, installmentStart *time.Time
		if err := loanRows.Scan(&loanID, &principal, &remaining, &totalInst, &paidInst, &installmentAmt, &loanStatus, &disbursementDate, &installmentStart); err != nil {
			continue
		}
		loan := map[string]interface{}{
			"id":                loanID,
			"principalAmount":   principal,
			"remainingAmount":   remaining,
			"totalInstallments": totalInst,
			"paidInstallments":  paidInst,
			"installmentAmount": installmentAmt,
			"status":            strings.ToUpper(loanStatus),
		}
		if disbursementDate != nil {
			loan["disbursementDate"] = disbursementDate.Format(time.RFC3339)
		}
		attachLoanSchedule(loan, loanStatus, installmentStart, totalInst, paidInst)
		loans = append(loans, loan)
	}

	const documentQuery = `
		SELECT
			-- (userId, type) is the key; the type is the identifier (ADR-044).
			d.type::text,
			COALESCE(d.type, ''),
			COALESCE(d.url, ''),
			COALESCE(d."fileName", ''),
			COALESCE(d."mimeType", ''),
			COALESCE(d.size, 0)::bigint,
			d."uploadedAt"
		FROM documents d
		WHERE d."userId" = $1
		ORDER BY d."uploadedAt" ASC
	`
	documentRows, err := r.db.Query(ctx, documentQuery, memberID)
	if err != nil {
		return nil, err
	}
	defer documentRows.Close()

	documents := make([]map[string]interface{}, 0)
	for documentRows.Next() {
		var docID, docType, docURL, fileName, mimeType string
		var size int64
		var uploadedAt time.Time
		if err := documentRows.Scan(&docID, &docType, &docURL, &fileName, &mimeType, &size, &uploadedAt); err != nil {
			continue
		}
		documents = append(documents, map[string]interface{}{
			"id":         docID,
			"type":       docType,
			"url":        docURL,
			"fileName":   fileName,
			"mimeType":   mimeType,
			"size":       size,
			"uploadedAt": uploadedAt.Format(time.RFC3339),
		})
	}

	member["documents"] = documents

	return map[string]interface{}{
		"member":       member,
		"transactions": transactions,
		"loans":        loans,
	}, nil
}

// AddMemberDeposit adds a deposit for a member (worker action)
