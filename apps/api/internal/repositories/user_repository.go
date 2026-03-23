package repositories

import (
	"context"
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
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'DONATION'), 0)::bigint
	`
	var totalMembers, totalWorkers, totalDeposits, totalLoans, activeLoanCount, defaultedLoans, charityFund int64
	if err := r.db.QueryRow(ctx, query).Scan(
		&totalMembers, &totalWorkers, &totalDeposits, &totalLoans, &activeLoanCount, &defaultedLoans, &charityFund,
	); err != nil {
		return nil, err
	}

	const activityQuery = `
		SELECT
			COALESCE(t.type::text, 'ACTIVITY'),
			COALESCE(u."nameEn", ''),
			t."createdAt"
		FROM transactions t
		LEFT JOIN users u ON u.id = t."userId"
		ORDER BY t."createdAt" DESC
		LIMIT 8
	`
	rows, err := r.db.Query(ctx, activityQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recentActivity := make([]map[string]interface{}, 0)
	var idx int64 = 1
	for rows.Next() {
		var action, user string
		var createdAt time.Time
		if scanErr := rows.Scan(&action, &user, &createdAt); scanErr != nil {
			continue
		}
		recentActivity = append(recentActivity, map[string]interface{}{
			"id":     idx,
			"action": action,
			"user":   user,
			"time":   createdAt.Format(time.RFC3339),
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
			"monthlyGrowth":   0,
		},
		"recentActivity": recentActivity,
	}, nil
}
