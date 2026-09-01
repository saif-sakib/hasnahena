package repositories

// Everything a member sees about their own money: dashboard, notifications,
// their deposits, transactions, loans and profile. Read-only — a member never
// moves money, they request and confirm (CLAUDE.md rule 4).

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"hasnahena/apps/api/internal/money"
)

type DashboardStats struct {
	CurrentBalance  int64 `json:"currentBalance"`
	TotalDeposited  int64 `json:"totalDeposited"`
	LoanBalance     int64 `json:"loanBalance"`
	LoanEligibility int64 `json:"loanEligibility"`
}

// PendingConfirmation is a posting staff have made that the member has not yet
// agreed with. `ID` is the receipt number (ADR-044); there is no second field
// holding the same string under another name.
type PendingConfirmation struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Amount int64  `json:"amount"`
	Date   string `json:"date"`
}

type GuarantorRequest struct {
	ID           string `json:"id"`
	BorrowerName string `json:"borrowerName"`
	LoanAmount   int64  `json:"loanAmount"`
	RequestDate  string `json:"requestDate"`
}

type ActiveLoan struct {
	// The loan number, which is the loan's id.
	ID                string `json:"id"`
	RemainingAmount   int64  `json:"remainingAmount"`
	NextInstallment   int64  `json:"nextInstallment"`
	NextDueDate       string `json:"nextDueDate"`
	PaidInstallments  int    `json:"paidInstallments"`
	TotalInstallments int    `json:"totalInstallments"`
	// How many due instalments are unpaid, from money.MissedInstallments. The
	// member's own dashboard used to render the schedule's START date under
	// "next payment due", so anyone with an active loan was shown a date in the
	// past and no way to tell whether they were actually behind.
	MissedInstallments int  `json:"missedInstallments"`
	IsOverdue          bool `json:"isOverdue"`
}

type RecentTransaction struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Amount int64  `json:"amount"`
	Date   string `json:"date"`
}

type MemberDashboardData struct {
	Stats                DashboardStats        `json:"stats"`
	PendingConfirmations []PendingConfirmation `json:"pendingConfirmations"`
	GuarantorRequests    []GuarantorRequest    `json:"guarantorRequests"`
	ActiveLoan           *ActiveLoan           `json:"activeLoan"`
	RecentTransactions   []RecentTransaction   `json:"recentTransactions"`
}

type Notification struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type,omitempty"`
	Title       string                 `json:"title"`
	Message     string                 `json:"message,omitempty"`
	Description string                 `json:"description"`
	Time        string                 `json:"time"`
	Read        bool                   `json:"read"`
	Data        map[string]interface{} `json:"data,omitempty"`
}

func (r *UserRepository) GetMemberDashboardData(ctx context.Context, userID string) (*MemberDashboardData, error) {
	const statsQuery = `
		SELECT
			COALESCE(a."savingsBalance", 0)::bigint as current_balance,
			COALESCE((
				SELECT SUM(t.amount)::bigint
				FROM transactions t
				WHERE t."userId" = $1 AND t.type = 'DEPOSIT' AND t.status IN ('CONFIRMED', 'PROCESSED')
			), 0) as total_deposited,
			COALESCE((
				SELECT SUM(l."remainingAmount")::bigint
				FROM loans l
				WHERE l."borrowerId" = $1 AND l.status = 'ACTIVE'
			), 0) as loan_balance
		FROM accounts a
		WHERE a."userId" = $1
	`

	data := &MemberDashboardData{
		PendingConfirmations: make([]PendingConfirmation, 0),
		GuarantorRequests:    make([]GuarantorRequest, 0),
		RecentTransactions:   make([]RecentTransaction, 0),
	}

	var stats DashboardStats
	if err := r.db.QueryRow(ctx, statsQuery, userID).Scan(
		&stats.CurrentBalance,
		&stats.TotalDeposited,
		&stats.LoanBalance,
	); err != nil {
		// Returning zeros here was the shape of TEST-26's worst finding, on the
		// server side rather than the client: a member whose savings are ৳73,500
		// shown "Current Balance: BDT 0", with no error, nothing to retry, and
		// nothing to distinguish it from the truth.
		//
		// It was not hypothetical. WO-71 removed the legacy 'APPROVED' label from
		// LoanStatus and this query still named it, so every member dashboard
		// answered 200 with four zeros — a silently wrong balance rather than a
		// visible failure. `pgx.ErrNoRows` is the one case that legitimately
		// means zero: a member approved but with no account row yet.
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("member dashboard stats for %s: %w", userID, err)
		}
	}
	// Derived, never stored. `accounts.maxLoanAmount` used to answer this and was
	// written 0 at account creation and never updated again — so the headline
	// tile on every member's home screen read "Loan Eligibility: ৳0" for ever,
	// while the loans page two clicks away computed the real figure and showed
	// it. One fact, two homes, kept equal by nobody (ADR-023). The column is gone;
	// this is the same call `GetLoanEligibility` and the staff screens make.
	_, maxLoanMultiplier, _ := r.getLoanPolicy(ctx)
	stats.LoanEligibility = money.MaxLoanAmount(stats.CurrentBalance, maxLoanMultiplier)
	data.Stats = stats

	// A deposit waiting on the member's confirmation is `PROCESSED` — staff have
	// posted it and the member has not yet agreed it is right (rule 4). This
	// used to say `"receiptNumber" <> ''`, which stood in for "staff have
	// touched it" and was never quite that: a member's own PENDING request
	// carried a bKash reference in the same column, so a request the member had
	// just made appeared on their home screen as something to confirm.
	const pendingQuery = `
		SELECT
			t.id::text,
			t.type::text,
			t.amount::bigint,
			t."createdAt"
		FROM transactions t
		WHERE t."userId" = $1
		  AND t.type = 'DEPOSIT'
		  AND t.status = 'PROCESSED'
		ORDER BY t."createdAt" DESC
		LIMIT 5
	`
	pendingRows, err := r.db.Query(ctx, pendingQuery, userID)
	if err == nil {
		defer pendingRows.Close()
		for pendingRows.Next() {
			var item PendingConfirmation
			var createdAt time.Time
			if scanErr := pendingRows.Scan(&item.ID, &item.Type, &item.Amount, &createdAt); scanErr != nil {
				continue
			}
			item.Date = createdAt.Format(time.RFC3339)
			data.PendingConfirmations = append(data.PendingConfirmations, item)
		}
	}

	// Two defects fixed here 2026-08-17, both of which made this panel
	// permanently empty and neither of which could fail loudly:
	//
	//  1. The SELECT listed five columns and the Scan below took four, so every
	//     row errored and was swallowed by the `continue`.
	//  2. It filtered on the legacy `PENDING` status while a guarantor request is
	//     created as `PENDING_GUARANTOR`, so even a correct scan matched nothing.
	//
	// This is the legacy-status ambiguity in tasks.md costing something real:
	// two vocabularies for one concept, and the query picked the wrong one.
	const guarantorQuery = `
		SELECT
			l.id::text,
			COALESCE(u."nameEn", ''),
			l."principalAmount"::bigint,
			l."createdAt"
		FROM loans l
		JOIN users u ON u.id = l."borrowerId"
		WHERE l."guarantorId" = $1
		  AND l.status = 'PENDING_GUARANTOR'
		ORDER BY l."createdAt" DESC
		LIMIT 5
	`
	guarantorRows, err := r.db.Query(ctx, guarantorQuery, userID)
	if err == nil {
		defer guarantorRows.Close()
		for guarantorRows.Next() {
			var item GuarantorRequest
			var createdAt time.Time
			if scanErr := guarantorRows.Scan(&item.ID, &item.BorrowerName, &item.LoanAmount, &createdAt); scanErr != nil {
				continue
			}
			item.RequestDate = createdAt.Format(time.RFC3339)
			data.GuarantorRequests = append(data.GuarantorRequests, item)
		}
	}

	const activeLoanQuery = `
		SELECT
			l.id,
			l."remainingAmount"::bigint,
			l."installmentAmount"::bigint,
			COALESCE(l."installmentStartDate", l."disbursementDate"),
			l."paidInstallments",
			l."totalInstallments"
		FROM loans l
		WHERE l."borrowerId" = $1
		  AND l.status = 'ACTIVE'
		ORDER BY l."updatedAt" DESC
		LIMIT 1
	`
	var activeLoan ActiveLoan
	var installmentStart *time.Time
	if err := r.db.QueryRow(ctx, activeLoanQuery, userID).Scan(
		&activeLoan.ID,
		&activeLoan.RemainingAmount,
		&activeLoan.NextInstallment,
		&installmentStart,
		&activeLoan.PaidInstallments,
		&activeLoan.TotalInstallments,
	); err == nil {
		if installmentStart != nil {
			if due, ok := money.NextDueDate(*installmentStart, activeLoan.TotalInstallments, activeLoan.PaidInstallments); ok {
				activeLoan.NextDueDate = due.Format(time.RFC3339)
			}
			activeLoan.MissedInstallments = money.MissedInstallments(
				*installmentStart, time.Now(), activeLoan.TotalInstallments, activeLoan.PaidInstallments,
			)
			activeLoan.IsOverdue = activeLoan.MissedInstallments > 0
		}
		data.ActiveLoan = &activeLoan
	}

	const recentTxQuery = `
		SELECT
			t.id::text,
			t.type::text,
			t.amount::bigint,
			t."createdAt"
		FROM transactions t
		WHERE t."userId" = $1
		ORDER BY t."createdAt" DESC
		LIMIT 6
	`
	recentRows, err := r.db.Query(ctx, recentTxQuery, userID)
	if err == nil {
		defer recentRows.Close()
		for recentRows.Next() {
			var tx RecentTransaction
			var createdAt time.Time
			if scanErr := recentRows.Scan(&tx.ID, &tx.Type, &tx.Amount, &createdAt); scanErr != nil {
				continue
			}
			tx.Date = createdAt.Format(time.RFC3339)
			data.RecentTransactions = append(data.RecentTransactions, tx)
		}
	}

	return data, nil
}

func (r *UserRepository) GetNotifications(ctx context.Context, userID, role string) ([]Notification, error) {
	const query = `
		SELECT
			n.id::text,
			n.type::text,
			COALESCE(n.title, ''),
			COALESCE(n.message, ''),
			n."createdAt",
			n."isRead"
		FROM notifications n
		WHERE n."targetUserId" = $1 OR n."targetRole"::text = $2
		ORDER BY n."createdAt" DESC
		LIMIT 50
	`

	rows, err := r.db.Query(ctx, query, userID, strings.ToUpper(strings.TrimSpace(role)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notifications := make([]Notification, 0)
	for rows.Next() {
		var id, nType, title, message string
		var createdAt time.Time
		var isRead bool
		if scanErr := rows.Scan(&id, &nType, &title, &message, &createdAt, &isRead); scanErr != nil {
			continue
		}

		notifications = append(notifications, Notification{
			ID:          id,
			Type:        nType,
			Title:       title,
			Message:     message,
			Description: message,
			Time:        createdAt.Format(time.RFC3339),
			Read:        isRead,
		})
	}

	return notifications, nil
}

func (r *UserRepository) MarkNotificationRead(ctx context.Context, userID, role, notificationID string) error {
	const query = `
		UPDATE notifications
		SET "isRead" = TRUE, "readAt" = NOW()
		WHERE id = $1 AND ("targetUserId" = $2 OR "targetRole"::text = $3)
	`
	_, err := r.db.Exec(ctx, query, notificationID, userID, strings.ToUpper(strings.TrimSpace(role)))
	return err
}

func (r *UserRepository) MarkAllNotificationsRead(ctx context.Context, userID, role string) error {
	const query = `
		UPDATE notifications
		SET "isRead" = TRUE, "readAt" = NOW()
		WHERE "isRead" = FALSE AND ("targetUserId" = $1 OR "targetRole"::text = $2)
	`
	_, err := r.db.Exec(ctx, query, userID, strings.ToUpper(strings.TrimSpace(role)))
	return err
}

// nextDocumentNumber allocates the next receipt, withdrawal, loan or repayment
// number in its series. It must be called with the same transaction as the
// posting it identifies: the number is then only consumed if the money actually
// moves, and concurrent postings can never share a number.

func (r *UserRepository) GetMemberDeposits(ctx context.Context, userID string) (map[string]interface{}, error) {
	const query = `
		SELECT
			t.id::text,
			t.amount::bigint,
			t."createdAt",
			t.status::text,
			COALESCE(processor."nameEn", processor."nameBn", ''),
			COALESCE(t."savingsAfter", 0)::bigint
		FROM transactions t
		LEFT JOIN users processor ON processor.id = t."processedBy"
		WHERE t."userId" = $1
		  AND t.type = 'DEPOSIT'
		ORDER BY t."createdAt" DESC
	`

	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deposits := make([]map[string]interface{}, 0)
	var totalDeposited int64
	var pendingAmount int64

	for rows.Next() {
		var id, status, processedBy string
		var amount, balanceAfter int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &amount, &createdAt, &status, &processedBy, &balanceAfter); scanErr != nil {
			continue
		}

		upperStatus := strings.ToUpper(strings.TrimSpace(status))
		if upperStatus == "CONFIRMED" || upperStatus == "PROCESSED" {
			totalDeposited += amount
		}
		if upperStatus == "PENDING" {
			pendingAmount += amount
		}

		deposit := map[string]interface{}{
			"id":          id,
			"amount":      amount,
			"date":        createdAt.Format(time.RFC3339),
			"status":      upperStatus,
			"processedBy": processedBy,
		}
		if upperStatus == "CONFIRMED" || upperStatus == "PROCESSED" {
			deposit["balanceAfter"] = balanceAfter
		}
		deposits = append(deposits, deposit)
	}

	var currentBalance int64
	_ = r.db.QueryRow(ctx, `
		SELECT COALESCE(a."savingsBalance", 0)::bigint
		FROM accounts a
		WHERE a."userId" = $1
		ORDER BY a."createdAt" DESC
		LIMIT 1
	`, userID).Scan(&currentBalance)

	return map[string]interface{}{
		"deposits":       deposits,
		"totalDeposited": totalDeposited,
		"pendingAmount":  pendingAmount,
		"currentBalance": currentBalance,
	}, nil
}

func (r *UserRepository) GetMemberTransactions(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	const query = `
		SELECT
			t.id::text,
			t.type::text,
			t.amount::bigint,
			t."createdAt",
			COALESCE(t.description, ''),
			COALESCE(t."savingsAfter", t."loanAfter", 0)::bigint,
			COALESCE(processor."nameEn", processor."nameBn", ''),
			t.status::text
		FROM transactions t
		LEFT JOIN users processor ON processor.id = t."processedBy"
		WHERE t."userId" = $1
		ORDER BY t."createdAt" DESC
	`
	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	transactions := make([]map[string]interface{}, 0)
	for rows.Next() {
		var id, txType, description, processedBy, status string
		var amount, balanceAfter int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &txType, &amount, &createdAt, &description, &balanceAfter, &processedBy, &status); scanErr != nil {
			continue
		}

		transactions = append(transactions, map[string]interface{}{
			"id":           id,
			"type":         strings.ToUpper(strings.TrimSpace(txType)),
			"amount":       amount,
			"date":         createdAt.Format(time.RFC3339),
			"description":  description,
			"status":       strings.ToUpper(strings.TrimSpace(status)),
			"balanceAfter": balanceAfter,
			"processedBy":  processedBy,
		})
	}
	return transactions, nil
}

func (r *UserRepository) GetMemberLoans(ctx context.Context, userID string) (map[string]interface{}, error) {
	const eligibilityQuery = `
		SELECT
			COALESCE(a."savingsBalance", 0)::bigint
		FROM accounts a
		WHERE a."userId" = $1
		ORDER BY a."createdAt" DESC
		LIMIT 1
	`
	var currentDeposit int64
	_ = r.db.QueryRow(ctx, eligibilityQuery, userID).Scan(&currentDeposit)
	minDepositRequired, maxLoanMultiplier, _ := r.getLoanPolicy(ctx)
	currentDepositBDT := currentDeposit
	maxLoanAmountBDT := money.MaxLoanAmount(currentDepositBDT, maxLoanMultiplier)

	const loanQuery = `
		SELECT
			l.id::text,
			l.id,
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l."totalInstallments",
			l."paidInstallments",
			l."installmentAmount"::bigint,
			l."disbursementDate",
			l."expectedEndDate",
			COALESCE(l."installmentStartDate", l."disbursementDate"),
			COALESCE(l.purpose, ''),
			l.status::text,
			COALESCE(g."nameEn", '')
		FROM loans l
		LEFT JOIN users g ON g.id = l."guarantorId"
		WHERE l."borrowerId" = $1
		ORDER BY l."createdAt" DESC
	`
	rows, err := r.db.Query(ctx, loanQuery, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var activeLoan map[string]interface{}
	loanHistory := make([]map[string]interface{}, 0)
	for rows.Next() {
		var id, purpose, status, guarantor string
		var principalAmount, remainingAmount, installmentAmount int64
		var totalInstallments, paidInstallments int
		var disbursementDate, expectedEndDate, installmentStart *time.Time
		if scanErr := rows.Scan(
			&id, &principalAmount, &remainingAmount,
			&totalInstallments, &paidInstallments, &installmentAmount,
			&disbursementDate, &expectedEndDate, &installmentStart, &purpose, &status, &guarantor,
		); scanErr != nil {
			continue
		}

		item := map[string]interface{}{
			"id":                id,
			"principalAmount":   principalAmount,
			"remainingAmount":   remainingAmount,
			"totalInstallments": totalInstallments,
			"paidInstallments":  paidInstallments,
			"installmentAmount": installmentAmount,
			"purpose":           purpose,
			"status":            strings.ToUpper(status),
			"guarantor":         guarantor,
		}
		if disbursementDate != nil {
			item["disbursementDate"] = disbursementDate.Format(time.RFC3339)
		}
		if expectedEndDate != nil {
			// The day the LAST instalment is due. It used to be sent as
			// `nextDueDate`, which told a member on instalment 2 of 24 that
			// nothing was due for two years.
			item["expectedEndDate"] = expectedEndDate.Format(time.RFC3339)
		}
		attachLoanSchedule(item, status, installmentStart, totalInstallments, paidInstallments)

		if strings.ToUpper(status) == "ACTIVE" || strings.ToUpper(status) == "APPROVED" {
			if activeLoan == nil {
				activeLoan = item
			}
		} else {
			loanHistory = append(loanHistory, item)
		}
	}

	guarantorRequests := make([]map[string]interface{}, 0)
	guarantorReqQuery := `
		SELECT
			l.id::text,
			COALESCE(b."nameEn", ''),
			l."principalAmount"::bigint,
			l."createdAt"
		FROM loans l
		JOIN users b ON b.id = l."borrowerId"
		WHERE l."guarantorId" = $1
		  AND l.status = 'PENDING_GUARANTOR'
		ORDER BY l."createdAt" DESC
	`
	gRows, gErr := r.db.Query(ctx, guarantorReqQuery, userID)
	if gErr == nil {
		defer gRows.Close()
		for gRows.Next() {
			var id, borrowerName string
			var amount int64
			var requestDate time.Time
			if scanErr := gRows.Scan(&id, &borrowerName, &amount, &requestDate); scanErr != nil {
				continue
			}
			guarantorRequests = append(guarantorRequests, map[string]interface{}{
				"id":           id,
				"borrowerName": borrowerName,
				"loanAmount":   amount,
				"requestDate":  requestDate.Format(time.RFC3339),
			})
		}
	}

	// availableGuarantors was removed 2026-08-17 (SEC-13).
	//
	// It answered every signed-in member with the name AND savings balance of the
	// 50 wealthiest other members, ordered by balance descending — a ranked list
	// of who in the village has the most money, handed to anyone with a login.
	// product.md is explicit that a member cannot see another member's data, and
	// no UI ever consumed this, so it was pure disclosure with no feature behind
	// it.
	//
	// Nominating a guarantor now goes through GET /api/v1/members/lookup: the
	// applicant types a member ID they already know and gets back one name to
	// confirm, rate limited, with no balance in the response.

	return map[string]interface{}{
		"currentDeposit":     currentDepositBDT,
		"minDepositRequired": minDepositRequired,
		"maxLoanMultiplier":  maxLoanMultiplier,
		"maxLoanAmount":      maxLoanAmountBDT,
		"isEligible":         currentDepositBDT >= minDepositRequired,
		"activeLoan":         activeLoan,
		"loanHistory":        loanHistory,
		"guarantorRequests":  guarantorRequests,
	}, nil
}

func (r *UserRepository) GetMemberProfile(ctx context.Context, userID string) (map[string]interface{}, error) {
	const profileQuery = `
		SELECT
			COALESCE(u."accountNo", ''),
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."fatherName", ''),
			COALESCE(u."motherName", ''),
			u.phone,
			COALESCE(u.email, ''),
			COALESCE(u."nidNumber", ''),
			u."dateOfBirth",
			u."maritalStatus"::text,
			u.gender::text,
			u."createdAt",
			u.status::text,
			COALESCE(u."avatarUrl", '')
		FROM users u
		WHERE u.id = $1
		LIMIT 1
	`
	var memberID, nameEn, nameBn, fatherName, motherName, phone, email, nidNumber, maritalStatus, gender, status, avatarURL string
	var dob *time.Time
	var createdAt time.Time
	if err := r.db.QueryRow(ctx, profileQuery, userID).Scan(
		&memberID, &nameEn, &nameBn, &fatherName, &motherName, &phone, &email,
		&nidNumber, &dob, &maritalStatus, &gender, &createdAt, &status, &avatarURL,
	); err != nil {
		return nil, err
	}

	permAddress := map[string]interface{}{
		"houseNo":       "",
		"village":       "",
		"union":         "",
		"policeStation": "",
		"district":      "",
	}
	presentAddress := map[string]interface{}{
		"houseNo":       "",
		"village":       "",
		"union":         "",
		"policeStation": "",
		"district":      "",
	}

	const addrQuery = `
		SELECT
			COALESCE(pa."houseNo", ''), COALESCE(pa.village, ''), COALESCE(pa."union", ''), COALESCE(pa."policeStation", ''), COALESCE(pa.district, ''),
			COALESCE(pra."houseNo", ''), COALESCE(pra.village, ''), COALESCE(pra."union", ''), COALESCE(pra."policeStation", ''), COALESCE(pra.district, '')
		FROM users u
		LEFT JOIN addresses pa ON pa."userId" = u.id AND pa.type = 'PERMANENT'
		LEFT JOIN addresses pra ON pra."userId" = u.id AND pra.type = 'PRESENT' 
		WHERE u.id = $1
	`
	var pHouse, pVillage, pUnion, pPs, pDistrict, prHouse, prVillage, prUnion, prPs, prDistrict string
	if err := r.db.QueryRow(ctx, addrQuery, userID).Scan(
		&pHouse, &pVillage, &pUnion, &pPs, &pDistrict,
		&prHouse, &prVillage, &prUnion, &prPs, &prDistrict,
	); err == nil {
		permAddress = map[string]interface{}{
			"houseNo":       pHouse,
			"village":       pVillage,
			"union":         pUnion,
			"policeStation": pPs,
			"district":      pDistrict,
		}
		presentAddress = map[string]interface{}{
			"houseNo":       prHouse,
			"village":       prVillage,
			"union":         prUnion,
			"policeStation": prPs,
			"district":      prDistrict,
		}
	}

	const nomineeQuery = `
		SELECT
			COALESCE(n.name, ''),
			COALESCE(n.relationship, ''),
			COALESCE(n."nidNumber", ''),
			COALESCE(n.phone, '')
		FROM nominees n
		WHERE n."userId" = $1
		LIMIT 1
	`
	nominee := map[string]interface{}{
		"name":         "",
		"relationship": "",
		"nidNumber":    "",
		"phone":        "",
	}
	var nName, nRel, nNID, nPhone string
	if err := r.db.QueryRow(ctx, nomineeQuery, userID).Scan(&nName, &nRel, &nNID, &nPhone); err == nil {
		nominee = map[string]interface{}{
			"name":         nName,
			"relationship": nRel,
			"nidNumber":    nNID,
			"phone":        nPhone,
		}
	}

	const summaryQuery = `
		SELECT
			COALESCE(a."savingsBalance", 0)::bigint,
			EXISTS(SELECT 1 FROM loans l WHERE l."borrowerId" = $1 AND l.status = 'ACTIVE'),
			EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = $1 AND l.status = 'ACTIVE')
		FROM accounts a
		WHERE a."userId" = $1
		ORDER BY a."createdAt" DESC
		LIMIT 1
	`
	var currentBalance int64
	var hasActiveLoan, isGuarantor bool
	_ = r.db.QueryRow(ctx, summaryQuery, userID).Scan(&currentBalance, &hasActiveLoan, &isGuarantor)

	profile := map[string]interface{}{
		"accountNo":        memberID,
		"nameEn":           nameEn,
		"nameBn":           nameBn,
		"fatherName":       fatherName,
		"motherName":       motherName,
		"phone":            phone,
		"email":            email,
		"nidNumber":        nidNumber,
		"dateOfBirth":      "",
		"maritalStatus":    maritalStatus,
		"gender":           gender,
		"permanentAddress": permAddress,
		"presentAddress":   presentAddress,
		"memberSince":      createdAt.Format(time.RFC3339),
		"status":           status,
		"avatarUrl":        avatarURL,
	}
	if dob != nil {
		profile["dateOfBirth"] = dob.Format(time.RFC3339)
	}

	return map[string]interface{}{
		"profile": profile,
		"nominee": nominee,
		"accountSummary": map[string]interface{}{
			"currentBalance": currentBalance,
			"hasActiveLoan":  hasActiveLoan,
			"isGuarantor":    isGuarantor,
		},
	}, nil
}
