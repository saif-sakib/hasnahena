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
	// The language the applicant filled the form in. The approval email used to
	// be sent in the *admin's* dashboard language, so a Bengali applicant
	// approved by an admin working in English received the one email carrying
	// their temporary password in a language they may not read.
	//
	// Empty for anyone who registered before 2026-08-26, who fall back to the
	// admin's locale as before rather than being guessed at.
	PreferredLocale string
}

// GetMembersList returns either the members or the field workers.
//
// `staffOnly` returns **workers**, and only workers. It used to return
// `('WORKER', 'ADMIN')`, which put admin rows on the Workers screen — a list
// whose whole purpose is the accounts an admin creates, edits, suspends and
// deletes. None of those apply to an admin: the API refuses every one of them
// on a non-worker target, and an admin account is made directly in the database
// (see `app/api/v1/admin/workers/route.ts`). So the rows were unactionable, and
// a list of things you cannot do anything about reads as a list of things that
// are broken. SUPER_ADMIN was never in it either, so "who has the keys" was
// never what this answered.
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
			-- WO-72. Three different things were being called "area" here: this
			-- district (which is what the staff list actually displayed), the
			-- free-text users."assignedBranch" that only the Next create/update
			-- responses ever read, and a branches table nothing touched at all.
			-- The branch is now a row, and it is returned as one.
			-- The id IS the code since 2026-08-27: branches carried both, which
			-- was one fact in two required unique columns. Both fields are still
			-- returned because the response shape has two and callers read each.
			COALESCE(b.id::text, ''),
			COALESCE(b.name, ''),
			COALESCE(b.id::text, '')
		FROM users u
		LEFT JOIN accounts a ON a."userId" = u.id
		LEFT JOIN addresses addr ON addr."userPermanentId" = u.id
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
			// `area` stays the permanent-address district, which is what it has
			// always been and is the useful column for a member. `branch` is the
			// staff member's assigned office and is null for members.
			"branch":          branch,
			"address":         area,
			"lastActive":      createdAt.Format(time.RFC3339),
			"lastTransaction": createdAt.Format(time.RFC3339),
		})
	}
	return result, nil
}

func (r *UserRepository) GetAdminDashboard(ctx context.Context) (map[string]interface{}, error) {
	// Every figure here is also shown on the worker's dashboard, on the loans
	// screen or on the workers screen, and four of them used to be counted
	// differently in each place — the same afternoon reading "Total Members 41"
	// in one dashboard and "38" in the other, with nothing to say which was
	// right. The definitions below are the ones those screens use.
	query := `
		SELECT
			-- ACTIVE, as the worker's dashboard counts it. A PENDING registration
			-- is an application, not a member.
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND status = 'ACTIVE'), 0)::bigint,
			-- WORKER only, matching the Workers screen. Admin accounts are made in
			-- the database and are not listed there, so counting them here made
			-- the tally disagree with the list underneath it.
			COALESCE((SELECT COUNT(*) FROM users WHERE role = 'WORKER'), 0)::bigint,
			-- Rule 6a: a PENDING deposit is a *request*. Summing it reported money
			-- nobody has handed over yet as income (ADR-016), and the worker's own
			-- "today's deposits" filtered on CONFIRMED while this did not.
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'DEPOSIT' AND status = 'CONFIRMED'), 0)::bigint,
			-- "Loans Disbursed": money that actually left. This summed every row,
			-- so a REJECTED application and one still awaiting a guarantor counted
			-- as lending — and the loans screen's own total, over exactly these
			-- four statuses, disagreed with it.
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
		LEFT JOIN addresses pa ON pa."userPresentId" = u.id
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
		// Derived per row rather than selected. The column this replaced
		// (`accounts.maxLoanAmount`) was never updated after account creation, so
		// every pending request on this screen carried `maxEligible: 0` — see the
		// note in member_repository.GetMemberDashboardData.
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
				"member":        map[string]interface{}{"name": memberName, "accountNo": memberID},
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

// renameUser moves a user row to a new primary key and carries with it every
// reference that a foreign key does not.
//
// Two of those are rewritten here — `token_blacklist.userId` and
// `notifications.data->>'userId'`. The other two are `audit_logs.entityId` and
// `audit_logs.performedBy`, and they are **deliberately left alone**: that table
// is append-only at the database level (DATA-08) and its trigger refuses UPDATE
// unconditionally, with an escape hatch that covers DELETE only.
//
// That refusal is correct and is not worked around. An audit row saying who the
// subject was called at the time is the more truthful record, and rewriting
// history so it agrees with the present is the exact thing the trigger exists to
// stop. `user_id_history` is how the audit reader gets from the old name to the
// person instead.
//
// The self-referential `users.approvedBy` needs no special handling, because its
// own FK cascades and this renames one row rather than the table.
func renameUser(ctx context.Context, tx pgx.Tx, oldID, newID string) error {
	if oldID == newID {
		return nil
	}

	// One hop, never a chain. If something already maps to the id being
	// retired, it is re-pointed at the new one in the same breath, so a reader
	// never has to walk a sequence of renames.
	if _, err := tx.Exec(ctx,
		`UPDATE user_id_history SET "newId" = $2, "changedAt" = NOW() WHERE "newId" = $1`,
		oldID, newID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO user_id_history ("oldId", "newId", "changedAt") VALUES ($1, $2, NOW())
		 ON CONFLICT ("oldId") DO UPDATE SET "newId" = EXCLUDED."newId", "changedAt" = NOW()`,
		oldID, newID); err != nil {
		return err
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

	// Last, so the statements above still match on the value they were written
	// with. The cascade fires from here.
	if _, err := tx.Exec(ctx, `UPDATE users SET id = $2 WHERE id = $1`, oldID, newID); err != nil {
		return err
	}
	return nil
}

// ApproveRegistration activates a pending member and plants the first-login
// marker whose existence is `mustChangePassword`.
//
// firstLoginSecret is the raw secret; it is hashed on the way in like every
// other row of password_reset_tokens (WO-86). It used to arrive carrying a
// "first-login-" prefix that this function validated and stored verbatim — the
// prefix is a `scope` column now, so there is nothing left to validate beyond
// the secret being present.
// ApproveRegistration admits a pending applicant and **returns the account
// number they have just been given**.
//
// Returned rather than read back by the caller, because the caller reads the
// candidate row *before* this runs: `accountNo` is null on an application and is
// allocated here, so a handler that fetched it beforehand would put an empty
// string into the one email that tells a member their number.
// ErrBranchNotAssignable is an expected refusal, not a fault (rule 2b): the admin
// named an office that does not exist or has been closed. It reaches the caller
// as a 400 naming the branch, rather than a 500 naming a foreign key.
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

	// **This is where a member's account number comes from, and the only place.**
	//
	// It used to be allocated by the registration route the moment a public form
	// was submitted, so refusing the first applicant consumed `ACC-KH-33001` for
	// ever and the next applicant became `002` — a hole in the foundation's own
	// register, punched by a form anybody can fill in. The applicant's reference
	// is their `formNumber` (`APP-2026-000001`), which is allocated at submission
	// and costs nothing to burn.
	//
	// `formNumber` is deliberately NOT touched here. It used to be overwritten
	// with `FORM-<accountNo>`, which destroyed the number the applicant had been
	// given, was quoting on the telephone, and whose value names the Cloudinary
	// folder holding their four identity documents.
	//
	// The empty check stays rather than becoming unconditional: re-approving is
	// refused above, but if a row somehow already has a number it keeps it —
	// renumbering a member would orphan their files and break the one identifier
	// they were told to write down (ADR-023).
	if strings.TrimSpace(memberID) == "" {
		generatedMemberID, err := r.generateNextAccountNo(ctx, tx)
		if err != nil {
			return "", err
		}
		memberID = generatedMemberID
		if _, err := tx.Exec(ctx, `UPDATE users SET "accountNo" = $2, "updatedAt" = NOW() WHERE id = $1`, userID, memberID); err != nil {
			return "", err
		}

		// **And the row's id, which IS the account number** (ADR-043).
		//
		// This is the one moment in a member's life that their id changes, and
		// it is deliberately this moment: until now they are an applicant known
		// by `APP-2026-000001`, and nothing outside this database holds that
		// value. An applicant's password hash is a sentinel bcrypt can never
		// match, so they have never signed in — there is no token carrying the
		// old id, no session to break, and no third party to tell.
		//
		// Every foreign key referencing `users.id` is ON UPDATE CASCADE, so the
		// account, the addresses, the nominee and the documents follow in the
		// same statement. The four columns that hold a user id *without* a
		// foreign key are remapped by hand below — miss one and the audit trail
		// silently loses the rows describing this person's own application,
		// which is the trail's whole subject at this point.
		if err := renameUser(ctx, tx, userID, memberID); err != nil {
			return "", err
		}
		userID = memberID
	}

	// **Which office this member belongs to, decided by the admin admitting them.**
	//
	// Registration used to set it: the public form assigned the sole active
	// branch and left it null once a second office existed, so a member's office
	// was either a guess or nothing, and neither was anybody's decision. It is
	// asked for on the approvals screen now, beside the approval itself, because
	// that is the moment somebody who knows the answer is looking at the
	// application.
	//
	// Empty is allowed and means "not yet" — a legitimate, visible state that the
	// member list already renders as a dash. A named branch must exist and be
	// active: assigning somebody to a closed office is a per-branch report that
	// is quietly wrong rather than an error anybody sees.
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
		const createAccountQuery = `
			INSERT INTO accounts (id, "savingsBalance", "loanBalance", "createdAt", "updatedAt", "userId")
			VALUES (gen_random_uuid()::text, 0, 0, NOW(), NOW(), $1)
		`
		if _, err := tx.Exec(ctx, createAccountQuery, userID); err != nil {
			return "", err
		}
	}
	// Nothing to re-sync when the account already exists. It used to carry an
	// "accountNumber" that had to be kept equal to the member id — two columns
	// holding one value, which is the redundancy ADR-023 removed.

	// Parameterised rather than inlined in the SQL so the wording lives with
	// every other notification in internal/notify and is covered by its census
	// (WO-52). A string only the database sees is a string nothing tests.
	memberTitle, memberMessage := notify.RegistrationApproved()
	if _, err := tx.Exec(ctx, `
		INSERT INTO notifications (id, type, title, message, "targetUserId", "createdAt")
		VALUES (gen_random_uuid()::text, 'ACCOUNT_ACTIVATED', $2, $3, $1, NOW())
	`, userID, memberTitle, memberMessage); err != nil {
		return "", err
	}
	staffTitle, staffMessage := notify.RegistrationApprovedForStaff()
	if _, err := tx.Exec(ctx, `
		INSERT INTO notifications (id, type, title, message, "targetRole", "createdAt")
		VALUES (gen_random_uuid()::text, 'NEW_REGISTRATION', $1, $2, 'WORKER', NOW())
	`, staffTitle, staffMessage); err != nil {
		return "", err
	}

	// Inside the transaction, and checked.
	//
	// This used to run after the commit as `_, _ = r.db.Exec(...)`, so an
	// approval could succeed with no record of who granted it. Admitting a
	// member is exactly the kind of material action FR-19 exists for, and the
	// audit row is what an investigation starts from. Written here, the
	// approval and its record commit together or neither does.
	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'APPROVE_REGISTRATION', 'USER', $1, $2, NOW(), $3)
	`
	if _, err := tx.Exec(ctx, auditQuery, userID, approverID, notes); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return memberID, nil
}

// ErrRegistrationNotPending is returned when the row named is not a pending
// application — already decided, already a member, or not there at all.
//
// A sentinel rather than a message the handler greps for. This used to return
// errors.New("registration not found") and the handler matched it with
// strings.Contains(err.Error(), "not found"), which is the classification rule
// 2b bans: every future error whose text happens to contain those words becomes
// a 404, and rewording this one makes it a 500.
var ErrRegistrationNotPending = errors.New("registration is not pending")

// RejectedApplicant is what the caller needs in order to tell the applicant.
//
// Returned *because* the rejection no longer destroys it. Until 2026-08-26 this
// function overwrote the email and phone in the same statement that recorded the
// decision, to free the unique constraint for a re-application — so the
// foundation held an application it had turned down and no address to explain it
// to, and nothing else in the entry path told the applicant either. Uniqueness
// is scoped to live rows now, so the details can simply stay.
type RejectedApplicant struct {
	Email  string
	NameEn string
	Locale string
}

// RejectRegistration turns down a pending application, recording why.
//
// The reason is stored on the row as well as in the audit log. `audit_logs` is
// append-only and no screen can read it, so a reason written only there is one
// nobody can show the applicant or the next admin to open the application —
// which is what "reject with reason" (FR-05) has to mean to be worth anything.
func (r *UserRepository) RejectRegistration(ctx context.Context, userID, approverID, reasonCode, reasonNote string) (*RejectedApplicant, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// The contact details are read back, not overwritten. RETURNING rather than
	// a second SELECT, so the row is read by the statement that changes it.
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

	// Inside the transaction, unlike the version this replaces.
	//
	// The audit row used to be written after the commit with its error
	// discarded (`_, _ = r.db.Exec(...)`), so a rejection could commit leaving
	// no record of who made it or why. FR-19 asks for an append-only log of
	// every material action, and refusing somebody membership is material.
	// Written here, the decision and its record commit together or neither does.
	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'REJECT_REGISTRATION', 'USER', $1, $2, NOW(), $3)
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
