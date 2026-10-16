package repositories

// Administration: the admin dashboard, the member list, and the registration
// approval and rejection paths.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"hasnahena/apps/api/internal/money"
	"hasnahena/apps/api/internal/notify"
)

type RegistrationApprovalCandidate struct {
	ID        string
	Email     string
	Phone     string
	NameEn    string
	Role      string
	Status    string
	AccountNo string
	// The applicant's form language, for the approval email. Empty for
	// pre-2026-08-26 registrations (fall back to the admin's locale).
	PreferredLocale string
}

// GetMembersList returns members, or with staffOnly only WORKERs — admin
// accounts are not actionable on the Workers screen.
func (r *UserRepository) GetMembersList(ctx context.Context, staffOnly bool) ([]map[string]interface{}, error) {
	roleFilter := "u.role = 'MEMBER'"
	if staffOnly {
		roleFilter = "u.role = 'WORKER'"
	}
	query := `
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
			COALESCE(addr.district, ''),
			u.role::text,
			-- Branch is a row (WO-72); its id is its code, returned under both names.
			COALESCE(b.id::text, ''),
			COALESCE(b.name, ''),
			COALESCE(b.id::text, '')
		FROM users u
		LEFT JOIN accounts a ON a."userId" = u.id
		LEFT JOIN addresses addr ON addr."userId" = u.id AND addr.type = 'PERMANENT' 
		LEFT JOIN branches b ON b.id = u."assignedBranchId"
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
		var id, accountNo, name, email, phone, nid, status, area, role string
		var branchID, branchName, branchCode string
		var createdAt time.Time
		var savingsBalance, activeLoan int64
		if scanErr := rows.Scan(&id, &accountNo, &name, &email, &phone, &nid, &status, &createdAt,
			&savingsBalance, &activeLoan, &area, &role, &branchID, &branchName, &branchCode); scanErr != nil {
			continue
		}
		var branch interface{}
		if branchID != "" {
			branch = map[string]interface{}{"id": branchID, "name": branchName, "code": branchCode}
		}
		result = append(result, map[string]interface{}{
			"id":             id,
			"uid":            accountNo,
			"accountNo":      accountNo,
			"name":           name,
			"email":          email,
			"phone":          phone,
			"nidNumber":      nid,
			"status":         strings.ToUpper(status),
			"joinDate":       createdAt.Format(time.RFC3339),
			"currentDeposit": savingsBalance,
			"activeLoan":     activeLoan,
			"area":           area,
			"role":           strings.ToUpper(role),
			// `area` is the permanent-address district; `branch` is staff-only.
			"branch":          branch,
			"address":         area,
			"lastActive":      createdAt.Format(time.RFC3339),
			"lastTransaction": createdAt.Format(time.RFC3339),
		})
	}
	return result, nil
}

func (r *UserRepository) GetAdminDashboard(ctx context.Context) (map[string]interface{}, error) {
	// Definitions shared with the worker dashboard, loans and workers screens
	// so the same figure never reads differently in two places.
	query := `
		SELECT
			-- ACTIVE, as the worker's dashboard counts it. A PENDING registration
			-- is an application, not a member.
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND status = 'ACTIVE'), 0)::bigint,
			-- WORKER only, matching the Workers screen.
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'WORKER'), 0)::bigint,
			-- CONFIRMED only (rule 6a).
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'DEPOSIT' AND status = 'CONFIRMED'), 0)::bigint,
			-- Money that actually left the fund.
			COALESCE((SELECT SUM("principalAmount") FROM loans WHERE status IN ` + disbursedLoanStatuses + `), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM loans WHERE status = 'ACTIVE'), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM loans WHERE status = 'DEFAULTED'), 0)::bigint,
			-- Rule 6a again: an unconfirmed donation is a pledge.
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'DONATION' AND status = 'CONFIRMED'), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND status = 'ACTIVE' AND "createdAt" >= date_trunc('month', CURRENT_DATE)), 0)::bigint,
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND status = 'ACTIVE' AND "createdAt" >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND "createdAt" < date_trunc('month', CURRENT_DATE)), 0)::bigint
	`
	var totalMembers, totalWorkers, totalDepositsPaisa, totalLoansPaisa, activeLoanCount, defaultedLoans, charityFundPaisa int64
	var thisMonthMembers, lastMonthMembers int64
	if err := r.db.QueryRow(ctx, query).Scan(
		&totalMembers, &totalWorkers, &totalDepositsPaisa, &totalLoansPaisa, &activeLoanCount, &defaultedLoans, &charityFundPaisa,
		&thisMonthMembers, &lastMonthMembers,
	); err != nil {
		return nil, err
	}

	// Get accurate recovery rate from GetLoanStats (uses correct formula)
	loanStats, err := r.GetLoanStats(ctx)
	recoveryRate := 100.0
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
			"totalDeposits":   totalDepositsPaisa,
			"totalLoans":      totalLoansPaisa,
			"activeLoanCount": activeLoanCount,
			"defaultedLoans":  defaultedLoans,
			"charityFund":     charityFundPaisa,
			"monthlyGrowth":   monthlyGrowth,
			"recoveryRate":    recoveryRate,
		},
		"recentActivity": recentActivity,
	}, nil
}

func (r *UserRepository) GetPendingApprovals(ctx context.Context, includeRegistration bool) (map[string]interface{}, error) {
	result := map[string]interface{}{
		"registrationRequests": []map[string]interface{}{},
		"loanRequests":         []map[string]interface{}{},
		"withdrawalRequests":   []map[string]interface{}{},
		"transactionRequests":  []map[string]interface{}{},
	}

	// Get pending user registrations
	if includeRegistration {
		const regQuery = `
		SELECT
			u.id,
			COALESCE(u."accountNo", ''),
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u.email, ''),
			u.phone,
			COALESCE(u."nidNumber", ''),
			COALESCE(u."fatherName", ''),
			COALESCE(u."motherName", ''),
			COALESCE(u.gender::text, ''),
			COALESCE(u."maritalStatus"::text, ''),
			COALESCE(to_jsonb(u)->>'bloodGroup', ''),
			COALESCE(to_jsonb(u)->>'profession', ''),
			COALESCE(u."childrenCount", 0),
			u."dateOfBirth",
			COALESCE(a.district, ''),
			COALESCE(a."houseNo", ''),
			COALESCE(a."roadNo", ''),
			COALESCE(a.village, ''),
			COALESCE(a.union, ''),
			COALESCE(a."policeStation", ''),
			COALESCE(pa.district, ''),
			COALESCE(pa."houseNo", ''),
			COALESCE(pa."roadNo", ''),
			COALESCE(pa.village, ''),
			COALESCE(pa.union, ''),
			COALESCE(pa."policeStation", ''),
			COALESCE(n.name, ''),
			COALESCE(n.relationship, ''),
			COALESCE(n."nidNumber", ''),
			COALESCE(n.phone, ''),
			u."createdAt",
			COALESCE((
				SELECT jsonb_agg(
					jsonb_build_object(
						-- No d.id: a document is (userId, type) (ADR-044), and this
						-- aggregate is already scoped to one applicant.
						'id', d.type::text,
						'type', d.type::text,
						'url', d.url,
						'fileName', COALESCE(d."fileName", ''),
						'mimeType', COALESCE(d."mimeType", ''),
						'size', COALESCE(d.size, 0),
						'uploadedAt', d."uploadedAt"
					)
					ORDER BY d."uploadedAt" ASC
				)
				FROM documents d
				WHERE d."userId" = u.id
			), '[]'::jsonb) as documents
		FROM users u
		LEFT JOIN addresses a ON a."userId" = u.id AND a.type = 'PERMANENT'
		LEFT JOIN addresses pa ON pa."userId" = u.id AND pa.type = 'PRESENT' 
		LEFT JOIN nominees n ON n."userId" = u.id
		WHERE u.status = 'PENDING' AND u.role = 'MEMBER'
		ORDER BY u."createdAt" DESC
	`
		regRows, err := r.db.Query(ctx, regQuery)
		if err == nil {
			defer regRows.Close()
			registrations := []map[string]interface{}{}
			for regRows.Next() {
				var id, regAccountNo, name, nameBn, email, phone, nid, fatherName, motherName, gender, maritalStatus, bloodGroup, profession, area string
				var permanentHouseNo, permanentRoadNo, permanentVillage, permanentUnion, permanentPoliceStation string
				var presentDistrict, presentHouseNo, presentRoadNo, presentVillage, presentUnion, presentPoliceStation string
				var nomineeName, nomineeRelationship, nomineeNID, nomineePhone string
				var childrenCount int
				var dateOfBirth *time.Time
				var createdAt time.Time
				var documentsJSON []byte
				if err := regRows.Scan(
					&id, &regAccountNo, &name, &nameBn, &email, &phone, &nid,
					&fatherName, &motherName, &gender, &maritalStatus, &bloodGroup, &profession, &childrenCount, &dateOfBirth,
					&area,
					&permanentHouseNo, &permanentRoadNo, &permanentVillage, &permanentUnion, &permanentPoliceStation,
					&presentDistrict, &presentHouseNo, &presentRoadNo, &presentVillage, &presentUnion, &presentPoliceStation,
					&nomineeName, &nomineeRelationship, &nomineeNID, &nomineePhone,
					&createdAt, &documentsJSON,
				); err != nil {
					continue
				}
				documents := []map[string]interface{}{}
				if len(documentsJSON) > 0 {
					if err := json.Unmarshal(documentsJSON, &documents); err != nil {
						documents = []map[string]interface{}{}
					}
				}
				dateOfBirthValue := ""
				if dateOfBirth != nil {
					dateOfBirthValue = dateOfBirth.Format(time.RFC3339)
				}
				registrations = append(registrations, map[string]interface{}{
					"id":            id,
					"accountNo":     regAccountNo,
					"name":          name,
					"nameBn":        nameBn,
					"email":         email,
					"phone":         phone,
					"nidNumber":     nid,
					"area":          area,
					"fatherName":    fatherName,
					"motherName":    motherName,
					"gender":        gender,
					"maritalStatus": maritalStatus,
					"bloodGroup":    bloodGroup,
					"profession":    profession,
					"childrenCount": childrenCount,
					"dateOfBirth":   dateOfBirthValue,
					"permanentAddress": map[string]interface{}{
						"houseNo":       permanentHouseNo,
						"roadNo":        permanentRoadNo,
						"village":       permanentVillage,
						"union":         permanentUnion,
						"policeStation": permanentPoliceStation,
						"district":      area,
					},
					"presentAddress": map[string]interface{}{
						"houseNo":       presentHouseNo,
						"roadNo":        presentRoadNo,
						"village":       presentVillage,
						"union":         presentUnion,
						"policeStation": presentPoliceStation,
						"district":      presentDistrict,
					},
					"nominee": map[string]interface{}{
						"name":         nomineeName,
						"relationship": nomineeRelationship,
						"nidNumber":    nomineeNID,
						"phone":        nomineePhone,
					},
					"requestDate": createdAt.Format(time.RFC3339),
					"documents":   documents,
				})
			}
			result["registrationRequests"] = registrations
		}
	}

	// Get pending loan requests
	const loanQuery = `
		SELECT
			l.id,
			COALESCE(u."accountNo", ''),
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			l."principalAmount"::bigint,
			COALESCE(a."savingsBalance", 0)::bigint,
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
		WHERE l.status = 'PENDING_APPROVAL'
		ORDER BY l."createdAt" DESC
	`
	loanRows, err := r.db.Query(ctx, loanQuery)
	if err == nil {
		defer loanRows.Close()
		// Derived per row; accounts.maxLoanAmount was never kept current.
		_, maxLoanMultiplier, _ := r.getLoanPolicy(ctx)
		loans := []map[string]interface{}{}
		for loanRows.Next() {
			var id, accountNo, memberName, memberNameBn, guarantorId, guarantorName, purpose, repaymentHistory string
			var amount, currentDeposit int64
			var createdAt time.Time
			var previousLoans int
			if err := loanRows.Scan(&id, &accountNo, &memberName, &memberNameBn, &amount, &currentDeposit,
				&guarantorId, &guarantorName, &purpose, &createdAt, &previousLoans, &repaymentHistory); err != nil {
				continue
			}
			maxEligible := money.MaxLoanAmount(currentDeposit, maxLoanMultiplier)
			loans = append(loans, map[string]interface{}{
				"id":                id,
				"accountNo":         accountNo,
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

	const transactionRequestQuery = `
		SELECT
			t.id,
			t.type::text,
			t.amount::bigint,
			t.status::text,
			t."createdAt",
			COALESCE(u."nameEn", ''),
			COALESCE(u."accountNo", ''),
			COALESCE(t."externalReference", ''),
			COALESCE(t.description, ''),
			COALESCE(l.id, '')
		FROM transactions t
		JOIN users u ON u.id = t."userId"
		LEFT JOIN loans l ON l.id = t."loanId"
		WHERE t.status = 'PENDING'
		  AND t.type IN ('WITHDRAWAL', 'DEPOSIT', 'LOAN_REPAYMENT')
		ORDER BY t."createdAt" DESC
	`
	requestRows, err := r.db.Query(ctx, transactionRequestQuery)
	if err == nil {
		defer requestRows.Close()
		requests := []map[string]interface{}{}
		for requestRows.Next() {
			var id, txType, status, memberName, memberID, reference, notes, loanID string
			var amount int64
			var createdAt time.Time
			if err := requestRows.Scan(&id, &txType, &amount, &status, &createdAt, &memberName, &memberID, &reference, &notes, &loanID); err != nil {
				continue
			}
			requests = append(requests, map[string]interface{}{
				"id":            id,
				"type":          strings.ToUpper(strings.TrimSpace(txType)),
				"amount":        amount,
				"status":        strings.ToUpper(strings.TrimSpace(status)),
				"member":        map[string]interface{}{"name": memberName, "accountNo": memberID},
				"requestDate":   createdAt.Format(time.RFC3339),
				"processedDate": createdAt.Format(time.RFC3339),
				"reference":     reference,
				"notes":         notes,
				"loanId":        loanID,
			})
		}
		result["transactionRequests"] = requests
		result["withdrawalRequests"] = requests
	}

	return result, nil
}

func (r *UserRepository) GetRegistrationApprovalCandidate(ctx context.Context, userID string) (*RegistrationApprovalCandidate, error) {
	const query = `
		SELECT
			u.id,
			COALESCE(u.email, ''),
			u.phone,
			COALESCE(u."nameEn", ''),
			u.role::text,
			u.status::text,
			COALESCE(u."accountNo", ''),
			COALESCE(u."preferredLocale", '')
		FROM users u
		WHERE u.id = $1
		LIMIT 1
	`

	var candidate RegistrationApprovalCandidate
	err := r.db.QueryRow(ctx, query, userID).Scan(
		&candidate.ID,
		&candidate.Email,
		&candidate.Phone,
		&candidate.NameEn,
		&candidate.Role,
		&candidate.Status,
		&candidate.AccountNo,
		&candidate.PreferredLocale,
	)
	if err != nil {
		return nil, err
	}

	if strings.ToUpper(strings.TrimSpace(candidate.Role)) != "MEMBER" {
		return nil, errors.New("user is not a member")
	}
	if strings.ToUpper(strings.TrimSpace(candidate.Status)) != "PENDING" {
		return nil, errors.New("user is not pending approval")
	}

	return &candidate, nil
}

// renameUser moves a user row to a new primary key, carrying references a
// foreign key does not: token_blacklist.userId and notifications.data->>'userId'.
// audit_logs is deliberately left alone (append-only); the audit screen
// resolves old rows through users.formNumber (ADR-044).
func renameUser(ctx context.Context, tx pgx.Tx, oldID, newID string) error {
	if oldID == newID {
		return nil
	}

	if _, err := tx.Exec(ctx,
		`UPDATE token_blacklist SET "userId" = $2 WHERE "userId" = $1`, oldID, newID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE notifications SET data = jsonb_set(data, '{userId}', to_jsonb($2::text))
		 WHERE data ? 'userId' AND data->>'userId' = $1`, oldID, newID); err != nil {
		return err
	}

	// Last, so the statements above still match the old value.
	if _, err := tx.Exec(ctx, `UPDATE users SET id = $2 WHERE id = $1`, oldID, newID); err != nil {
		return err
	}
	return nil
}

// ApproveRegistration admits a pending applicant, plants the first-login
// marker (secret hashed, WO-86) and RETURNS the account number it allocates.
// ErrBranchNotAssignable: a missing or closed branch — 400, not 500 (rule 2b).
var ErrBranchNotAssignable = errors.New("branch is not available for assignment")

func (r *UserRepository) ApproveRegistration(ctx context.Context, userID, approverID, notes, passwordHash, firstLoginSecret, branchID string) (string, error) {
	if strings.TrimSpace(passwordHash) == "" {
		return "", errors.New("password hash is required")
	}
	if strings.TrimSpace(firstLoginSecret) == "" {
		return "", errors.New("first login secret is required")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var email, phone, memberID, role, status string
	err = tx.QueryRow(ctx, `
		SELECT
			COALESCE(email, ''),
			phone,
			COALESCE("accountNo", ''),
			role::text,
			status::text
		FROM users
		WHERE id = $1
		FOR UPDATE
	`, userID).Scan(&email, &phone, &memberID, &role, &status)
	if err != nil {
		return "", err
	}

	if strings.ToUpper(strings.TrimSpace(role)) != "MEMBER" {
		return "", errors.New("user is not a member")
	}
	if strings.ToUpper(strings.TrimSpace(status)) != "PENDING" {
		return "", errors.New("user is not pending approval")
	}

	const updateQuery = `
		UPDATE users
		SET
			status = 'ACTIVE',
			"approvedAt" = NOW(),
			"approvedBy" = $2,
			"passwordHash" = $3,
			"updatedAt" = NOW()
		WHERE id = $1 AND role = 'MEMBER' AND status = 'PENDING'
	`
	result, err := tx.Exec(ctx, updateQuery, userID, approverID, passwordHash)
	if err != nil {
		return "", err
	}
	if result.RowsAffected() != 1 {
		return "", errors.New("registration approval update failed")
	}

	// The ONLY place an account number is allocated — so a refused
	// application never burns one (ADR-039). formNumber is NOT touched: it
	// names the applicant's document folder. An existing number is kept (ADR-023).
	if strings.TrimSpace(memberID) == "" {
		generatedMemberID, err := r.generateNextAccountNo(ctx, tx)
		if err != nil {
			return "", err
		}
		memberID = generatedMemberID
		if _, err := tx.Exec(ctx, `UPDATE users SET "accountNo" = $2, "updatedAt" = NOW() WHERE id = $1`, userID, memberID); err != nil {
			return "", err
		}

		// And the row's id, which IS the account number (ADR-043). Safe here:
		// an applicant has never signed in. FKs cascade; renameUser remaps the rest.
		if err := renameUser(ctx, tx, userID, memberID); err != nil {
			return "", err
		}
		userID = memberID
	}

	// The member's office, chosen by the admitting admin. Empty means "not
	// yet"; a named branch must exist and be active.
	if branchID = strings.TrimSpace(branchID); branchID != "" {
		var active bool
		if err := tx.QueryRow(ctx, `SELECT "isActive" FROM branches WHERE id = $1`, branchID).Scan(&active); err != nil {
			return "", ErrBranchNotAssignable
		}
		if !active {
			return "", ErrBranchNotAssignable
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET "assignedBranchId" = $2, "updatedAt" = NOW() WHERE id = $1`, userID, branchID); err != nil {
			return "", err
		}
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM password_reset_tokens
		WHERE scope = $3
		  AND "usedAt" IS NULL
		  AND (("email" = $1 AND $1 <> '') OR "phone" = $2)
	`, email, phone, ResetScopeFirstLogin); err != nil {
		return "", err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO password_reset_tokens (id, scope, "tokenHash", email, phone, "expiresAt", "createdAt")
		VALUES (gen_random_uuid()::text, $4, $1, NULLIF($2, ''), $3, NOW() + INTERVAL '365 days', NOW())
	`, hashResetSecret(firstLoginSecret), email, phone, ResetScopeFirstLogin); err != nil {
		return "", err
	}

	var accountExists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE "userId" = $1)`, userID).Scan(&accountExists)
	if err != nil {
		return "", err
	}

	if !accountExists {
		// No `id`: the account's key IS its owner's number (ADR-044).
		const createAccountQuery = `
			INSERT INTO accounts ("savingsBalance", "loanBalance", "createdAt", "updatedAt", "userId")
			VALUES (0, 0, NOW(), NOW(), $1)
		`
		if _, err := tx.Exec(ctx, createAccountQuery, userID); err != nil {
			return "", err
		}
	}
	// Wording lives in internal/notify (WO-52).
	memberTitle, memberMessage := notify.RegistrationApproved()
	if _, err := tx.Exec(ctx, `
		INSERT INTO notifications (type, title, message, "targetUserId", "createdAt")
		VALUES ('ACCOUNT_ACTIVATED', $2, $3, $1, NOW())
	`, userID, memberTitle, memberMessage); err != nil {
		return "", err
	}
	staffTitle, staffMessage := notify.RegistrationApprovedForStaff()
	if _, err := tx.Exec(ctx, `
		INSERT INTO notifications (type, title, message, "targetRole", "createdAt")
		VALUES ('NEW_REGISTRATION', $1, $2, 'WORKER', NOW())
	`, staffTitle, staffMessage); err != nil {
		return "", err
	}

	// Audit row inside the transaction: approval and record commit together (FR-19).
	const auditQuery = `
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES ('APPROVE_REGISTRATION', 'USER', $1, $2, NOW(), $3)
	`
	if _, err := tx.Exec(ctx, auditQuery, userID, approverID, notes); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return memberID, nil
}

// ErrRegistrationNotPending: already decided, already a member, or missing (rule 2b).
var ErrRegistrationNotPending = errors.New("registration is not pending")

// RejectedApplicant is what the caller needs to tell the applicant; contact
// details survive a rejection (uniqueness is scoped to live rows).
type RejectedApplicant struct {
	Email  string
	NameEn string
	Locale string
}

// RejectRegistration turns down a pending application. The reason is stored
// on the row too, since no screen reads audit_logs (FR-05).
func (r *UserRepository) RejectRegistration(ctx context.Context, userID, approverID, reasonCode, reasonNote string) (*RejectedApplicant, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Contact details are read back via RETURNING, not overwritten.
	const updateQuery = `
		UPDATE users
		SET
			status = 'INACTIVE',
			"rejectionReasonCode" = $2,
			"rejectionReasonNote" = NULLIF(btrim($3), ''),
			"rejectedAt" = NOW(),
			"approvedBy" = $4,
			"updatedAt" = NOW()
		WHERE id = $1 AND role = 'MEMBER' AND status = 'PENDING'
		RETURNING COALESCE(email, ''), "nameEn", COALESCE("preferredLocale", '')
	`

	var applicant RejectedApplicant
	err = tx.QueryRow(ctx, updateQuery, userID, reasonCode, reasonNote, approverID).
		Scan(&applicant.Email, &applicant.NameEn, &applicant.Locale)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRegistrationNotPending
		}
		return nil, err
	}

	// Audit row inside the transaction (FR-19).
	const auditQuery = `
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES ('REJECT_REGISTRATION', 'USER', $1, $2, NOW(), $3)
	`
	auditDetails := strings.TrimSpace(reasonCode)
	if note := strings.TrimSpace(reasonNote); note != "" {
		auditDetails = strings.TrimSpace(auditDetails + " — " + note)
	}
	if _, err := tx.Exec(ctx, auditQuery, userID, approverID, auditDetails); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &applicant, nil
}

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
			COALESCE(u."accountNo", ''),
			u."createdAt"
		FROM users u
		WHERE u.id = $1
	`

	var id, nameEn, nameBn, email, phone, role, status, avatarUrl, accountNo string
	var createdAt time.Time

	if err := r.db.QueryRow(ctx, query, userID).Scan(
		&id, &nameEn, &nameBn, &email, &phone, &role, &status, &avatarUrl, &accountNo, &createdAt); err != nil {
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
		"accountNo": accountNo,
		"joinedAt":  createdAt.Format(time.RFC3339),
	}, nil
}
