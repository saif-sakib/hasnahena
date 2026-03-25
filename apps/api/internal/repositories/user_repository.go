package repositories

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"hasnahena/apps/api/internal/models"
)

type UserRepository struct {
	db *pgxpool.Pool
}

type DashboardStats struct {
	CurrentBalance  int64 `json:"currentBalance"`
	TotalDeposited  int64 `json:"totalDeposited"`
	LoanBalance     int64 `json:"loanBalance"`
	LoanEligibility int64 `json:"loanEligibility"`
}

type PendingConfirmation struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Amount  int64  `json:"amount"`
	Date    string `json:"date"`
	Receipt string `json:"receipt"`
}

type GuarantorRequest struct {
	ID           string `json:"id"`
	BorrowerName string `json:"borrowerName"`
	LoanAmount   int64  `json:"loanAmount"`
	RequestDate  string `json:"requestDate"`
}

type ActiveLoan struct {
	LoanNumber        string `json:"loanNumber"`
	RemainingAmount   int64  `json:"remainingAmount"`
	NextInstallment   int64  `json:"nextInstallment"`
	NextDueDate       string `json:"nextDueDate"`
	PaidInstallments  int    `json:"paidInstallments"`
	TotalInstallments int    `json:"totalInstallments"`
}

type RecentTransaction struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Amount  int64  `json:"amount"`
	Date    string `json:"date"`
	Receipt string `json:"receipt"`
}

type MemberDashboardData struct {
	Stats                DashboardStats        `json:"stats"`
	PendingConfirmations []PendingConfirmation `json:"pendingConfirmations"`
	GuarantorRequests    []GuarantorRequest    `json:"guarantorRequests"`
	ActiveLoan           *ActiveLoan           `json:"activeLoan"`
	RecentTransactions   []RecentTransaction   `json:"recentTransactions"`
}

type Notification struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Time        string `json:"time"`
	Read        bool   `json:"read"`
}

func NewUserRepository(db *pgxpool.Pool) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) FindByIdentifier(ctx context.Context, identifier string) (*models.User, error) {
	identifier = strings.TrimSpace(identifier)

	query := `
		SELECT
			id,
			COALESCE(email, ''),
			phone,
			"passwordHash",
			role::text,
			status::text,
			"nameEn"
		FROM users
		WHERE lower(COALESCE(email, '')) = lower($1) OR phone = $1
		LIMIT 1
	`

	var user models.User
	err := r.db.QueryRow(ctx, query, identifier).Scan(
		&user.ID,
		&user.Email,
		&user.Phone,
		&user.PasswordHash,
		&user.Role,
		&user.Status,
		&user.NameEn,
	)
	if err != nil {
		return nil, err
	}

	return &user, nil
}

func (r *UserRepository) GetMemberDashboardData(ctx context.Context, userID string) (*MemberDashboardData, error) {
	const statsQuery = `
		SELECT
			COALESCE(a."savingsBalance", 0)::bigint as current_balance,
			COALESCE((
				SELECT SUM(t.amount)::bigint
				FROM transactions t
				WHERE t."userId" = $1 AND t.type = 'DEPOSIT'
			), 0) as total_deposited,
			COALESCE((
				SELECT SUM(l."remainingAmount")::bigint
				FROM loans l
				WHERE l."borrowerId" = $1 AND l.status IN ('APPROVED', 'ACTIVE')
			), 0) as loan_balance,
			COALESCE(a."maxLoanAmount", 0)::bigint as loan_eligibility
		FROM accounts a
		WHERE a."userId" = $1
		ORDER BY a."createdAt" DESC
		LIMIT 1
	`

	data := &MemberDashboardData{
		PendingConfirmations: make([]PendingConfirmation, 0),
		GuarantorRequests:    make([]GuarantorRequest, 0),
		RecentTransactions:   make([]RecentTransaction, 0),
	}

	var stats DashboardStats
	err := r.db.QueryRow(ctx, statsQuery, userID).Scan(
		&stats.CurrentBalance,
		&stats.TotalDeposited,
		&stats.LoanBalance,
		&stats.LoanEligibility,
	)
	if err != nil {
		stats = DashboardStats{}
	}
	data.Stats = stats

	const pendingQuery = `
		SELECT
			t.id::text,
			t.type::text,
			t.amount::bigint,
			t."createdAt",
			COALESCE(t."receiptNumber", '')
		FROM transactions t
		WHERE t."userId" = $1
		  AND t.type = 'DEPOSIT'
		  AND t."receiptNumber" <> ''
		ORDER BY t."createdAt" DESC
		LIMIT 5
	`
	pendingRows, err := r.db.Query(ctx, pendingQuery, userID)
	if err == nil {
		defer pendingRows.Close()
		for pendingRows.Next() {
			var item PendingConfirmation
			var createdAt time.Time
			if scanErr := pendingRows.Scan(&item.ID, &item.Type, &item.Amount, &createdAt, &item.Receipt); scanErr != nil {
				continue
			}
			item.Date = createdAt.Format(time.RFC3339)
			data.PendingConfirmations = append(data.PendingConfirmations, item)
		}
	}

	const guarantorQuery = `
		SELECT
			l.id::text,
			COALESCE(u."nameEn", ''),
			l."principalAmount"::bigint,
			l."createdAt"
		FROM loans l
		JOIN users u ON u.id = l."borrowerId"
		WHERE l."guarantorId" = $1
		  AND l.status = 'PENDING'
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
			l."loanNumber",
			l."remainingAmount"::bigint,
			l."installmentAmount"::bigint,
			COALESCE(l."installmentStartDate", l."disbursementDate"),
			l."paidInstallments",
			l."totalInstallments"
		FROM loans l
		WHERE l."borrowerId" = $1
		  AND l.status IN ('APPROVED', 'ACTIVE')
		ORDER BY l."updatedAt" DESC
		LIMIT 1
	`
	var activeLoan ActiveLoan
	var nextDueDate *time.Time
	if err := r.db.QueryRow(ctx, activeLoanQuery, userID).Scan(
		&activeLoan.LoanNumber,
		&activeLoan.RemainingAmount,
		&activeLoan.NextInstallment,
		&nextDueDate,
		&activeLoan.PaidInstallments,
		&activeLoan.TotalInstallments,
	); err == nil {
		if nextDueDate != nil {
			activeLoan.NextDueDate = nextDueDate.Format(time.RFC3339)
		}
		data.ActiveLoan = &activeLoan
	}

	const recentTxQuery = `
		SELECT
			t.id::text,
			t.type::text,
			t.amount::bigint,
			t."createdAt",
			COALESCE(t."receiptNumber", '')
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
			if scanErr := recentRows.Scan(&tx.ID, &tx.Type, &tx.Amount, &createdAt, &tx.Receipt); scanErr != nil {
				continue
			}
			tx.Date = createdAt.Format(time.RFC3339)
			data.RecentTransactions = append(data.RecentTransactions, tx)
		}
	}

	return data, nil
}

func (r *UserRepository) GetNotifications(ctx context.Context, userID string) ([]Notification, error) {
	const query = `
		SELECT
			t.id::text,
			t.type::text,
			t.amount::bigint,
			t."createdAt",
			COALESCE(t.description, '')
		FROM transactions t
		WHERE t."userId" = $1
		ORDER BY t."createdAt" DESC
		LIMIT 10
	`

	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notifications := make([]Notification, 0)
	for rows.Next() {
		var id, txType, description string
		var amount int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &txType, &amount, &createdAt, &description); scanErr != nil {
			continue
		}

		title := "Transaction update"
		switch strings.ToUpper(txType) {
		case "DEPOSIT":
			title = "Deposit confirmed"
		case "WITHDRAWAL":
			title = "Withdrawal update"
		case "LOAN_DISBURSEMENT":
			title = "Loan disbursed"
		case "LOAN_REPAYMENT":
			title = "Loan repayment received"
		}

		if description == "" {
			description = txType
		}

		notifications = append(notifications, Notification{
			ID:          id,
			Title:       title,
			Description: description,
			Time:        createdAt.Format(time.RFC3339),
			Read:        false,
		})
	}

	return notifications, nil
}

func (r *UserRepository) GetMemberDeposits(ctx context.Context, userID string) (map[string]interface{}, error) {
	const query = `
		SELECT
			t.id::text,
			t.amount::bigint,
			t."createdAt",
			COALESCE(t."receiptNumber", ''),
			COALESCE(t."processedBy", ''),
			COALESCE(t."savingsAfter", 0)::bigint
		FROM transactions t
		WHERE t."userId" = $1 AND t.type = 'DEPOSIT'
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
	var currentBalance int64

	for rows.Next() {
		var id, receiptNumber, processedBy string
		var amount, balanceAfter int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &amount, &createdAt, &receiptNumber, &processedBy, &balanceAfter); scanErr != nil {
			continue
		}

		totalDeposited += amount
		currentBalance = balanceAfter

		deposit := map[string]interface{}{
			"id":            id,
			"amount":        amount / 100,
			"date":          createdAt.Format(time.RFC3339),
			"receiptNumber": receiptNumber,
			"status":        "CONFIRMED",
			"processedBy":   processedBy,
			"balanceAfter":  balanceAfter / 100,
		}
		deposits = append(deposits, deposit)
	}

	if len(deposits) == 0 {
		currentBalance = 0
	}

	return map[string]interface{}{
		"deposits":       deposits,
		"totalDeposited": totalDeposited / 100,
		"pendingAmount":  pendingAmount / 100,
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
			COALESCE(t."receiptNumber", ''),
			COALESCE(t.description, ''),
			COALESCE(t."savingsAfter", 0)::bigint,
			COALESCE(t."processedBy", '')
		FROM transactions t
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
		var id, txType, receipt, description, processedBy string
		var amount, balanceAfter int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &txType, &amount, &createdAt, &receipt, &description, &balanceAfter, &processedBy); scanErr != nil {
			continue
		}

		transactions = append(transactions, map[string]interface{}{
			"id":            id,
			"type":          txType,
			"amount":        amount / 100,
			"date":          createdAt.Format(time.RFC3339),
			"receiptNumber": receipt,
			"description":   description,
			"status":        "CONFIRMED",
			"balanceAfter":  balanceAfter / 100,
			"processedBy":   processedBy,
		})
	}
	return transactions, nil
}

func (r *UserRepository) GetMemberLoans(ctx context.Context, userID string) (map[string]interface{}, error) {
	const eligibilityQuery = `
		SELECT
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE(a."maxLoanAmount", 0)::bigint
		FROM accounts a
		WHERE a."userId" = $1
		ORDER BY a."createdAt" DESC
		LIMIT 1
	`
	var currentDeposit, maxLoanAmount int64
	_ = r.db.QueryRow(ctx, eligibilityQuery, userID).Scan(&currentDeposit, &maxLoanAmount)

	const loanQuery = `
		SELECT
			l.id::text,
			l."loanNumber",
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l."totalInstallments",
			l."paidInstallments",
			l."installmentAmount"::bigint,
			l."disbursementDate",
			l."expectedEndDate",
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
		var id, loanNumber, purpose, status, guarantor string
		var principalAmount, remainingAmount, installmentAmount int64
		var totalInstallments, paidInstallments int
		var disbursementDate, expectedEndDate *time.Time
		if scanErr := rows.Scan(
			&id, &loanNumber, &principalAmount, &remainingAmount,
			&totalInstallments, &paidInstallments, &installmentAmount,
			&disbursementDate, &expectedEndDate, &purpose, &status, &guarantor,
		); scanErr != nil {
			continue
		}

		item := map[string]interface{}{
			"id":                id,
			"loanNumber":        loanNumber,
			"principalAmount":   principalAmount / 100,
			"remainingAmount":   remainingAmount / 100,
			"totalInstallments": totalInstallments,
			"paidInstallments":  paidInstallments,
			"installmentAmount": installmentAmount / 100,
			"purpose":           purpose,
			"status":            strings.ToUpper(status),
			"guarantor":         guarantor,
		}
		if disbursementDate != nil {
			item["disbursementDate"] = disbursementDate.Format(time.RFC3339)
		}
		if expectedEndDate != nil {
			item["nextDueDate"] = expectedEndDate.Format(time.RFC3339)
		}

		if strings.ToUpper(status) == "ACTIVE" || strings.ToUpper(status) == "APPROVED" {
			if activeLoan == nil {
				activeLoan = item
			}
		} else {
			loanHistory = append(loanHistory, item)
		}
	}

	return map[string]interface{}{
		"currentDeposit":      currentDeposit / 100,
		"minDepositRequired":  int64(8000),
		"maxLoanMultiplier":   int64(5),
		"maxLoanAmount":       maxLoanAmount / 100,
		"isEligible":          (currentDeposit / 100) >= 8000,
		"activeLoan":          activeLoan,
		"loanHistory":         loanHistory,
		"guarantorRequests":   make([]map[string]interface{}, 0),
		"availableGuarantors": make([]map[string]interface{}, 0),
	}, nil
}

func (r *UserRepository) GetMemberProfile(ctx context.Context, userID string) (map[string]interface{}, error) {
	const profileQuery = `
		SELECT
			COALESCE(u."memberId", ''),
			COALESCE(a."accountNumber", ''),
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
		LEFT JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1
		LIMIT 1
	`
	var memberID, accountNumber, nameEn, nameBn, fatherName, motherName, phone, email, nidNumber, maritalStatus, gender, status, avatarURL string
	var dob *time.Time
	var createdAt time.Time
	if err := r.db.QueryRow(ctx, profileQuery, userID).Scan(
		&memberID, &accountNumber, &nameEn, &nameBn, &fatherName, &motherName, &phone, &email,
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
		LEFT JOIN addresses pa ON pa."userPermanentId" = u.id
		LEFT JOIN addresses pra ON pra.id = u."presentAddressId"
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
			EXISTS(SELECT 1 FROM loans l WHERE l."borrowerId" = $1 AND l.status IN ('APPROVED','ACTIVE')),
			EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = $1 AND l.status IN ('APPROVED','ACTIVE'))
		FROM accounts a
		WHERE a."userId" = $1
		ORDER BY a."createdAt" DESC
		LIMIT 1
	`
	var currentBalance int64
	var hasActiveLoan, isGuarantor bool
	_ = r.db.QueryRow(ctx, summaryQuery, userID).Scan(&currentBalance, &hasActiveLoan, &isGuarantor)

	profile := map[string]interface{}{
		"memberId":         memberID,
		"accountNumber":    accountNumber,
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
			"currentBalance": currentBalance / 100,
			"hasActiveLoan":  hasActiveLoan,
			"isGuarantor":    isGuarantor,
		},
	}, nil
}

func (r *UserRepository) GetWorkerDashboard(ctx context.Context) (map[string]interface{}, error) {
	const statsQuery = `
		SELECT
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND status = 'ACTIVE'), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM users WHERE status = 'PENDING'), 0)::bigint,
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'DEPOSIT' AND "createdAt"::date = CURRENT_DATE), 0)::bigint,
			COALESCE((SELECT SUM("principalAmount") FROM loans WHERE status IN ('APPROVED','ACTIVE') AND "createdAt"::date = CURRENT_DATE), 0)::bigint
	`
	var totalMembers, pendingRequests, todayDeposits, todayLoans int64
	if err := r.db.QueryRow(ctx, statsQuery).Scan(&totalMembers, &pendingRequests, &todayDeposits, &todayLoans); err != nil {
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
			"amount": amount / 100,
			"time":   createdAt.Format(time.RFC3339),
		})
	}

	return map[string]interface{}{
		"stats": map[string]interface{}{
			"totalMembers":    totalMembers,
			"pendingRequests": pendingRequests,
			"todayDeposits":   todayDeposits / 100,
			"todayLoans":      todayLoans / 100,
		},
		"pendingRequests": pending,
	}, nil
}

func (r *UserRepository) GetMembersList(ctx context.Context, includeAdmins bool) ([]map[string]interface{}, error) {
	roleFilter := "u.role = 'MEMBER'"
	if includeAdmins {
		roleFilter = "u.role IN ('WORKER', 'ADMIN')"
	}
	query := `
		SELECT
			u.id::text,
			COALESCE(u."nameEn", ''),
			COALESCE(u.email, ''),
			u.phone,
			COALESCE(u."nidNumber", ''),
			u.status::text,
			u."createdAt",
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status IN ('APPROVED','ACTIVE')), 0)::bigint,
			COALESCE(addr.district, ''),
			u.role::text
		FROM users u
		LEFT JOIN accounts a ON a."userId" = u.id
		LEFT JOIN addresses addr ON addr."userPermanentId" = u.id
		WHERE ` + roleFilter + `
		ORDER BY u."createdAt" DESC
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]map[string]interface{}, 0)
	for rows.Next() {
		var id, name, email, phone, nid, status, area, role string
		var createdAt time.Time
		var savingsBalance, activeLoan int64
		if scanErr := rows.Scan(&id, &name, &email, &phone, &nid, &status, &createdAt, &savingsBalance, &activeLoan, &area, &role); scanErr != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":              id,
			"name":            name,
			"email":           email,
			"phone":           phone,
			"nidNumber":       nid,
			"status":          strings.ToUpper(status),
			"joinDate":        createdAt.Format(time.RFC3339),
			"currentDeposit":  savingsBalance / 100,
			"activeLoan":      activeLoan / 100,
			"area":            area,
			"role":            strings.ToUpper(role),
			"assignedArea":    area,
			"address":         area,
			"lastActive":      createdAt.Format(time.RFC3339),
			"lastTransaction": createdAt.Format(time.RFC3339),
		})
	}
	return result, nil
}

func (r *UserRepository) GetAdminDashboard(ctx context.Context) (map[string]interface{}, error) {
	const query = `
		SELECT
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER'), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM users WHERE role IN ('WORKER','ADMIN')), 0)::bigint,
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'DEPOSIT'), 0)::bigint,
			COALESCE((SELECT SUM("principalAmount") FROM loans), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM loans WHERE status = 'ACTIVE'), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM loans WHERE status = 'DEFAULTED'), 0)::bigint,
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'DONATION'), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND "createdAt" >= date_trunc('month', CURRENT_DATE)), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND "createdAt" >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND "createdAt" < date_trunc('month', CURRENT_DATE)), 0)::bigint
	`
	var totalMembers, totalWorkers, totalDeposits, totalLoans, activeLoanCount, defaultedLoans, charityFund int64
	var thisMonthMembers, lastMonthMembers int64
	if err := r.db.QueryRow(ctx, query).Scan(
		&totalMembers, &totalWorkers, &totalDeposits, &totalLoans, &activeLoanCount, &defaultedLoans, &charityFund,
		&thisMonthMembers, &lastMonthMembers,
	); err != nil {
		return nil, err
	}

	// Get accurate recovery rate from GetLoanStats (uses correct formula)
	loanStats, err := r.GetLoanStats(ctx)
	var recoveryRate float64 = 100.0
	if err == nil {
		if rate, ok := loanStats["recoveryRate"].(float64); ok {
			recoveryRate = rate
		}
	}

	// Calculate monthly growth
	var monthlyGrowth float64 = 0
	if lastMonthMembers > 0 {
		monthlyGrowth = float64(thisMonthMembers-lastMonthMembers) / float64(lastMonthMembers) * 100
	} else if thisMonthMembers > 0 {
		monthlyGrowth = 100
	}

	const activityQuery = `
		SELECT action, subject_user, actor_name, event_time, entity_type
		FROM (
			SELECT
				'USER_APPROVED'::text as action,
				COALESCE(target_user."nameEn", '') as subject_user,
				COALESCE(actor_user."nameEn", actor_user."nameBn", 'System') as actor_name,
				u."approvedAt" as event_time,
				'USER'::text as entity_type
			FROM users u
			LEFT JOIN users actor_user ON actor_user.id = u."approvedBy"
			LEFT JOIN users target_user ON target_user.id = u.id
			WHERE u."approvedAt" IS NOT NULL

			UNION ALL

			SELECT
				CASE
					WHEN l.status = 'REJECTED' THEN 'LOAN_REJECTED'
					ELSE 'LOAN_APPROVED'
				END as action,
				COALESCE(borrower."nameEn", borrower."nameBn", '') as subject_user,
				COALESCE(actor_user."nameEn", actor_user."nameBn", 'System') as actor_name,
				COALESCE(l."approvedAt", l."updatedAt") as event_time,
				'LOAN'::text as entity_type
			FROM loans l
			JOIN users borrower ON borrower.id = l."borrowerId"
			LEFT JOIN users actor_user ON actor_user.id = l."approvedBy"
			WHERE l."approvedBy" IS NOT NULL

			UNION ALL

			SELECT
				CASE
					WHEN t.status = 'REJECTED' THEN 'TRANSACTION_REJECTED'
					WHEN t.type = 'DEPOSIT' AND t.status = 'CONFIRMED' THEN 'DEPOSIT_CONFIRMED'
					WHEN t.type = 'WITHDRAWAL' AND t.status = 'PROCESSED' THEN 'WITHDRAWAL_PROCESSED'
					ELSE t.type::text
				END as action,
				COALESCE(member_user."nameEn", member_user."nameBn", '') as subject_user,
				COALESCE(actor_user."nameEn", actor_user."nameBn", t."processedBy", 'System') as actor_name,
				COALESCE(t."processedAt", t."createdAt") as event_time,
				'TRANSACTION'::text as entity_type
			FROM transactions t
			JOIN users member_user ON member_user.id = t."userId"
			LEFT JOIN users actor_user ON actor_user.id = t."processedBy"
			WHERE t.type IN ('DEPOSIT', 'WITHDRAWAL', 'LOAN_DISBURSEMENT')
			  AND t.status IN ('PROCESSED', 'CONFIRMED', 'REJECTED')
			  AND t."processedBy" IS NOT NULL
		) activity
		ORDER BY event_time DESC
		LIMIT 12
	`
	rows, err := r.db.Query(ctx, activityQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recentActivity := make([]map[string]interface{}, 0)
	var idx int64 = 1
	for rows.Next() {
		var action, user, actorName, entityType string
		var createdAt time.Time
		if scanErr := rows.Scan(&action, &user, &actorName, &createdAt, &entityType); scanErr != nil {
			continue
		}
		recentActivity = append(recentActivity, map[string]interface{}{
			"id":         idx,
			"action":     action,
			"user":       user,
			"actorName":  actorName,
			"entityType": entityType,
			"time":       createdAt.Format(time.RFC3339),
		})
		idx++
	}

	return map[string]interface{}{
		"stats": map[string]interface{}{
			"totalMembers":    totalMembers,
			"totalWorkers":    totalWorkers,
			"totalDeposits":   totalDeposits / 100,
			"totalLoans":      totalLoans / 100,
			"activeLoanCount": activeLoanCount,
			"defaultedLoans":  defaultedLoans,
			"charityFund":     charityFund / 100,
			"monthlyGrowth":   monthlyGrowth,
			"recoveryRate":    recoveryRate,
		},
		"recentActivity": recentActivity,
	}, nil
}

func (r *UserRepository) GetUserInfo(ctx context.Context, userID string) (map[string]interface{}, error) {
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
			COALESCE(u."memberId", '')
		FROM users u
		WHERE u.id = $1
	`
	var id, nameEn, nameBn, email, phone, role, status, avatarUrl, memberId string
	if err := r.db.QueryRow(ctx, query, userID).Scan(
		&id, &nameEn, &nameBn, &email, &phone, &role, &status, &avatarUrl, &memberId,
	); err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"id":        id,
		"nameEn":    nameEn,
		"nameBn":    nameBn,
		"email":     email,
		"phone":     phone,
		"role":      strings.ToUpper(role),
		"status":    strings.ToUpper(status),
		"avatarUrl": avatarUrl,
		"memberId":  memberId,
	}, nil
}

func (r *UserRepository) UpdateUserStatus(ctx context.Context, userID string, status string, reason string) error {
	const query = `UPDATE users SET status = $2, "updatedAt" = NOW() WHERE id = $1`
	_, err := r.db.Exec(ctx, query, userID, status)
	return err
}

// ==================== APPROVAL MANAGEMENT ====================

func (r *UserRepository) GetPendingApprovals(ctx context.Context) (map[string]interface{}, error) {
	result := map[string]interface{}{
		"registrationRequests": []map[string]interface{}{},
		"loanRequests":         []map[string]interface{}{},
		"withdrawalRequests":   []map[string]interface{}{},
	}

	// Get pending user registrations
	const regQuery = `
		SELECT
			u.id,
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u.email, ''),
			u.phone,
			COALESCE(u."nidNumber", ''),
			COALESCE(a.district, ''),
			u."createdAt",
			ARRAY[]::text[] as documents
		FROM users u
		LEFT JOIN addresses a ON a."userPermanentId" = u.id
		WHERE u.status = 'PENDING' AND u.role = 'MEMBER'
		ORDER BY u."createdAt" DESC
	`
	regRows, err := r.db.Query(ctx, regQuery)
	if err == nil {
		defer regRows.Close()
		registrations := []map[string]interface{}{}
		for regRows.Next() {
			var id, name, nameBn, email, phone, nid, area string
			var createdAt time.Time
			var documents []string
			if err := regRows.Scan(&id, &name, &nameBn, &email, &phone, &nid, &area, &createdAt, &documents); err != nil {
				continue
			}
			registrations = append(registrations, map[string]interface{}{
				"id":          id,
				"name":        name,
				"nameBn":      nameBn,
				"email":       email,
				"phone":       phone,
				"nidNumber":   nid,
				"area":        area,
				"requestDate": createdAt.Format(time.RFC3339),
				"documents":   documents,
			})
		}
		result["registrationRequests"] = registrations
	}

	// Get pending loan requests
	const loanQuery = `
		SELECT
			l.id,
			COALESCE(u."memberId", ''),
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			l."principalAmount"::bigint,
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE(a."maxLoanAmount", 0)::bigint,
			COALESCE(g.id, ''),
			COALESCE(g."nameEn", ''),
			COALESCE(l.purpose, ''),
			l."createdAt",
			COALESCE((
				SELECT COUNT(*)::int
				FROM loans l2
				WHERE l2."borrowerId" = l."borrowerId" AND l2.status = 'COMPLETED'
			), 0) as previous_loans,
			CASE
				WHEN COALESCE((SELECT COUNT(*) FROM loans WHERE "borrowerId" = l."borrowerId" AND status = 'DEFAULTED'), 0) > 0 THEN 'POOR'
				WHEN COALESCE((SELECT COUNT(*) FROM loans WHERE "borrowerId" = l."borrowerId" AND status = 'COMPLETED'), 0) >= 3 THEN 'EXCELLENT'
				WHEN COALESCE((SELECT COUNT(*) FROM loans WHERE "borrowerId" = l."borrowerId" AND status = 'COMPLETED'), 0) >= 1 THEN 'GOOD'
				ELSE 'NONE'
			END as repayment_history
		FROM loans l
		JOIN users u ON u.id = l."borrowerId"
		JOIN accounts a ON a."userId" = u.id
		LEFT JOIN users g ON g.id = l."guarantorId"
		WHERE l.status = 'PENDING'
		ORDER BY l."createdAt" DESC
	`
	loanRows, err := r.db.Query(ctx, loanQuery)
	if err == nil {
		defer loanRows.Close()
		loans := []map[string]interface{}{}
		for loanRows.Next() {
			var id, memberId, memberName, memberNameBn, guarantorId, guarantorName, purpose, repaymentHistory string
			var amount, currentDeposit, maxEligible int64
			var createdAt time.Time
			var previousLoans int
			if err := loanRows.Scan(&id, &memberId, &memberName, &memberNameBn, &amount, &currentDeposit, &maxEligible,
				&guarantorId, &guarantorName, &purpose, &createdAt, &previousLoans, &repaymentHistory); err != nil {
				continue
			}
			loans = append(loans, map[string]interface{}{
				"id":                id,
				"memberId":          memberId,
				"memberName":        memberName,
				"memberNameBn":      memberNameBn,
				"requestedAmount":   amount,
				"currentDeposit":    currentDeposit,
				"maxEligible":       maxEligible,
				"guarantorId":       guarantorId,
				"guarantorName":     guarantorName,
				"guarantorApproved": guarantorId != "",
				"purpose":           purpose,
				"requestDate":       createdAt.Format(time.RFC3339),
				"previousLoans":     previousLoans,
				"repaymentHistory":  repaymentHistory,
			})
		}
		result["loanRequests"] = loans
	}

	// Withdrawal requests placeholder (would need a separate table or transaction status field)
	result["withdrawalRequests"] = []map[string]interface{}{}

	return result, nil
}

func (r *UserRepository) ApproveRegistration(ctx context.Context, userID, approverID, notes string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Update user status to ACTIVE
	const updateQuery = `
		UPDATE users
		SET status = 'ACTIVE', "approvedAt" = NOW(), "approvedBy" = $2, "updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateQuery, userID, approverID); err != nil {
		return err
	}

	// Create account if not exists
	var accountExists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE "userId" = $1)`, userID).Scan(&accountExists)
	if err != nil {
		return err
	}

	if !accountExists {
		const createAccountQuery = `
			INSERT INTO accounts (id, "accountNumber", "savingsBalance", "loanBalance", "isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
			VALUES (gen_random_uuid()::text, CONCAT('HN-ACC-', (SELECT "memberId" FROM users WHERE id = $1)), 0, 0, true, 0, NOW(), NOW(), $1)
		`
		if _, err := tx.Exec(ctx, createAccountQuery, userID); err != nil {
			return err
		}
	}

	// Create audit log
	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'APPROVE_REGISTRATION', 'USER', $1, $2, NOW(), $3)
	`
	if _, err := tx.Exec(ctx, auditQuery, userID, approverID, notes); err != nil {
		// Audit log is optional, don't fail if table doesn't exist
	}

	return tx.Commit(ctx)
}

func (r *UserRepository) RejectRegistration(ctx context.Context, userID, approverID, reason string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Update user status to INACTIVE
	const updateQuery = `
		UPDATE users
		SET status = 'INACTIVE', "updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateQuery, userID); err != nil {
		return err
	}

	// Create audit log
	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'REJECT_REGISTRATION', 'USER', $1, $2, NOW(), $3)
	`
	if _, err := tx.Exec(ctx, auditQuery, userID, approverID, reason); err != nil {
		// Audit log is optional
	}

	return tx.Commit(ctx)
}

func (r *UserRepository) ApproveLoan(ctx context.Context, loanID, approverID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Get loan details
	var principalAmount int64
	var borrowerID, accountID string
	const loanQuery = `
		SELECT "principalAmount", "borrowerId", "accountId"
		FROM loans
		WHERE id = $1
	`
	if err := tx.QueryRow(ctx, loanQuery, loanID).Scan(&principalAmount, &borrowerID, &accountID); err != nil {
		return err
	}

	// Update loan status to ACTIVE and set disbursement date
	const updateLoanQuery = `
		UPDATE loans
		SET status = 'ACTIVE', "disbursementDate" = NOW(), "approvedAt" = NOW(), "approvedBy" = $2, "updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateLoanQuery, loanID, approverID); err != nil {
		return err
	}

	// Update account loan balance
	const updateAccountQuery = `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" + $2, "updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateAccountQuery, accountID, principalAmount); err != nil {
		return err
	}

	// Create LOAN_DISBURSEMENT transaction
	const txnQuery = `
		INSERT INTO transactions (id, type, amount, description, "createdAt", "accountId", "userId", "loanId", "processedBy")
		VALUES (gen_random_uuid()::text, 'LOAN_DISBURSEMENT', $1, 'ঋণ বিতরণ', NOW(), $2, $3, $4, $5)
	`
	if _, err := tx.Exec(ctx, txnQuery, principalAmount, accountID, borrowerID, loanID, approverID); err != nil {
		return err
	}

	// Create audit log
	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt")
		VALUES (gen_random_uuid()::text, 'APPROVE_LOAN', 'LOAN', $1, $2, NOW())
	`
	tx.Exec(ctx, auditQuery, loanID, approverID)

	return tx.Commit(ctx)
}

func (r *UserRepository) RejectLoan(ctx context.Context, loanID, approverID, reason string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Update loan status to REJECTED
	const updateQuery = `
		UPDATE loans
		SET status = 'REJECTED', "updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateQuery, loanID); err != nil {
		return err
	}

	// Create audit log
	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'REJECT_LOAN', 'LOAN', $1, $2, NOW(), $3)
	`
	tx.Exec(ctx, auditQuery, loanID, approverID, reason)

	return tx.Commit(ctx)
}

func (r *UserRepository) ApproveWithdrawal(ctx context.Context, requestID, approverID string) error {
	// This would require a withdrawal_requests table or pending transactions
	// For now, this is a placeholder implementation
	return nil
}

func (r *UserRepository) RejectWithdrawal(ctx context.Context, requestID, approverID, reason string) error {
	// Placeholder implementation
	return nil
}

// ==================== DEPOSIT & TRANSACTION MANAGEMENT ====================

func (r *UserRepository) GetAllDeposits(ctx context.Context, filters map[string]interface{}) (map[string]interface{}, error) {
	query := `
		SELECT
			t.id,
			t.type::text,
			t.amount::bigint,
			COALESCE(t."receiptNumber", ''),
			COALESCE(t.description, ''),
			t."createdAt",
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
		query += fmt.Sprintf(` AND (u."nameEn" ILIKE $%d OR u."memberId" ILIKE $%d)`, argCount, argCount)
		args = append(args, "%"+search+"%")
	}

	query += ` ORDER BY t."createdAt" DESC LIMIT 100`

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deposits := []map[string]interface{}{}
	for rows.Next() {
		var id, txType, receipt, description, memberName, memberNameBn, memberId, processorName string
		var amount int64
		var createdAt time.Time
		if err := rows.Scan(&id, &txType, &amount, &receipt, &description, &createdAt, &memberName, &memberNameBn, &memberId, &processorName); err != nil {
			continue
		}
		deposits = append(deposits, map[string]interface{}{
			"id":           id,
			"type":         txType,
			"amount":       amount,
			"receipt":      receipt,
			"description":  description,
			"date":         createdAt.Format(time.RFC3339),
			"memberName":   memberName,
			"memberNameBn": memberNameBn,
			"memberId":     memberId,
			"processedBy":  processorName,
		})
	}

	// Get stats
	stats, _ := r.GetDepositStats(ctx)

	return map[string]interface{}{
		"deposits": deposits,
		"total":    len(deposits),
		"stats":    stats,
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

func (r *UserRepository) GetAllLoans(ctx context.Context, filters map[string]interface{}) ([]map[string]interface{}, error) {
	query := `
		SELECT
			l.id,
			l."loanNumber",
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l."totalInstallments",
			l."paidInstallments",
			l."disbursementDate",
			l."expectedEndDate",
			COALESCE(l."completedAt", '0001-01-01'::timestamp),
			l.purpose,
			l.status::text,
			l."createdAt",
			COALESCE(b."nameEn", ''),
			COALESCE(b."nameBn", ''),
			COALESCE(b."memberId", ''),
			COALESCE(g."nameEn", ''),
			COALESCE(g."memberId", '')
		FROM loans l
		JOIN users b ON b.id = l."borrowerId"
		LEFT JOIN users g ON g.id = l."guarantorId"
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
		query += fmt.Sprintf(` AND (b."nameEn" ILIKE $%d OR b."memberId" ILIKE $%d OR l."loanNumber" ILIKE $%d)`, argCount, argCount, argCount)
		args = append(args, "%"+search+"%")
	}

	query += ` ORDER BY l."createdAt" DESC LIMIT 100`

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	loans := []map[string]interface{}{}
	for rows.Next() {
		var id, loanNumber, purpose, status, borrowerName, borrowerNameBn, borrowerMemberId, guarantorName, guarantorMemberId string
		var principalAmount, remainingAmount int64
		var totalInstallments, paidInstallments int
		var disbursementDate, expectedEndDate, completedAt, createdAt time.Time

		if err := rows.Scan(&id, &loanNumber, &principalAmount, &remainingAmount, &totalInstallments, &paidInstallments,
			&disbursementDate, &expectedEndDate, &completedAt, &purpose, &status, &createdAt,
			&borrowerName, &borrowerNameBn, &borrowerMemberId, &guarantorName, &guarantorMemberId); err != nil {
			continue
		}

		loan := map[string]interface{}{
			"id":                id,
			"loanNumber":        loanNumber,
			"principalAmount":   principalAmount,
			"remainingAmount":   remainingAmount,
			"totalInstallments": totalInstallments,
			"paidInstallments":  paidInstallments,
			"purpose":           purpose,
			"status":            status,
			"borrowerName":      borrowerName,
			"borrowerNameBn":    borrowerNameBn,
			"borrowerMemberId":  borrowerMemberId,
			"guarantorName":     guarantorName,
			"guarantorMemberId": guarantorMemberId,
			"createdAt":         createdAt.Format(time.RFC3339),
		}

		if !disbursementDate.IsZero() {
			loan["disbursementDate"] = disbursementDate.Format(time.RFC3339)
		}
		if !expectedEndDate.IsZero() {
			loan["expectedEndDate"] = expectedEndDate.Format(time.RFC3339)
		}
		if !completedAt.IsZero() && completedAt.Year() > 1 {
			loan["completedAt"] = completedAt.Format(time.RFC3339)
		}

		loans = append(loans, loan)
	}

	return loans, nil
}

func (r *UserRepository) GetLoanStats(ctx context.Context) (map[string]interface{}, error) {
	const query = `
		SELECT
			COALESCE(SUM(CASE WHEN status IN ('ACTIVE', 'COMPLETED', 'DEFAULTED') THEN "principalAmount" ELSE 0 END)::bigint, 0) as total_disbursed,
			COALESCE(SUM(CASE WHEN status IN ('ACTIVE', 'COMPLETED', 'DEFAULTED') THEN ("principalAmount" - "remainingAmount") ELSE 0 END)::bigint, 0) as total_recovered,
			COALESCE(COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END)::int, 0) as active_loans,
			COALESCE(COUNT(CASE WHEN status = 'DEFAULTED' THEN 1 END)::int, 0) as defaulted_loans,
			COALESCE(COUNT(CASE WHEN status = 'PENDING' THEN 1 END)::int, 0) as pending_loans,
			COALESCE(COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int, 0) as completed_loans
		FROM loans
	`

	var totalDisbursed, totalRecovered int64
	var activeLoans, defaultedLoans, pendingLoans, completedLoans int

	if err := r.db.QueryRow(ctx, query).Scan(&totalDisbursed, &totalRecovered, &activeLoans, &defaultedLoans, &pendingLoans, &completedLoans); err != nil {
		return nil, err
	}

	// Calculate recovery rate - CRITICAL FIX for hardcoded 98.5%
	var recoveryRate float64 = 100.0
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
			COALESCE(b."memberId", ''),
			COALESCE(b.phone, ''),
			COALESCE(g."nameEn", ''),
			COALESCE(g."nameBn", ''),
			COALESCE(g."memberId", ''),
			COALESCE(g.phone, '')
		FROM loans l
		JOIN users b ON b.id = l."borrowerId"
		LEFT JOIN users g ON g.id = l."guarantorId"
		WHERE l.id = $1
	`

	var id, loanNumber, purpose, status, borrowerName, borrowerNameBn, borrowerMemberId, borrowerPhone string
	var guarantorName, guarantorNameBn, guarantorMemberId, guarantorPhone string
	var principalAmount, remainingAmount, installmentAmount int64
	var totalInstallments, paidInstallments int
	var disbursementDate, installmentStartDate, expectedEndDate, completedAt, createdAt time.Time

	if err := r.db.QueryRow(ctx, loanQuery, loanID).Scan(
		&id, &loanNumber, &principalAmount, &remainingAmount, &totalInstallments, &installmentAmount, &paidInstallments,
		&disbursementDate, &installmentStartDate, &expectedEndDate, &completedAt, &purpose, &status, &createdAt,
		&borrowerName, &borrowerNameBn, &borrowerMemberId, &borrowerPhone,
		&guarantorName, &guarantorNameBn, &guarantorMemberId, &guarantorPhone); err != nil {
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
			"name":     borrowerName,
			"nameBn":   borrowerNameBn,
			"memberId": borrowerMemberId,
			"phone":    borrowerPhone,
		},
	}

	if guarantorName != "" {
		result["guarantor"] = map[string]interface{}{
			"name":     guarantorName,
			"nameBn":   guarantorNameBn,
			"memberId": guarantorMemberId,
			"phone":    guarantorPhone,
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

func (r *UserRepository) MarkLoanDefaulted(ctx context.Context, loanID, adminID, notes string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Update loan status to DEFAULTED
	const updateQuery = `
		UPDATE loans
		SET status = 'DEFAULTED', "updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateQuery, loanID); err != nil {
		return err
	}

	// Create audit log
	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'MARK_LOAN_DEFAULTED', 'LOAN', $1, $2, NOW(), $3)
	`
	tx.Exec(ctx, auditQuery, loanID, adminID, notes)

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Process waterfall recovery
	return r.ProcessWaterfallRecovery(ctx, loanID)
}

func (r *UserRepository) ProcessWaterfallRecovery(ctx context.Context, loanID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Get loan details
	var remainingAmount int64
	var borrowerID, guarantorID, accountID string
	const loanQuery = `
		SELECT "remainingAmount", "borrowerId", "guarantorId", "accountId"
		FROM loans
		WHERE id = $1
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
		err := tx.QueryRow(ctx, `SELECT "savingsBalance", id FROM accounts WHERE "userId" = $1`, borrowerID).Scan(&borrowerSavings, &borrowerAccountID)
		if err == nil && borrowerSavings > 0 {
			deduction := amountToRecover
			if deduction > borrowerSavings {
				deduction = borrowerSavings
			}

			// Deduct from borrower
			_, err = tx.Exec(ctx, `UPDATE accounts SET "savingsBalance" = "savingsBalance" - $1 WHERE id = $2`, deduction, borrowerAccountID)
			if err == nil {
				// Create transaction record
				tx.Exec(ctx, `
					INSERT INTO transactions (id, type, amount, description, "createdAt", "accountId", "userId", "loanId")
					VALUES (gen_random_uuid()::text, 'WITHDRAWAL', $1, 'ডিফল্ট ঋণ পুনরুদ্ধার - ঋণগ্রহীতা', NOW(), $2, $3, $4)
				`, deduction, borrowerAccountID, borrowerID, loanID)

				amountToRecover -= deduction
				recoverySteps = append(recoverySteps, fmt.Sprintf("Recovered %d from borrower", deduction))
			}
		}
	}

	// Step 2: Try to recover from guarantor's savings
	if amountToRecover > 0 && guarantorID != "" {
		var guarantorSavings int64
		var guarantorAccountID string
		err := tx.QueryRow(ctx, `SELECT "savingsBalance", id FROM accounts WHERE "userId" = $1`, guarantorID).Scan(&guarantorSavings, &guarantorAccountID)
		if err == nil && guarantorSavings > 0 {
			deduction := amountToRecover
			if deduction > guarantorSavings {
				deduction = guarantorSavings
			}

			// Deduct from guarantor
			_, err = tx.Exec(ctx, `UPDATE accounts SET "savingsBalance" = "savingsBalance" - $1 WHERE id = $2`, deduction, guarantorAccountID)
			if err == nil {
				// Create transaction record
				tx.Exec(ctx, `
					INSERT INTO transactions (id, type, amount, description, "createdAt", "accountId", "userId", "loanId")
					VALUES (gen_random_uuid()::text, 'WITHDRAWAL', $1, 'ডিফল্ট ঋণ পুনরুদ্ধার - জামিনদাতা', NOW(), $2, $3, $4)
				`, deduction, guarantorAccountID, guarantorID, loanID)

				amountToRecover -= deduction
				recoverySteps = append(recoverySteps, fmt.Sprintf("Recovered %d from guarantor", deduction))
			}
		}
	}

	// Step 3: Use donation pool
	if amountToRecover > 0 {
		var donationBalance int64
		err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount)::bigint, 0)
			FROM transactions
			WHERE type = 'DONATION'
		`).Scan(&donationBalance)

		if err == nil && donationBalance > 0 {
			deduction := amountToRecover
			if deduction > donationBalance {
				deduction = donationBalance
			}

			// Record donation usage
			tx.Exec(ctx, `
				INSERT INTO transactions (id, type, amount, description, "createdAt", "loanId")
				VALUES (gen_random_uuid()::text, 'FEE', $1, 'দাতব্য তহবিল থেকে ডিফল্ট ঋণ পুনরুদ্ধার', NOW(), $2)
			`, deduction, loanID)

			amountToRecover -= deduction
			recoverySteps = append(recoverySteps, fmt.Sprintf("Recovered %d from donation pool", deduction))
		}
	}

	// Update loan remaining amount
	newRemaining := amountToRecover
	_, err = tx.Exec(ctx, `UPDATE loans SET "remainingAmount" = $1 WHERE id = $2`, newRemaining, loanID)
	if err != nil {
		return err
	}

	// Create audit log
	recoveryDetails := fmt.Sprintf("Waterfall recovery completed. Steps: %v. Remaining: %d", recoverySteps, newRemaining)
	tx.Exec(ctx, `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'WATERFALL_RECOVERY', 'LOAN', $1, NOW(), $2)
	`, loanID, recoveryDetails)

	return tx.Commit(ctx)
}

// ==================== DONATION MANAGEMENT ====================

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
		donations = append(donations, map[string]interface{}{
			"id":          id,
			"amount":      amount,
			"receipt":     receipt,
			"description": description,
			"date":        createdAt.Format(time.RFC3339),
			"donorName":   donorName,
			"donorNameBn": donorNameBn,
			"donorId":     donorId,
		})
	}

	return donations, nil
}

func (r *UserRepository) RecordDonation(ctx context.Context, amount int64, donorName, notes string) error {
	// Get or create donation account
	var donationAccID string
	err := r.db.QueryRow(ctx, `SELECT id FROM accounts WHERE "accountNumber" = 'HN-ACC-DONATION'`).Scan(&donationAccID)
	if err != nil {
		// Donation account doesn't exist, return error
		return fmt.Errorf("donation account not found")
	}

	// Create donation transaction
	const txnQuery = `
		INSERT INTO transactions (id, type, amount, "receiptNumber", description, "createdAt", "accountId")
		VALUES (gen_random_uuid()::text, 'DONATION', $1, 'DON-AUTO', $2, NOW(), $3)
	`
	_, err = r.db.Exec(ctx, txnQuery, amount, notes, donationAccID)
	return err
}

// ==================== REPORT GENERATION ====================

func (r *UserRepository) GetMonthlyReport(ctx context.Context, year, month int) (map[string]interface{}, error) {
	queryCondition := "EXTRACT(YEAR FROM t.\"createdAt\") = $1"
	args := []interface{}{year}

	if month > 0 {
		queryCondition += " AND EXTRACT(MONTH FROM t.\"createdAt\") = $2"
		args = append(args, month)
	}

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
		"netSavings":       totalDeposits - totalWithdrawals,
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
		defaultRate = float64(defaultedCount) / float64(totalLoans) * 100
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

func (r *UserRepository) GetAdminProfile(ctx context.Context, userID string) (map[string]interface{}, error) {
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
			COALESCE(u."memberId", ''),
			u."createdAt"
		FROM users u
		WHERE u.id = $1
	`

	var id, nameEn, nameBn, email, phone, role, status, avatarUrl, memberId string
	var createdAt time.Time

	if err := r.db.QueryRow(ctx, query, userID).Scan(
		&id, &nameEn, &nameBn, &email, &phone, &role, &status, &avatarUrl, &memberId, &createdAt); err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"id":        id,
		"nameEn":    nameEn,
		"nameBn":    nameBn,
		"email":     email,
		"phone":     phone,
		"role":      role,
		"status":    status,
		"avatarUrl": avatarUrl,
		"memberId":  memberId,
		"joinedAt":  createdAt.Format(time.RFC3339),
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
			COALESCE(u."memberId", ''),
			COALESCE(u."assignedBranch", ''),
			u."createdAt",
			COALESCE((SELECT COUNT(*)::int FROM transactions WHERE "processedBy" = u.id), 0) as transactions_processed
		FROM users u
		WHERE u.id = $1
	`

	var id, nameEn, nameBn, email, phone, role, status, avatarUrl, memberId, assignedBranch string
	var createdAt time.Time
	var transactionsProcessed int

	if err := r.db.QueryRow(ctx, query, userID).Scan(
		&id, &nameEn, &nameBn, &email, &phone, &role, &status, &avatarUrl, &memberId, &assignedBranch, &createdAt, &transactionsProcessed); err != nil {
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
		"memberId":              memberId,
		"assignedBranch":        assignedBranch,
		"joinedAt":              createdAt.Format(time.RFC3339),
		"transactionsProcessed": transactionsProcessed,
	}, nil
}

func (r *UserRepository) UpdateProfile(ctx context.Context, userID string, data map[string]interface{}) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Update user basic info
	if nameEn, ok := data["nameEn"].(string); ok {
		_, err = tx.Exec(ctx, `UPDATE users SET "nameEn" = $1, "updatedAt" = NOW() WHERE id = $2`, nameEn, userID)
		if err != nil {
			return err
		}
	}

	if nameBn, ok := data["nameBn"].(string); ok {
		_, err = tx.Exec(ctx, `UPDATE users SET "nameBn" = $1, "updatedAt" = NOW() WHERE id = $2`, nameBn, userID)
		if err != nil {
			return err
		}
	}

	if phone, ok := data["phone"].(string); ok {
		_, err = tx.Exec(ctx, `UPDATE users SET phone = $1, "updatedAt" = NOW() WHERE id = $2`, phone, userID)
		if err != nil {
			return err
		}
	}

	if email, ok := data["email"].(string); ok {
		_, err = tx.Exec(ctx, `UPDATE users SET email = $1, "updatedAt" = NOW() WHERE id = $2`, email, userID)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// ==================== WORKER-SPECIFIC METHODS ====================

func (r *UserRepository) GetWorkerRequests(ctx context.Context, workerID string) ([]map[string]interface{}, error) {
	// For now, return empty - would need a requests table or pending transactions
	return []map[string]interface{}{}, nil
}

func (r *UserRepository) GetWorkerLoans(ctx context.Context, workerID string) ([]map[string]interface{}, error) {
	// Get loans from members in worker's branch
	const query = `
		SELECT
			l.id,
			l."loanNumber",
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l.status::text,
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."memberId", ''),
			l."createdAt"
		FROM loans l
		JOIN users u ON u.id = l."borrowerId"
		WHERE l.status IN ('ACTIVE', 'PENDING')
		ORDER BY l."createdAt" DESC
		LIMIT 50
	`

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	loans := []map[string]interface{}{}
	for rows.Next() {
		var id, loanNumber, status, memberName, memberNameBn, memberId string
		var principalAmount, remainingAmount int64
		var createdAt time.Time

		if err := rows.Scan(&id, &loanNumber, &principalAmount, &remainingAmount, &status, &memberName, &memberNameBn, &memberId, &createdAt); err != nil {
			continue
		}

		loans = append(loans, map[string]interface{}{
			"id":              id,
			"loanNumber":      loanNumber,
			"principalAmount": principalAmount,
			"remainingAmount": remainingAmount,
			"status":          status,
			"memberName":      memberName,
			"memberNameBn":    memberNameBn,
			"memberId":        memberId,
			"createdAt":       createdAt.Format(time.RFC3339),
		})
	}

	return loans, nil
}

func (r *UserRepository) GetWorkerTransactions(ctx context.Context, workerID string) ([]map[string]interface{}, error) {
	const query = `
		SELECT
			t.id,
			t.type::text,
			t.amount::bigint,
			COALESCE(t."receiptNumber", ''),
			COALESCE(t.description, ''),
			t."createdAt",
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."memberId", '')
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
		var id, txType, receipt, description, memberName, memberNameBn, memberId string
		var amount int64
		var createdAt time.Time

		if err := rows.Scan(&id, &txType, &amount, &receipt, &description, &createdAt, &memberName, &memberNameBn, &memberId); err != nil {
			continue
		}

		transactions = append(transactions, map[string]interface{}{
			"id":           id,
			"type":         txType,
			"amount":       amount,
			"receipt":      receipt,
			"description":  description,
			"date":         createdAt.Format(time.RFC3339),
			"memberName":   memberName,
			"memberNameBn": memberNameBn,
			"memberId":     memberId,
		})
	}

	return transactions, nil
}

func (r *UserRepository) ProcessDeposit(ctx context.Context, memberID, workerID string, amount int64, receipt string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Get account ID
	var accountID string
	var currentBalance int64
	err = tx.QueryRow(ctx, `SELECT id, "savingsBalance" FROM accounts WHERE "userId" = $1`, memberID).Scan(&accountID, &currentBalance)
	if err != nil {
		return fmt.Errorf("account not found")
	}

	// Update account balance
	newBalance := currentBalance + amount
	_, err = tx.Exec(ctx, `UPDATE accounts SET "savingsBalance" = $1, "updatedAt" = NOW() WHERE id = $2`, newBalance, accountID)
	if err != nil {
		return err
	}

	// Create deposit transaction
	const txnQuery = `
		INSERT INTO transactions (id, type, amount, "receiptNumber", description, "savingsAfter", "createdAt", "accountId", "userId", "processedBy")
		VALUES (gen_random_uuid()::text, 'DEPOSIT', $1, $2, 'জমা', $3, NOW(), $4, $5, $6)
	`
	_, err = tx.Exec(ctx, txnQuery, amount, receipt, newBalance, accountID, memberID, workerID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}
