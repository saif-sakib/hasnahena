package repositories

// Administration: the admin dashboard, the member list, and the registration
// approval and rejection paths.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type RegistrationApprovalCandidate struct {
	ID       string
	Email    string
	Phone    string
	NameEn   string
	Role     string
	Status   string
	MemberID string
}

func (r *UserRepository) GetMembersList(ctx context.Context, includeAdmins bool) ([]map[string]interface{}, error) {
	roleFilter := "u.role = 'MEMBER'"
	if includeAdmins {
		roleFilter = "u.role IN ('WORKER', 'ADMIN')"
	}
	query := `
		SELECT
			u.id::text,
			COALESCE(u."memberId", '') AS member_id,
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
		var id, memberIDValue, name, email, phone, nid, status, area, role string
		var createdAt time.Time
		var savingsBalance, activeLoan int64
		if scanErr := rows.Scan(&id, &memberIDValue, &name, &email, &phone, &nid, &status, &createdAt, &savingsBalance, &activeLoan, &area, &role); scanErr != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":              id,
			"uid":             memberIDValue,
			"memberId":        memberIDValue,
			"name":            name,
			"email":           email,
			"phone":           phone,
			"nidNumber":       nid,
			"status":          strings.ToUpper(status),
			"joinDate":        createdAt.Format(time.RFC3339),
			"currentDeposit":  savingsBalance,
			"activeLoan":      activeLoan,
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
			COALESCE(u."memberId", ''),
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
						'id', d.id,
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
		LEFT JOIN addresses a ON a."userPermanentId" = u.id
		LEFT JOIN addresses pa ON pa.id = u."presentAddressId"
		LEFT JOIN nominees n ON n."userId" = u.id
		WHERE u.status = 'PENDING' AND u.role = 'MEMBER'
		ORDER BY u."createdAt" DESC
	`
		regRows, err := r.db.Query(ctx, regQuery)
		if err == nil {
			defer regRows.Close()
			registrations := []map[string]interface{}{}
			for regRows.Next() {
				var id, regMemberID, name, nameBn, email, phone, nid, fatherName, motherName, gender, maritalStatus, bloodGroup, profession, area string
				var permanentHouseNo, permanentRoadNo, permanentVillage, permanentUnion, permanentPoliceStation string
				var presentDistrict, presentHouseNo, presentRoadNo, presentVillage, presentUnion, presentPoliceStation string
				var nomineeName, nomineeRelationship, nomineeNID, nomineePhone string
				var childrenCount int
				var dateOfBirth *time.Time
				var createdAt time.Time
				var documentsJSON []byte
				if err := regRows.Scan(
					&id, &regMemberID, &name, &nameBn, &email, &phone, &nid,
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
					"memberId":      regMemberID,
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
		WHERE l.status = 'PENDING_APPROVAL'
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

	const transactionRequestQuery = `
		SELECT
			t.id,
			t.type::text,
			t.amount::bigint,
			t.status::text,
			t."createdAt",
			COALESCE(u."nameEn", ''),
			COALESCE(u."memberId", ''),
			COALESCE(t."receiptNumber", ''),
			COALESCE(t.description, ''),
			COALESCE(l."loanNumber", '')
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
			var id, txType, status, memberName, memberID, reference, notes, loanNumber string
			var amount int64
			var createdAt time.Time
			if err := requestRows.Scan(&id, &txType, &amount, &status, &createdAt, &memberName, &memberID, &reference, &notes, &loanNumber); err != nil {
				continue
			}
			requests = append(requests, map[string]interface{}{
				"id":            id,
				"type":          strings.ToUpper(strings.TrimSpace(txType)),
				"amount":        amount,
				"status":        strings.ToUpper(strings.TrimSpace(status)),
				"member":        map[string]interface{}{"name": memberName, "memberId": memberID},
				"requestDate":   createdAt.Format(time.RFC3339),
				"processedDate": createdAt.Format(time.RFC3339),
				"reference":     reference,
				"notes":         notes,
				"loanNumber":    loanNumber,
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
			COALESCE(u."memberId", '')
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
		&candidate.MemberID,
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

func (r *UserRepository) ApproveRegistration(ctx context.Context, userID, approverID, notes, passwordHash, firstLoginToken string) error {
	if strings.TrimSpace(passwordHash) == "" {
		return errors.New("password hash is required")
	}
	if !strings.HasPrefix(strings.TrimSpace(firstLoginToken), "first-login-") {
		return errors.New("invalid first login token")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var email, phone, memberID, role, status string
	err = tx.QueryRow(ctx, `
		SELECT
			COALESCE(email, ''),
			phone,
			COALESCE("memberId", ''),
			role::text,
			status::text
		FROM users
		WHERE id = $1
		FOR UPDATE
	`, userID).Scan(&email, &phone, &memberID, &role, &status)
	if err != nil {
		return err
	}

	if strings.ToUpper(strings.TrimSpace(role)) != "MEMBER" {
		return errors.New("user is not a member")
	}
	if strings.ToUpper(strings.TrimSpace(status)) != "PENDING" {
		return errors.New("user is not pending approval")
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
		return err
	}
	if result.RowsAffected() != 1 {
		return errors.New("registration approval update failed")
	}

	if strings.TrimSpace(memberID) == "" {
		generatedMemberID, err := r.generateNextMemberID(ctx, tx)
		if err != nil {
			return err
		}
		memberID = generatedMemberID
		if _, err := tx.Exec(ctx, `UPDATE users SET "memberId" = $2, "formNumber" = $3, "updatedAt" = NOW() WHERE id = $1`, userID, memberID, fmt.Sprintf("FORM-%s", memberID)); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM password_reset_tokens
		WHERE token LIKE 'first-login-%'
		  AND "usedAt" IS NULL
		  AND (("email" = $1 AND $1 <> '') OR "phone" = $2)
	`, email, phone); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO password_reset_tokens (id, token, email, phone, "expiresAt", "createdAt")
		VALUES (gen_random_uuid()::text, $1, NULLIF($2, ''), $3, NOW() + INTERVAL '365 days', NOW())
	`, firstLoginToken, email, phone); err != nil {
		return err
	}

	var accountExists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE "userId" = $1)`, userID).Scan(&accountExists)
	if err != nil {
		return err
	}

	if !accountExists {
		const createAccountQuery = `
			INSERT INTO accounts (id, "accountNumber", "savingsBalance", "loanBalance", "isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
			VALUES (gen_random_uuid()::text, $2, 0, 0, true, 0, NOW(), NOW(), $1)
		`
		if _, err := tx.Exec(ctx, createAccountQuery, userID, memberID); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, `UPDATE accounts SET "accountNumber" = $2, "updatedAt" = NOW() WHERE "userId" = $1`, userID, memberID); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO notifications (id, type, title, message, "targetUserId", "createdAt")
		VALUES (gen_random_uuid()::text, 'ACCOUNT_ACTIVATED', 'Account Approved', 'Your membership has been approved. Please log in and change your password.', $1, NOW())
	`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notifications (id, type, title, message, "targetRole", "createdAt")
		VALUES (gen_random_uuid()::text, 'NEW_REGISTRATION', 'Daily task update', 'A member registration has been approved and is now active.', 'WORKER', NOW())
	`); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'APPROVE_REGISTRATION', 'USER', $1, $2, NOW(), $3)
	`
	_, _ = r.db.Exec(ctx, auditQuery, userID, approverID, notes)

	return nil
}

func (r *UserRepository) RejectRegistration(ctx context.Context, userID, approverID, reason string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Mark registration as rejected and archive unique contact fields so the applicant can re-register.
	const updateQuery = `
		UPDATE users
		SET
			status = 'INACTIVE',
			email = CASE
				WHEN email IS NULL OR btrim(email) = '' THEN NULL
				ELSE CONCAT('rejected+', id, '@hasnahena.local')
			END,
			phone = CONCAT('rejected-', id),
			"updatedAt" = NOW()
		WHERE id = $1 AND role = 'MEMBER' AND status = 'PENDING'
	`
	updateResult, err := tx.Exec(ctx, updateQuery, userID)
	if err != nil {
		return err
	}
	if updateResult.RowsAffected() == 0 {
		return errors.New("registration not found")
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Write audit log after commit so audit failures never poison the rejection transaction.
	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'REJECT_REGISTRATION', 'USER', $1, $2, NOW(), $3)
	`
	_, _ = r.db.Exec(ctx, auditQuery, userID, approverID, reason)

	return nil
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
