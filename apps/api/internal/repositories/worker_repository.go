package repositories

// The field worker's view and the postings they process. Workers never initiate
// money movement; they process what a member requested, and the member confirms
// it afterwards (CLAUDE.md rule 4).

import (
	"context"
	"fmt"
	"strings"
	"time"

	"hasnahena/apps/api/internal/money"
)

func (r *UserRepository) GetWorkerDashboard(ctx context.Context) (map[string]interface{}, error) {
	const statsQuery = `
		SELECT
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND status = 'ACTIVE'), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM users WHERE status = 'PENDING'), 0)::bigint,
			-- CONFIRMED only: a deposit request and a withdrawal notice are both
			-- PENDING rows in this table, and today's takings must not count
			-- money nobody has handed over yet.
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
			-- WO-72: the assigned branch is a row now, not a free string on the
			-- user. Joined rather than selected so a renamed office is renamed
			-- everywhere at once, which is the whole point of the change.
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
	// **Every loan, not the worker's branch's loans.** The comment here used to
	// say "loans from members in worker's branch" and the query has never had a
	// branch predicate — nor could it, because a *member* has no branch: only
	// staff carry `assignedBranchId`. A comment describing a filter that does
	// not exist is worse than none, because the next reader adding branch
	// scoping trusts it and looks in the wrong place.
	//
	// Returning everything is also correct today: the foundation runs one
	// office, and `/worker/loans` and `/admin/loans` are one React component
	// that must return the same rows (see loan_schedule_integration_test.go).
	// If members ever belong to a branch, this is one of the queries that has to
	// learn about it.
	const query = `
		SELECT
			l.id::text,
			COALESCE(l."loanNumber", ''),
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
		-- Every loan, like GetAllLoans. This used to omit APPROVED and REJECTED,
		-- and since both dashboards render one Loans component the same table
		-- reported a different number of loans depending on who opened it. A
		-- rejected application is also the thing a member is most likely to ask a
		-- field worker about, and the worker could not see it.
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
		var id, loanNumber, status, memberUserID, memberName, memberNameBn, memberID, memberPhone, guarantorName string
		var principalAmount, remainingAmount, installmentAmount int64
		var paidInstallments, totalInstallments int
		var installmentStart *time.Time
		var createdAt time.Time

		if err := rows.Scan(
			&id,
			&loanNumber,
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
			"loanNumber":        loanNumber,
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
		// Not `installmentStart` — that is the day the schedule opened, which is
		// behind every active loan and made this list report every borrower
		// overdue. See attachLoanSchedule.
		attachLoanSchedule(loan, status, installmentStart, totalInstallments, paidInstallments)
		loans = append(loans, loan)
	}

	return loans, nil
}

// GetWorkerTransactions lists the postings this member of staff processed.
//
// The `u.id::text` column is load-bearing: without it the SELECT returned twelve
// columns while the Scan below asked for thirteen, so *every* row failed and hit
// the `continue`. The endpoint answered `[]` with a 200 and no log line, which
// is why both worker screens that read it — the deposits ledger and the
// transaction history — were permanently empty and looked like a member with no
// activity rather than a broken query.
func (r *UserRepository) GetWorkerTransactions(ctx context.Context, workerID string) ([]map[string]interface{}, error) {
	const query = `
		SELECT
			t.id::text,
			t.type::text,
			t.amount::bigint,
			COALESCE(t."receiptNumber", ''),
			COALESCE(t.description, ''),
			t.status::text,
			COALESCE(t."savingsAfter", 0)::bigint,
			t."createdAt",
			u.id::text,
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."accountNo", ''),
			COALESCE(u.phone, '')
		FROM transactions t
		JOIN users u ON u.id = t."userId"
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
		var id, txType, receipt, description, status, memberUserID, memberName, memberNameBn, memberID, memberPhone string
		var amount, balanceAfter int64
		var createdAt time.Time

		if err := rows.Scan(
			&id,
			&txType,
			&amount,
			&receipt,
			&description,
			&status,
			&balanceAfter,
			&createdAt,
			&memberUserID,
			&memberName,
			&memberNameBn,
			&memberID,
			&memberPhone,
		); err != nil {
			continue
		}

		transactions = append(transactions, map[string]interface{}{
			"id":            id,
			"type":          strings.ToUpper(txType),
			"amount":        amount,
			"receipt":       receipt,
			"receiptNumber": receipt,
			"description":   description,
			"status":        strings.ToUpper(status),
			"balanceAfter":  balanceAfter,
			"date":          createdAt.Format(time.RFC3339),
			"memberName":    memberName,
			"memberNameBn":  memberNameBn,
			"memberUserId":  memberUserID,
			"accountNo":     memberID,
			"memberPhone":   memberPhone,
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
		LEFT JOIN addresses addr ON addr."userPermanentId" = u.id
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
	if err != nil {
		return nil, fmt.Errorf("member not found: %w", err)
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

	// Withdrawal requests this member has outstanding.
	//
	// These no longer gate anything (ADR-030): staff may pay a withdrawal with
	// no request behind it at all, and there is no maturity date to wait out —
	// which is why `eligibleFrom` and `matured` are gone from this payload
	// along with the notice period itself. What the screen still needs is the
	// list, so a worker paying at the desk can see that ৳5,000 was already
	// asked for and settle *that* rather than pay it twice.
	//
	// Rows here are pre-ADR-030 notices and anything a member filed before the
	// member-side request was removed. The list empties on its own as they are
	// paid; nothing creates a new one.
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
			COALESCE(t."receiptNumber", ''),
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
		var txnID, txnType, receipt, txnStatus, notes string
		var amount, balanceAfter int64
		var txnCreatedAt time.Time
		if err := txnRows.Scan(&txnID, &txnType, &amount, &balanceAfter, &receipt, &txnStatus, &txnCreatedAt, &notes); err != nil {
			continue
		}
		transactions = append(transactions, map[string]interface{}{
			"id":            txnID,
			"type":          strings.ToUpper(txnType),
			"amount":        amount,
			"balanceAfter":  balanceAfter,
			"receiptNumber": receipt,
			"status":        strings.ToUpper(txnStatus),
			"createdAt":     txnCreatedAt.Format(time.RFC3339),
			"notes":         notes,
		})
	}

	// Get loans
	const loanQuery = `
		SELECT
			l.id::text,
			COALESCE(l."loanNumber", ''),
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
		var loanID, loanNumber, loanStatus string
		var principal, remaining, installmentAmt int64
		var totalInst, paidInst int
		var disbursementDate, installmentStart *time.Time
		if err := loanRows.Scan(&loanID, &loanNumber, &principal, &remaining, &totalInst, &paidInst, &installmentAmt, &loanStatus, &disbursementDate, &installmentStart); err != nil {
			continue
		}
		loan := map[string]interface{}{
			"id":                loanID,
			"loanNumber":        loanNumber,
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
			d.id::text,
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
