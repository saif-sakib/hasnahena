package repositories

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"hasnahena/apps/api/internal/models"
)

type UserRepository struct {
	db *pgxpool.Pool
}

type RegistrationApprovalCandidate struct {
	ID       string
	Email    string
	Phone    string
	NameEn   string
	Role     string
	Status   string
	MemberID string
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
	ID          string                 `json:"id"`
	Type        string                 `json:"type,omitempty"`
	Title       string                 `json:"title"`
	Message     string                 `json:"message,omitempty"`
	Description string                 `json:"description"`
	Time        string                 `json:"time"`
	Read        bool                   `json:"read"`
	Data        map[string]interface{} `json:"data,omitempty"`
}

type SupportThread struct {
	ID               string `json:"id"`
	MemberUserID     string `json:"memberUserId"`
	MemberName       string `json:"memberName"`
	MemberUid        string `json:"memberUid"`
	MemberPhone      string `json:"memberPhone"`
	Status           string `json:"status"`
	LatestMessage    string `json:"latestMessage"`
	LatestSenderRole string `json:"latestSenderRole"`
	LatestAt         string `json:"latestAt"`
	UpdatedAt        string `json:"updatedAt"`
	DeleteAt         string `json:"deleteAt"`
	ProcessedBy      string `json:"processedBy"`
	ProcessedAt      string `json:"processedAt"`
	IsProcessed      bool   `json:"isProcessed"`
}

type SupportMessage struct {
	ID         string `json:"id"`
	ThreadID   string `json:"threadId"`
	SenderID   string `json:"senderId"`
	SenderUid  string `json:"senderUid"`
	SenderName string `json:"senderName"`
	SenderRole string `json:"senderRole"`
	Message    string `json:"message"`
	CreatedAt  string `json:"createdAt"`
}

func NewUserRepository(db *pgxpool.Pool) *UserRepository {
	return &UserRepository{db: db}
}

func normalizedRolePtr(role string) *string {
	normalized := strings.ToUpper(strings.TrimSpace(role))
	if normalized == "" {
		return nil
	}
	return &normalized
}

func (r *UserRepository) insertNotificationTx(
	ctx context.Context,
	tx pgx.Tx,
	notificationType string,
	title string,
	message string,
	targetUserID *string,
	targetRole *string,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO notifications (id, type, title, message, "targetUserId", "targetRole", "createdAt")
		VALUES (gen_random_uuid()::text, $1::"NotificationType", $2, $3, $4, $5::"UserRole", NOW())
	`, notificationType, title, message, targetUserID, targetRole)
	return err
}

func newID(prefix string) (string, error) {
	b := make([]byte, 10)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(b)), nil
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
			"nameEn",
			EXISTS(
				SELECT 1
				FROM password_reset_tokens prt
				WHERE (prt.email = users.email OR prt.phone = users.phone)
				  AND prt.token LIKE 'first-login-%'
				  AND prt."usedAt" IS NULL
				  AND prt."expiresAt" > NOW()
			) AS must_change_password
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
		&user.MustChangePassword,
	)
	if err != nil {
		return nil, err
	}

	return &user, nil
}

func (r *UserRepository) GetUserRoleStatus(ctx context.Context, userID string) (string, string, error) {
	var role string
	var status string
	err := r.db.QueryRow(ctx, `
		SELECT role::text, status::text
		FROM users
		WHERE id = $1
		LIMIT 1
	`, userID).Scan(&role, &status)
	if err != nil {
		return "", "", err
	}
	return strings.ToUpper(strings.TrimSpace(role)), strings.ToUpper(strings.TrimSpace(status)), nil
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
	stats.CurrentBalance = stats.CurrentBalance / 100
	stats.TotalDeposited = stats.TotalDeposited / 100
	stats.LoanBalance = stats.LoanBalance / 100
	stats.LoanEligibility = stats.LoanEligibility / 100
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
			item.Amount = item.Amount / 100
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
			item.LoanAmount = item.LoanAmount / 100
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
		activeLoan.RemainingAmount = activeLoan.RemainingAmount / 100
		activeLoan.NextInstallment = activeLoan.NextInstallment / 100
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
			tx.Amount = tx.Amount / 100
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

func (r *UserRepository) GetSupportRetentionDays(ctx context.Context) (int, error) {
	const query = `
		SELECT value
		FROM system_config
		WHERE key = 'support.chatRetentionDays'
		LIMIT 1
	`
	var raw string
	if err := r.db.QueryRow(ctx, query).Scan(&raw); err != nil {
		return 10, nil
	}
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return 10, nil
	}
	return value, nil
}

func (r *UserRepository) SetSupportRetentionDays(ctx context.Context, days int) error {
	if days < 1 {
		return errors.New("retention days must be at least 1")
	}
	id, err := newID("cfg")
	if err != nil {
		return err
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		INSERT INTO system_config (id, key, value, "updatedAt")
		VALUES ($1, 'support.chatRetentionDays', $2, NOW())
		ON CONFLICT (key)
		DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
	`, id, strconv.Itoa(days)); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE support_threads st
		SET "deleteAt" = COALESCE((
			SELECT MAX(sm."createdAt")
			FROM support_messages sm
			WHERE sm."threadId" = st.id
		), st."updatedAt") + make_interval(days => $1::int)
	`, days); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (r *UserRepository) EnsureSupportSchema(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS support_threads (
			id TEXT PRIMARY KEY,
			"memberUserId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status TEXT NOT NULL DEFAULT 'OPEN',
			"processedByUserId" TEXT,
			"processedAt" TIMESTAMP NULL,
			"deleteAt" TIMESTAMP NOT NULL,
			"createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
			"updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS support_messages (
			id TEXT PRIMARY KEY,
			"threadId" TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
			"senderUserId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			message TEXT NOT NULL,
			"createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_support_threads_member ON support_threads("memberUserId")`,
		`CREATE INDEX IF NOT EXISTS idx_support_threads_status_updated ON support_threads(status, "updatedAt" DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_support_threads_delete_at ON support_threads("deleteAt")`,
		`CREATE INDEX IF NOT EXISTS idx_support_messages_thread_created ON support_messages("threadId", "createdAt" ASC)`,
		// Additional index for faster latest message lookups (covering index)
		`CREATE INDEX IF NOT EXISTS idx_support_messages_thread_created_desc ON support_messages("threadId", "createdAt" DESC) INCLUDE (message, "senderUserId")`,
		`INSERT INTO system_config (id, key, value, "updatedAt")
		 VALUES ('support_chat_retention_' || substring(md5(random()::text), 1, 12), 'support.chatRetentionDays', '10', NOW())
		 ON CONFLICT (key) DO NOTHING`,
	}
	for _, stmt := range statements {
		if _, err := r.db.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func (r *UserRepository) PurgeExpiredSupportData(ctx context.Context) error {
	retentionDays, _ := r.GetSupportRetentionDays(ctx)
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DELETE FROM support_messages
		WHERE "createdAt" <= NOW() - make_interval(days => $1::int)
	`, retentionDays); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE support_threads st
		SET
			"updatedAt" = COALESCE((
				SELECT MAX(sm."createdAt")
				FROM support_messages sm
				WHERE sm."threadId" = st.id
			), st."updatedAt"),
			"deleteAt" = COALESCE((
				SELECT MAX(sm."createdAt")
				FROM support_messages sm
				WHERE sm."threadId" = st.id
			), st."updatedAt") + make_interval(days => $1::int)
	`, retentionDays); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (r *UserRepository) ensureMemberSupportThread(ctx context.Context, memberUserID string) (string, error) {
	const getQuery = `
		SELECT id
		FROM support_threads
		WHERE "memberUserId" = $1
		ORDER BY "updatedAt" DESC
		LIMIT 1
	`
	var existingID string
	if err := r.db.QueryRow(ctx, getQuery, memberUserID).Scan(&existingID); err == nil {
		return existingID, nil
	}

	retentionDays, _ := r.GetSupportRetentionDays(ctx)
	threadID, err := newID("sup_thread")
	if err != nil {
		return "", err
	}
	_, err = r.db.Exec(ctx, `
		INSERT INTO support_threads (id, "memberUserId", status, "deleteAt", "createdAt", "updatedAt")
		VALUES ($1, $2, 'OPEN', NOW() + make_interval(days => $3::int), NOW(), NOW())
	`, threadID, memberUserID, retentionDays)
	if err != nil {
		return "", err
	}
	return threadID, nil
}

func (r *UserRepository) AddSupportMessage(
	ctx context.Context,
	actorUserID string,
	actorRole string,
	threadID string,
	message string,
) (string, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return "", errors.New("message is required")
	}

	role := strings.ToUpper(strings.TrimSpace(actorRole))

	if role == "MEMBER" {
		var err error
		threadID, err = r.ensureMemberSupportThread(ctx, actorUserID)
		if err != nil {
			return "", err
		}
	} else {
		if strings.TrimSpace(threadID) == "" {
			return "", errors.New("threadId is required")
		}
		var existingMemberID string
		if err := r.db.QueryRow(ctx, `SELECT "memberUserId" FROM support_threads WHERE id = $1`, threadID).Scan(&existingMemberID); err != nil {
			return "", err
		}
	}

	retentionDays, _ := r.GetSupportRetentionDays(ctx)
	messageID, err := newID("sup_msg")
	if err != nil {
		return "", err
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		INSERT INTO support_messages (id, "threadId", "senderUserId", message, "createdAt")
		VALUES ($1, $2, $3, $4, NOW())
	`, messageID, threadID, actorUserID, message); err != nil {
		return "", err
	}

	newStatus := "OPEN"
	if role != "MEMBER" {
		newStatus = "IN_PROGRESS"
	}
	if _, err := tx.Exec(ctx, `
		UPDATE support_threads
		SET status = $2,
			"updatedAt" = NOW(),
			"deleteAt" = NOW() + make_interval(days => $3::int)
		WHERE id = $1
	`, threadID, newStatus, retentionDays); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return threadID, nil
}

func (r *UserRepository) GetSupportThreads(ctx context.Context, actorUserID, actorRole string) ([]SupportThread, error) {
	role := strings.ToUpper(strings.TrimSpace(actorRole))
	var rowsResult interface {
		Close()
		Next() bool
		Scan(dest ...any) error
	}
	// Optimized query using lateral join instead of correlated subqueries
	baseQuery := `
		SELECT
			st.id::text,
			st."memberUserId"::text,
			COALESCE(u."nameEn", u."nameBn", '') as member_name,
			COALESCE(UPPER(SUBSTRING(st."memberUserId"::text, 1, 8)), '') as member_uid,
			COALESCE(u.phone, '') as member_phone,
			st.status,
			COALESCE(latest.message, '') as latest_message,
			COALESCE(latest."createdAt", st."updatedAt") as latest_at,
			COALESCE(UPPER(sender.role::text), '') as latest_sender_role,
			st."updatedAt",
			st."deleteAt",
			COALESCE(proc."nameEn", proc."nameBn", ''),
			COALESCE(st."processedAt", '0001-01-01'::timestamp)
		FROM support_threads st
		JOIN users u ON u.id = st."memberUserId"
		LEFT JOIN users proc ON proc.id = st."processedByUserId"
		LEFT JOIN LATERAL (
			SELECT sm.message, sm."createdAt", sm."senderUserId"
			FROM support_messages sm
			WHERE sm."threadId" = st.id
			ORDER BY sm."createdAt" DESC
			LIMIT 1
		) latest ON true
		LEFT JOIN users sender ON sender.id = latest."senderUserId"
	`

	if role == "MEMBER" {
		rows, err := r.db.Query(ctx, baseQuery+`
			WHERE st."memberUserId" = $1
			ORDER BY st."updatedAt" DESC
		`, actorUserID)
		if err != nil {
			return nil, err
		}
		rowsResult = rows
	} else {
		rows, err := r.db.Query(ctx, baseQuery+`
			ORDER BY
				CASE WHEN st.status = 'PROCESSED' THEN 1 ELSE 0 END,
				st."updatedAt" DESC
		`)
		if err != nil {
			return nil, err
		}
		rowsResult = rows
	}
	defer rowsResult.Close()

	threads := make([]SupportThread, 0)
	for rowsResult.Next() {
		var item SupportThread
		var latestAt, updatedAt, deleteAt, processedAt time.Time
		if scanErr := rowsResult.Scan(
			&item.ID,
			&item.MemberUserID,
			&item.MemberName,
			&item.MemberUid,
			&item.MemberPhone,
			&item.Status,
			&item.LatestMessage,
			&latestAt,
			&item.LatestSenderRole,
			&updatedAt,
			&deleteAt,
			&item.ProcessedBy,
			&processedAt,
		); scanErr != nil {
			continue
		}
		item.LatestAt = latestAt.Format(time.RFC3339)
		item.UpdatedAt = updatedAt.Format(time.RFC3339)
		item.DeleteAt = deleteAt.Format(time.RFC3339)
		if processedAt.Year() > 2000 {
			item.ProcessedAt = processedAt.Format(time.RFC3339)
			item.IsProcessed = true
		}
		threads = append(threads, item)
	}
	return threads, nil
}

func (r *UserRepository) GetSupportMessages(ctx context.Context, actorUserID, actorRole, threadID string) ([]SupportMessage, error) {
	role := strings.ToUpper(strings.TrimSpace(actorRole))
	whereClause := `st.id = $1`
	args := []interface{}{threadID}
	if role == "MEMBER" {
		whereClause += ` AND st."memberUserId" = $2`
		args = append(args, actorUserID)
	}

	const queryPrefix = `
		SELECT
			sm.id::text,
			sm."threadId"::text,
			sm."senderUserId"::text,
			COALESCE(UPPER(SUBSTRING(sm."senderUserId"::text, 1, 8)), '') as sender_uid,
			COALESCE(u."nameEn", u."nameBn", ''),
			u.role::text,
			sm.message,
			sm."createdAt"
		FROM support_messages sm
		JOIN support_threads st ON st.id = sm."threadId"
		JOIN users u ON u.id = sm."senderUserId"
		WHERE
	`
	querySuffix := `
		ORDER BY sm."createdAt" ASC
	`

	rows, err := r.db.Query(ctx, queryPrefix+whereClause+querySuffix, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]SupportMessage, 0)
	for rows.Next() {
		var item SupportMessage
		var createdAt time.Time
		if scanErr := rows.Scan(
			&item.ID,
			&item.ThreadID,
			&item.SenderID,
			&item.SenderUid,
			&item.SenderName,
			&item.SenderRole,
			&item.Message,
			&createdAt,
		); scanErr != nil {
			continue
		}
		item.CreatedAt = createdAt.Format(time.RFC3339)
		messages = append(messages, item)
	}
	return messages, nil
}

func (r *UserRepository) MarkSupportThreadProcessed(ctx context.Context, actorUserID, actorRole, threadID string) error {
	role := strings.ToUpper(strings.TrimSpace(actorRole))
	if role != "WORKER" && role != "ADMIN" && role != "SUPER_ADMIN" {
		return errors.New("forbidden")
	}
	_, err := r.db.Exec(ctx, `
		UPDATE support_threads
		SET status = 'PROCESSED',
			"processedByUserId" = $2,
			"processedAt" = NOW(),
			"updatedAt" = NOW()
		WHERE id = $1
	`, threadID, actorUserID)
	return err
}

func (r *UserRepository) GetMemberDeposits(ctx context.Context, userID string) (map[string]interface{}, error) {
	const query = `
		SELECT
			t.id::text,
			t.amount::bigint,
			t."createdAt",
			COALESCE(t."receiptNumber", ''),
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
		var id, receiptNumber, status, processedBy string
		var amount, balanceAfter int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &amount, &createdAt, &receiptNumber, &status, &processedBy, &balanceAfter); scanErr != nil {
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
			"id":            id,
			"amount":        amount / 100,
			"date":          createdAt.Format(time.RFC3339),
			"receiptNumber": receiptNumber,
			"status":        upperStatus,
			"processedBy":   processedBy,
		}
		if upperStatus == "CONFIRMED" || upperStatus == "PROCESSED" {
			deposit["balanceAfter"] = balanceAfter / 100
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
		"totalDeposited": totalDeposited / 100,
		"pendingAmount":  pendingAmount / 100,
		"currentBalance": currentBalance / 100,
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
		var id, txType, receipt, description, processedBy, status string
		var amount, balanceAfter int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &txType, &amount, &createdAt, &receipt, &description, &balanceAfter, &processedBy, &status); scanErr != nil {
			continue
		}

		transactions = append(transactions, map[string]interface{}{
			"id":            id,
			"type":          strings.ToUpper(strings.TrimSpace(txType)),
			"amount":        amount / 100,
			"date":          createdAt.Format(time.RFC3339),
			"receiptNumber": receipt,
			"description":   description,
			"status":        strings.ToUpper(strings.TrimSpace(status)),
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
				"loanAmount":   amount / 100,
				"requestDate":  requestDate.Format(time.RFC3339),
			})
		}
	}

	availableGuarantors := make([]map[string]interface{}, 0)
	guarantorsQuery := `
		SELECT
			u.id::text,
			COALESCE(u."nameEn", ''),
			COALESCE(a."savingsBalance", 0)::bigint
		FROM users u
		LEFT JOIN accounts a ON a."userId" = u.id
		WHERE u.role = 'MEMBER'
		  AND u.status = 'ACTIVE'
		  AND u.id <> $1
		ORDER BY COALESCE(a."savingsBalance", 0) DESC, u."nameEn" ASC
		LIMIT 50
	`
	aRows, aErr := r.db.Query(ctx, guarantorsQuery, userID)
	if aErr == nil {
		defer aRows.Close()
		for aRows.Next() {
			var id, name string
			var deposit int64
			if scanErr := aRows.Scan(&id, &name, &deposit); scanErr != nil {
				continue
			}
			availableGuarantors = append(availableGuarantors, map[string]interface{}{
				"id":      id,
				"name":    name,
				"deposit": deposit / 100,
			})
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
		"guarantorRequests":   guarantorRequests,
		"availableGuarantors": availableGuarantors,
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
			COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'WITHDRAWAL' AND "createdAt"::date = CURRENT_DATE), 0)::bigint,
			COALESCE((SELECT SUM("principalAmount") FROM loans WHERE status IN ('APPROVED','ACTIVE') AND "createdAt"::date = CURRENT_DATE), 0)::bigint
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
			"amount": amount / 100,
			"time":   createdAt.Format(time.RFC3339),
		})
	}

	return map[string]interface{}{
		"stats": map[string]interface{}{
			"totalMembers":     totalMembers,
			"pendingRequests":  pendingRequests,
			"todayDeposits":    todayDeposits / 100,
			"todayWithdrawals": todayWithdrawals / 100,
			"todayLoans":       todayLoans / 100,
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
			COALESCE(UPPER(SUBSTRING(u.id::text, 1, 8)), '') AS uid,
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
		var id, uid, name, email, phone, nid, status, area, role string
		var createdAt time.Time
		var savingsBalance, activeLoan int64
		if scanErr := rows.Scan(&id, &uid, &name, &email, &phone, &nid, &status, &createdAt, &savingsBalance, &activeLoan, &area, &role); scanErr != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":              id,
			"uid":             uid,
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
				var id, name, nameBn, email, phone, nid, fatherName, motherName, gender, maritalStatus, bloodGroup, profession, area string
				var permanentHouseNo, permanentRoadNo, permanentVillage, permanentUnion, permanentPoliceStation string
				var presentDistrict, presentHouseNo, presentRoadNo, presentVillage, presentUnion, presentPoliceStation string
				var nomineeName, nomineeRelationship, nomineeNID, nomineePhone string
				var childrenCount int
				var dateOfBirth *time.Time
				var createdAt time.Time
				var documentsJSON []byte
				if err := regRows.Scan(
					&id, &name, &nameBn, &email, &phone, &nid,
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
				"requestedAmount":   amount / 100,
				"currentDeposit":    currentDeposit / 100,
				"maxEligible":       maxEligible / 100,
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
				"amount":        amount / 100,
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
		memberID = fmt.Sprintf("MBR-%d", time.Now().Unix())
		if _, err := tx.Exec(ctx, `UPDATE users SET "memberId" = $2, "updatedAt" = NOW() WHERE id = $1`, userID, memberID); err != nil {
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
			VALUES (gen_random_uuid()::text, CONCAT('HN-ACC-', $2), 0, 0, true, 0, NOW(), NOW(), $1)
		`
		if _, err := tx.Exec(ctx, createAccountQuery, userID, memberID); err != nil {
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

func (r *UserRepository) RevertRegistrationApproval(ctx context.Context, userID, approverID, reason string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var email, phone string
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(email, ''), phone
		FROM users
		WHERE id = $1
		FOR UPDATE
	`, userID).Scan(&email, &phone)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET
			status = 'PENDING',
			"approvedAt" = NULL,
			"approvedBy" = NULL,
			"passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__',
			"updatedAt" = NOW()
		WHERE id = $1
	`, userID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM password_reset_tokens
		WHERE token LIKE 'first-login-%'
		  AND "usedAt" IS NULL
		  AND (("email" = $1 AND $1 <> '') OR "phone" = $2)
	`, email, phone); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'APPROVE_REGISTRATION_ROLLBACK', 'USER', $1, $2, NOW(), $3)
	`
	_, _ = r.db.Exec(ctx, auditQuery, userID, approverID, reason)

	return nil
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

func (r *UserRepository) ApproveLoan(ctx context.Context, loanID, approverID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var principalAmount int64
	var borrowerID, accountID, loanStatus, loanNumber string
	const loanQuery = `
		SELECT
			"principalAmount"::bigint,
			"borrowerId",
			"accountId",
			status::text,
			COALESCE("loanNumber", '')
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`
	if err := tx.QueryRow(ctx, loanQuery, loanID).Scan(&principalAmount, &borrowerID, &accountID, &loanStatus, &loanNumber); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("loan request not found")
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "PENDING_APPROVAL" {
		return errors.New("only pending loan requests can be approved")
	}

	const updateLoanQuery = `
		UPDATE loans
		SET status = 'ACTIVE',
			"disbursementDate" = NOW(),
			"approvedAt" = NOW(),
			"approvedBy" = $2,
			"remainingAmount" = $3,
			"updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateLoanQuery, loanID, approverID, principalAmount); err != nil {
		return err
	}

	var updatedLoanBalance, savingsBalance int64
	const updateAccountQuery = `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" + $2,
			"updatedAt" = NOW()
		WHERE id = $1
		RETURNING "loanBalance"::bigint, "savingsBalance"::bigint
	`
	if err := tx.QueryRow(ctx, updateAccountQuery, accountID, principalAmount).Scan(&updatedLoanBalance, &savingsBalance); err != nil {
		return err
	}

	const txnQuery = `
		INSERT INTO transactions (
			id,
			type,
			amount,
			description,
			status,
			"createdAt",
			"processedAt",
			"confirmedAt",
			"accountId",
			"userId",
			"loanId",
			"processedBy",
			"savingsAfter",
			"loanAfter"
		)
		VALUES (
			gen_random_uuid()::text,
			'LOAN_DISBURSEMENT',
			$1,
			'Loan approved and disbursed',
			'CONFIRMED',
			NOW(),
			NOW(),
			NOW(),
			$2,
			$3,
			$4,
			$5,
			$6,
			$7
		)
	`
	if _, err := tx.Exec(ctx, txnQuery, principalAmount, accountID, borrowerID, loanID, approverID, savingsBalance, updatedLoanBalance); err != nil {
		return err
	}

	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"Loan approved",
		fmt.Sprintf("Your loan request %s for BDT %.2f has been approved.", loanNumber, float64(principalAmount)/100),
		&borrowerID,
		nil,
	); err != nil {
		return fmt.Errorf("failed to notify member: %w", err)
	}

	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt")
		VALUES (gen_random_uuid()::text, 'APPROVE_LOAN', 'LOAN', $1, $2, NOW())
	`
	_, _ = tx.Exec(ctx, auditQuery, loanID, approverID)

	return tx.Commit(ctx)
}

func (r *UserRepository) RejectLoan(ctx context.Context, loanID, approverID, reason string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var borrowerID, loanStatus, loanNumber string
	if err := tx.QueryRow(ctx, `
		SELECT "borrowerId", status::text, COALESCE("loanNumber", '')
		FROM loans
		WHERE id = $1
		FOR UPDATE
	`, loanID).Scan(&borrowerID, &loanStatus, &loanNumber); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("loan request not found")
		}
		return err
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "PENDING_APPROVAL" {
		return errors.New("only pending loan requests can be rejected")
	}

	const updateQuery = `
		UPDATE loans
		SET status = 'REJECTED', "updatedAt" = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, updateQuery, loanID); err != nil {
		return err
	}

	reason = strings.TrimSpace(reason)
	memberMessage := fmt.Sprintf("Your loan request %s has been rejected.", loanNumber)
	if reason != "" {
		memberMessage = fmt.Sprintf("%s Reason: %s", memberMessage, reason)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"Loan request rejected",
		memberMessage,
		&borrowerID,
		nil,
	); err != nil {
		return fmt.Errorf("failed to notify member: %w", err)
	}

	const auditQuery = `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'REJECT_LOAN', 'LOAN', $1, $2, NOW(), $3)
	`
	_, _ = tx.Exec(ctx, auditQuery, loanID, approverID, reason)

	return tx.Commit(ctx)
}

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
		var savingsBalance, loanBalance int64
		if err := tx.QueryRow(ctx, `SELECT "savingsBalance", "loanBalance" FROM accounts WHERE id = $1`, accountID).Scan(&savingsBalance, &loanBalance); err != nil {
			return err
		}
		newSavings := savingsBalance + amount
		if _, err := tx.Exec(ctx, `UPDATE accounts SET "savingsBalance" = $1, "updatedAt" = NOW() WHERE id = $2`, newSavings, accountID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE transactions
			SET status = 'CONFIRMED', "processedAt" = NOW(), "confirmedAt" = NOW(), "processedBy" = $2, "savingsAfter" = $3, "loanAfter" = $4
			WHERE id = $1
		`, requestID, approverID, newSavings, loanBalance); err != nil {
			return err
		}
		amountTaka := float64(amount) / 100
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

		amountTaka := float64(amount) / 100
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

	amountTaka := float64(amount) / 100
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

func (r *UserRepository) CreateMemberLoanRepaymentRequest(ctx context.Context, memberID, loanID string, amount int64, bkashReference, notes string) (string, error) {
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

	var remainingAmount int64
	var loanStatus, loanNumber string
	if err := tx.QueryRow(ctx, `
		SELECT
			"remainingAmount"::bigint,
			status::text,
			COALESCE("loanNumber", '')
		FROM loans
		WHERE id = $1
		  AND "borrowerId" = $2
		FOR UPDATE
	`, loanID, memberID).Scan(&remainingAmount, &loanStatus, &loanNumber); err != nil {
		return "", errors.New("loan not found")
	}
	if strings.ToUpper(strings.TrimSpace(loanStatus)) != "ACTIVE" {
		return "", errors.New("loan is not active")
	}
	if amount > remainingAmount {
		return "", errors.New("repayment exceeds remaining balance")
	}

	var existingRequestID string
	dupErr := tx.QueryRow(ctx, `
		SELECT t.id::text
		FROM transactions t
		WHERE t."userId" = $1
		  AND t.type = 'LOAN_REPAYMENT'
		  AND t.status = 'PENDING'
		  AND t."loanId" = $2
		  AND t.amount = $3
		  AND COALESCE(t."receiptNumber", '') = $4
		ORDER BY t."createdAt" DESC
		LIMIT 1
	`, memberID, loanID, amount, reference).Scan(&existingRequestID)
	if dupErr == nil {
		return "", errors.New("duplicate pending loan repayment request")
	}
	if !errors.Is(dupErr, pgx.ErrNoRows) {
		return "", dupErr
	}

	description := strings.TrimSpace(notes)
	if description == "" {
		description = "Member-submitted bKash loan repayment request"
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
			"userId",
			"loanId"
		) VALUES (
			gen_random_uuid()::text,
			'LOAN_REPAYMENT',
			$1,
			$2,
			$3,
			'PENDING',
			NOW(),
			$4,
			$5,
			$6
		)
		RETURNING id::text
	`, amount, reference, description, accountID, memberID, loanID).Scan(&requestID); err != nil {
		return "", err
	}

	amountTaka := float64(amount) / 100
	requestSummary := fmt.Sprintf("%s submitted a loan repayment request for BDT %.2f (Loan %s, bKash ref: %s).", memberName, amountTaka, loanNumber, reference)
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"New loan repayment request",
		requestSummary,
		nil,
		normalizedRolePtr("ADMIN"),
	); err != nil {
		return "", fmt.Errorf("failed to notify admins: %w", err)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"New loan repayment request",
		requestSummary,
		nil,
		normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to notify staff: %w", err)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"Loan repayment request submitted",
		fmt.Sprintf("Your loan repayment request for BDT %.2f has been submitted and is awaiting review.", amountTaka),
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

// ==================== DEPOSIT & TRANSACTION MANAGEMENT ====================

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

func (r *UserRepository) GetAllLoans(ctx context.Context, filters map[string]interface{}) ([]map[string]interface{}, error) {
	query := `
		SELECT
			l.id,
			l."loanNumber",
			COALESCE(l."approvedAt", '0001-01-01'::timestamp),
			COALESCE(l."disbursementDate", '0001-01-01'::timestamp),
			l."principalAmount"::bigint,
			l."remainingAmount"::bigint,
			l."totalInstallments",
			l."installmentAmount"::bigint,
			l."paidInstallments",
			COALESCE(l."expectedEndDate", '0001-01-01'::timestamp),
			COALESCE(l."completedAt", '0001-01-01'::timestamp),
			l.purpose,
			l.status::text,
			l."createdAt",
			COALESCE(approver."nameEn", approver."nameBn", ''),
			COALESCE(ac."savingsBalance", 0)::bigint,
			COALESCE(b.id, ''),
			COALESCE(b."nameEn", ''),
			COALESCE(b."nameBn", ''),
			COALESCE(b."memberId", ''),
			COALESCE(g.id, ''),
			COALESCE(g."nameEn", ''),
			COALESCE(g."memberId", '')
		FROM loans l
		JOIN accounts ac ON ac.id = l."accountId"
		JOIN users b ON b.id = l."borrowerId"
		LEFT JOIN users g ON g.id = l."guarantorId"
		LEFT JOIN users approver ON approver.id = l."approvedBy"
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

	query += fmt.Sprintf(` ORDER BY l."createdAt" DESC LIMIT $%d OFFSET $%d`, argCount+1, argCount+2)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	loans := []map[string]interface{}{}
	for rows.Next() {
		var id, loanNumber, purpose, status, approvedBy, borrowerID, borrowerName, borrowerNameBn, borrowerMemberId, guarantorID, guarantorName, guarantorMemberId string
		var principalAmount, remainingAmount, installmentAmount, memberDeposit int64
		var totalInstallments, paidInstallments int
		var approvedAt, disbursementDate, expectedEndDate, completedAt, createdAt time.Time

		if err := rows.Scan(&id, &loanNumber, &approvedAt, &disbursementDate, &principalAmount, &remainingAmount, &totalInstallments, &installmentAmount, &paidInstallments,
			&expectedEndDate, &completedAt, &purpose, &status, &createdAt, &approvedBy, &memberDeposit,
			&borrowerID, &borrowerName, &borrowerNameBn, &borrowerMemberId, &guarantorID, &guarantorName, &guarantorMemberId); err != nil {
			continue
		}

		loan := map[string]interface{}{
			"id":                 id,
			"loanNumber":         loanNumber,
			"status":             status,
			"amount":             principalAmount,
			"paidAmount":         principalAmount - remainingAmount,
			"remainingAmount":    remainingAmount,
			"installmentsPaid":   paidInstallments,
			"totalInstallments":  totalInstallments,
			"monthlyInstallment": installmentAmount,
			"purpose":            purpose,
			"member": map[string]interface{}{
				"id":       borrowerID,
				"memberId": borrowerMemberId,
				"name": func() string {
					if borrowerNameBn != "" {
						return borrowerNameBn
					}
					return borrowerName
				}(),
			},
			"guarantor": map[string]interface{}{
				"id":   guarantorID,
				"name": guarantorName,
			},
			"memberDeposit":  memberDeposit,
			"missedPayments": 0,
			"createdAt":      createdAt.Format(time.RFC3339),
			"approvedBy":     approvedBy,

			// Backward-compat fields
			"principalAmount":         principalAmount,
			"totalInstallmentsLegacy": totalInstallments,
			"paidInstallments":        paidInstallments,
			"borrowerName":            borrowerName,
			"borrowerNameBn":          borrowerNameBn,
			"borrowerMemberId":        borrowerMemberId,
			"guarantorName":           guarantorName,
			"guarantorMemberId":       guarantorMemberId,
		}

		if !approvedAt.IsZero() && approvedAt.Year() > 1 {
			loan["approvedDate"] = approvedAt.Format(time.RFC3339)
		}
		if !disbursementDate.IsZero() {
			loan["disbursedDate"] = disbursementDate.Format(time.RFC3339)
			loan["disbursementDate"] = disbursementDate.Format(time.RFC3339)
		}
		if !expectedEndDate.IsZero() {
			loan["dueDate"] = expectedEndDate.Format(time.RFC3339)
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
			"amount":      amount / 100,
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
	if err != nil {
		return "", fmt.Errorf("donation account not found")
	}

	receiptNumber := fmt.Sprintf("DON-%s", time.Now().Format("20060102150405"))

	description := strings.TrimSpace(notes)
	if dn := strings.TrimSpace(donorName); dn != "" {
		if description != "" {
			description = fmt.Sprintf("DONOR:%s | %s", dn, description)
		} else {
			description = fmt.Sprintf("DONOR:%s", dn)
		}
	}

	newDonationBalance := donationBalance + amount
	_, err = tx.Exec(ctx, `
		UPDATE accounts
		SET "savingsBalance" = $1, "updatedAt" = NOW()
		WHERE id = $2
	`, newDonationBalance, donationAccID)
	if err != nil {
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

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	return receiptNumber, nil
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

func (r *UserRepository) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	if err := r.VerifyCurrentPassword(ctx, userID, currentPassword); err != nil {
		return err
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = r.db.Exec(ctx, `UPDATE users SET "passwordHash" = $1, "updatedAt" = NOW() WHERE id = $2`, string(newHash), userID)
	if err != nil {
		return err
	}

	_, err = r.db.Exec(ctx, `
		UPDATE password_reset_tokens
		SET "usedAt" = NOW()
		WHERE token LIKE 'first-login-%'
		  AND "usedAt" IS NULL
		  AND ("email" = (SELECT email FROM users WHERE id = $1) OR "phone" = (SELECT phone FROM users WHERE id = $1))
	`, userID)
	return err
}

func (r *UserRepository) VerifyCurrentPassword(ctx context.Context, userID, currentPassword string) error {
	var currentHash string
	if err := r.db.QueryRow(ctx, `SELECT "passwordHash" FROM users WHERE id = $1`, userID).Scan(&currentHash); err != nil {
		return err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(currentPassword)); err != nil {
		return fmt.Errorf("current password is incorrect")
	}

	return nil
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
			COALESCE(u."memberId", ''),
			COALESCE(u.phone, ''),
			COALESCE(g."nameEn", g."nameBn", ''),
			COALESCE(l."installmentStartDate", l."disbursementDate"),
			l."createdAt"
		FROM loans l
		JOIN users u ON u.id = l."borrowerId"
		LEFT JOIN users g ON g.id = l."guarantorId"
		WHERE l.status IN ('PENDING', 'PENDING_GUARANTOR', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'COMPLETED', 'SETTLED', 'DEFAULTED')
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
		var nextDueDate *time.Time
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
			&nextDueDate,
			&createdAt,
		); err != nil {
			continue
		}

		loan := map[string]interface{}{
			"id":                id,
			"loanNumber":        loanNumber,
			"principalAmount":   principalAmount / 100,
			"remainingAmount":   remainingAmount / 100,
			"paidInstallments":  paidInstallments,
			"totalInstallments": totalInstallments,
			"installmentAmount": installmentAmount / 100,
			"status":            strings.ToUpper(status),
			"memberUserId":      memberUserID,
			"memberName":        memberName,
			"memberNameBn":      memberNameBn,
			"memberId":          memberID,
			"memberPhone":       memberPhone,
			"guarantorName":     guarantorName,
			"createdAt":         createdAt.Format(time.RFC3339),
		}
		if nextDueDate != nil {
			loan["nextDueDate"] = nextDueDate.Format(time.RFC3339)
		}
		loans = append(loans, loan)
	}

	return loans, nil
}

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
			COALESCE(u."nameEn", ''),
			COALESCE(u."nameBn", ''),
			COALESCE(u."memberId", ''),
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
		var id, txType, receipt, description, status, memberName, memberNameBn, memberID, memberPhone string
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
			"amount":        amount / 100,
			"receipt":       receipt,
			"receiptNumber": receipt,
			"description":   description,
			"status":        strings.ToUpper(status),
			"balanceAfter":  balanceAfter / 100,
			"date":          createdAt.Format(time.RFC3339),
			"memberName":    memberName,
			"memberNameBn":  memberNameBn,
			"memberId":      memberID,
			"memberPhone":   memberPhone,
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

// GetMemberDetailForWorker returns detailed information about a member for staff view
func (r *UserRepository) GetMemberDetailForWorker(ctx context.Context, memberID string) (map[string]interface{}, error) {
	// Get member basic info
	const memberQuery = `
		SELECT
			u.id::text,
			COALESCE(SUBSTRING(u.id::text, 1, 8), '') AS uid,
			COALESCE(u."nameEn", ''),
			COALESCE(u.email, ''),
			u.phone,
			COALESCE(u."nidNumber", ''),
			u.status::text,
			u."createdAt",
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status IN ('APPROVED','ACTIVE')), 0)::bigint,
			COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t."userId" = u.id AND t.type = 'DEPOSIT'), 0)::bigint,
			COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t."userId" = u.id AND t.type = 'WITHDRAWAL'), 0)::bigint,
			COALESCE(addr.district, '') || ', ' || COALESCE(addr."policeStation", '') || ', ' || COALESCE(addr.village, ''),
			EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = u.id AND l.status IN ('APPROVED','ACTIVE'))
		FROM users u
		LEFT JOIN accounts a ON a."userId" = u.id
		LEFT JOIN addresses addr ON addr."userPermanentId" = u.id
		WHERE u.id = $1 AND u.role::text = 'MEMBER'
	`
	var id, uid, name, email, phone, nid, status, address string
	var createdAt time.Time
	var savingsBalance, activeLoan, totalDeposited, totalWithdrawn int64
	var isGuarantor bool

	err := r.db.QueryRow(ctx, memberQuery, memberID).Scan(
		&id, &uid, &name, &email, &phone, &nid, &status, &createdAt,
		&savingsBalance, &activeLoan, &totalDeposited, &totalWithdrawn, &address, &isGuarantor,
	)
	if err != nil {
		return nil, fmt.Errorf("member not found: %w", err)
	}

	// Calculate loan eligibility
	minDeposit := int64(8000) // 80,000 paisa = 800 BDT
	maxLoanMultiplier := int64(5)
	maxLoanAmount := savingsBalance * maxLoanMultiplier
	eligible := savingsBalance >= minDeposit && activeLoan == 0
	eligibilityReason := ""
	if savingsBalance < minDeposit {
		eligibilityReason = "Insufficient deposit balance"
	} else if activeLoan > 0 {
		eligibilityReason = "Already has an active loan"
	}

	member := map[string]interface{}{
		"id":                       id,
		"uid":                      strings.ToUpper(uid),
		"name":                     name,
		"email":                    email,
		"phone":                    phone,
		"nidNumber":                nid,
		"status":                   strings.ToUpper(status),
		"joinDate":                 createdAt.Format(time.RFC3339),
		"currentDeposit":           savingsBalance / 100,
		"activeLoan":               activeLoan / 100,
		"totalDeposited":           totalDeposited / 100,
		"totalWithdrawn":           totalWithdrawn / 100,
		"address":                  strings.TrimSuffix(strings.TrimPrefix(address, ", "), ", "),
		"isGuarantorForActiveLoan": isGuarantor,
		"loanEligibility": map[string]interface{}{
			"eligible":      eligible,
			"maxLoanAmount": maxLoanAmount / 100,
			"reason":        eligibilityReason,
		},
	}

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
			"amount":        amount / 100,
			"balanceAfter":  balanceAfter / 100,
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
		var disbursementDate, nextDueDate *time.Time
		if err := loanRows.Scan(&loanID, &loanNumber, &principal, &remaining, &totalInst, &paidInst, &installmentAmt, &loanStatus, &disbursementDate, &nextDueDate); err != nil {
			continue
		}
		loan := map[string]interface{}{
			"id":                loanID,
			"loanNumber":        loanNumber,
			"principalAmount":   principal / 100,
			"remainingAmount":   remaining / 100,
			"totalInstallments": totalInst,
			"paidInstallments":  paidInst,
			"installmentAmount": installmentAmt / 100,
			"status":            strings.ToUpper(loanStatus),
		}
		if disbursementDate != nil {
			loan["disbursementDate"] = disbursementDate.Format(time.RFC3339)
		}
		if nextDueDate != nil {
			loan["nextDueDate"] = nextDueDate.Format(time.RFC3339)
		}
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
func (r *UserRepository) AddMemberDeposit(ctx context.Context, memberID, workerID string, amount int64, notes string) (string, error) {
	// Verify member exists and is active
	var status, accountID string
	var currentBalance int64
	err := r.db.QueryRow(ctx, `
		SELECT u.status::text, a.id::text, COALESCE(a."savingsBalance", 0)::bigint
		FROM users u
		LEFT JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role = 'MEMBER'
	`, memberID).Scan(&status, &accountID, &currentBalance)
	if err != nil {
		return "", errors.New("member not found")
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return "", errors.New("member not active")
	}

	// Generate receipt number
	receipt := fmt.Sprintf("RCP%d%s", time.Now().Unix(), memberID[:4])

	// Start transaction
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Update account balance
	newBalance := currentBalance + amount
	_, err = tx.Exec(ctx, `UPDATE accounts SET "savingsBalance" = $1 WHERE id = $2`, newBalance, accountID)
	if err != nil {
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

	amountTaka := float64(amount) / 100
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

	err = tx.Commit(ctx)
	if err != nil {
		return "", err
	}

	return receipt, nil
}

// AddMemberWithdrawal processes a withdrawal for a member (worker action)
func (r *UserRepository) AddMemberWithdrawal(ctx context.Context, memberID, workerID string, amount int64, notes string) (string, error) {
	// Verify member exists and is active
	var status, accountID string
	var currentBalance, activeLoan int64
	var isGuarantor bool
	err := r.db.QueryRow(ctx, `
		SELECT 
			u.status::text, 
			a.id::text, 
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status IN ('APPROVED','ACTIVE')), 0)::bigint,
			EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = u.id AND l.status IN ('APPROVED','ACTIVE'))
		FROM users u
		LEFT JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role = 'MEMBER'
	`, memberID).Scan(&status, &accountID, &currentBalance, &activeLoan, &isGuarantor)
	if err != nil {
		return "", errors.New("member not found")
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return "", errors.New("member not active")
	}
	if amount > currentBalance {
		return "", errors.New("insufficient balance")
	}
	if activeLoan > 0 {
		return "", errors.New("has active loan")
	}
	if isGuarantor {
		return "", errors.New("is guarantor for active loan")
	}

	// Generate receipt number
	receipt := fmt.Sprintf("WDR%d%s", time.Now().Unix(), memberID[:4])

	// Start transaction
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Update account balance
	newBalance := currentBalance - amount
	_, err = tx.Exec(ctx, `UPDATE accounts SET "savingsBalance" = $1 WHERE id = $2`, newBalance, accountID)
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

	amountTaka := float64(amount) / 100
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

	err = tx.Commit(ctx)
	if err != nil {
		return "", err
	}

	return receipt, nil
}

// CreateMemberLoan creates a loan for a member (worker action)
func (r *UserRepository) CreateMemberLoan(ctx context.Context, memberID, workerID string, amount int64, purpose string, installments int) (string, error) {
	if installments < 1 || installments > 24 {
		return "", errors.New("invalid installments")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Verify member exists, lock account row for consistent balance/eligibility checks.
	var status, accountID string
	var currentBalance, activeLoan int64
	err = tx.QueryRow(ctx, `
		SELECT
			u.status::text,
			a.id::text,
			COALESCE(a."savingsBalance", 0)::bigint,
			COALESCE((SELECT SUM(l."remainingAmount") FROM loans l WHERE l."borrowerId" = u.id AND l.status IN ('APPROVED','ACTIVE','PENDING_APPROVAL','PENDING_GUARANTOR')), 0)::bigint
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role::text = 'MEMBER'
		FOR UPDATE OF a
	`, memberID).Scan(&status, &accountID, &currentBalance, &activeLoan)
	if err != nil {
		return "", fmt.Errorf("member not found: %w", err)
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return "", errors.New("member not active")
	}
	if activeLoan > 0 {
		return "", errors.New("has active loan")
	}

	minDeposit := int64(8000) // 80,000 paisa
	if currentBalance < minDeposit {
		return "", errors.New("not eligible - insufficient deposit")
	}

	maxLoanAmount := currentBalance * 5
	if amount > maxLoanAmount {
		return "", errors.New("exceeds limit")
	}

	loanNumber := fmt.Sprintf("LN%d%s", time.Now().Unix(), memberID[:4])
	installmentAmount := amount / int64(installments)

	var loanID string
	err = tx.QueryRow(ctx, `
		INSERT INTO loans (
			id, "loanNumber", "accountId", "borrowerId", "principalAmount", "remainingAmount",
			"totalInstallments", "paidInstallments", "installmentAmount",
			purpose, status, "disbursementDate", "approvedAt", "approvedBy", "createdAt", "updatedAt"
		) VALUES (
			gen_random_uuid()::text, $1, $2, $3, $4, $5,
			$6, 0, $7,
			$8, 'ACTIVE', NOW(), NOW(), $9, NOW(), NOW()
		)
		RETURNING id
	`, loanNumber, accountID, memberID, amount, amount, installments, installmentAmount, purpose, workerID).Scan(&loanID)
	if err != nil {
		return "", fmt.Errorf("failed to create loan: %w", err)
	}

	var updatedLoanBalance int64
	err = tx.QueryRow(ctx, `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" + $1, "updatedAt" = NOW()
		WHERE id = $2
		RETURNING "loanBalance"::bigint
	`, amount, accountID).Scan(&updatedLoanBalance)
	if err != nil {
		return "", fmt.Errorf("failed to update account loan balance: %w", err)
	}

	description := purpose
	if strings.TrimSpace(description) == "" {
		description = "ঋণ বিতরণ"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (
			id, type, amount, "receiptNumber", description, status,
			"accountId", "userId", "loanId", "processedBy",
			"loanAfter", "processedAt", "confirmedAt", "createdAt"
		) VALUES (
			gen_random_uuid()::text, 'LOAN_DISBURSEMENT', $1, $2, $3, 'CONFIRMED',
			$4, $5, $6, $7,
			$8, NOW(), NOW(), NOW()
		)
	`, amount, loanNumber, description, accountID, memberID, loanID, workerID, updatedLoanBalance)
	if err != nil {
		return "", fmt.Errorf("failed to create loan disbursement transaction: %w", err)
	}

	amountTaka := float64(amount) / 100
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"LOAN_APPROVED",
		"Loan disbursed",
		fmt.Sprintf("Your loan %s for BDT %.2f has been disbursed.", loanNumber, amountTaka),
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
		fmt.Sprintf("Loan %s disbursed for member %s.", loanNumber, strings.ToUpper(memberID)),
		nil,
		normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to create staff notification: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit loan creation: %w", err)
	}

	return loanNumber, nil
}

// AddMemberLoanPayment records a loan payment for a member
func (r *UserRepository) AddMemberLoanPayment(ctx context.Context, memberID, processedByID, loanID string, amount int64, notes string) (string, error) {
	// Verify member exists and is active
	var userId, accountId string
	var status string
	err := r.db.QueryRow(ctx, `
		SELECT u.id, u.status::text, a.id
		FROM users u
		JOIN accounts a ON a."userId" = u.id
		WHERE u.id = $1 AND u.role::text = 'MEMBER'
	`, memberID).Scan(&userId, &status, &accountId)
	if err != nil {
		return "", fmt.Errorf("member not found")
	}
	if status != "ACTIVE" {
		return "", fmt.Errorf("member account not active")
	}

	// Verify loan exists, is active, and belongs to this member
	var loanId string
	var remainingAmount int64
	var loanStatus string
	err = r.db.QueryRow(ctx, `
		SELECT id, "remainingAmount", status::text
		FROM loans
		WHERE id = $1 AND "borrowerId" = $2
	`, loanID, memberID).Scan(&loanId, &remainingAmount, &loanStatus)
	if err != nil {
		return "", fmt.Errorf("loan not found")
	}
	if loanStatus != "ACTIVE" {
		return "", fmt.Errorf("loan is not active")
	}
	if amount > remainingAmount {
		return "", fmt.Errorf("payment amount exceeds remaining balance")
	}

	// Generate receipt number
	receiptNumber := fmt.Sprintf("LRP-%s-%s", time.Now().Format("20060102150405"), memberID[:4])

	// Start transaction
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Update loan remaining amount and paid installments
	newRemaining := remainingAmount - amount
	var loanUpdateStatus string
	if newRemaining <= 0 {
		loanUpdateStatus = "COMPLETED"
	} else {
		loanUpdateStatus = "ACTIVE"
	}

	_, err = tx.Exec(ctx, `
		UPDATE loans
		SET "remainingAmount" = $1,
			"paidInstallments" = "paidInstallments" + 1,
			status = $2::"LoanStatus",
			"completedAt" = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE "completedAt" END,
			"updatedAt" = NOW()
		WHERE id = $3
	`, newRemaining, loanUpdateStatus, loanID)
	if err != nil {
		return "", fmt.Errorf("failed to update loan: %w", err)
	}

	// Update account loan balance
	_, err = tx.Exec(ctx, `
		UPDATE accounts
		SET "loanBalance" = "loanBalance" - $1,
			"updatedAt" = NOW()
		WHERE id = $2
	`, amount, accountId)
	if err != nil {
		return "", fmt.Errorf("failed to update account balance: %w", err)
	}

	// Get new loan balance after payment
	var newLoanBalance int64
	err = tx.QueryRow(ctx, `SELECT "loanBalance" FROM accounts WHERE id = $1`, accountId).Scan(&newLoanBalance)
	if err != nil {
		return "", fmt.Errorf("failed to fetch new balance: %w", err)
	}

	// Create transaction record
	description := "Loan repayment"
	if notes != "" {
		description = notes
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (
			id, type, amount, "receiptNumber", description, status,
			"accountId", "userId", "loanId", "processedBy",
			"loanAfter", "processedAt", "confirmedAt", "createdAt"
		) VALUES (
			gen_random_uuid()::text, 'LOAN_REPAYMENT', $1, $2, $3, 'CONFIRMED',
			$4, $5, $6, $7,
			$8, NOW(), NOW(), NOW()
		)
	`, amount, receiptNumber, description, accountId, memberID, loanID, processedByID, newLoanBalance)
	if err != nil {
		return "", fmt.Errorf("failed to create transaction: %w", err)
	}

	amountTaka := float64(amount) / 100
	memberTitle := "Loan repayment received"
	memberMessage := fmt.Sprintf("A loan repayment of BDT %.2f has been recorded.", amountTaka)
	if loanUpdateStatus == "COMPLETED" {
		memberTitle = "Loan completed"
		memberMessage = fmt.Sprintf("Your loan has been completed with a final repayment of BDT %.2f.", amountTaka)
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
		return "", fmt.Errorf("failed to create member notification: %w", err)
	}
	if err := r.insertNotificationTx(
		ctx,
		tx,
		"SYSTEM_ALERT",
		"Daily task update",
		fmt.Sprintf("Loan repayment recorded for member %s (BDT %.2f).", strings.ToUpper(memberID), amountTaka),
		nil,
		normalizedRolePtr("WORKER"),
	); err != nil {
		return "", fmt.Errorf("failed to create staff notification: %w", err)
	}

	// Commit transaction
	if err = tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit transaction: %w", err)
	}

	return receiptNumber, nil
}

type PasswordResetToken struct {
	ID        string
	Token     string
	Email     *string
	Phone     *string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

func (r *UserRepository) DeleteResetTokens(ctx context.Context, email, phone string) error {
	query := `DELETE FROM password_reset_tokens WHERE email = $1 OR phone = $2`
	var dbEmail, dbPhone *string
	if email != "" {
		dbEmail = &email
	}
	if phone != "" {
		dbPhone = &phone
	}
	_, err := r.db.Exec(ctx, query, dbEmail, dbPhone)
	return err
}

func (r *UserRepository) DeleteResetTokensByPrefix(ctx context.Context, tokenPrefix string) error {
	prefix := strings.TrimSpace(tokenPrefix)
	if prefix == "" {
		return fmt.Errorf("token prefix is required")
	}

	query := `DELETE FROM password_reset_tokens WHERE token LIKE $1`
	_, err := r.db.Exec(ctx, query, prefix+"%")
	return err
}

func (r *UserRepository) CreateResetToken(ctx context.Context, token, email, phone string, expiresAt time.Time) error {
	query := `
		INSERT INTO password_reset_tokens (id, token, email, phone, "expiresAt", "usedAt", "createdAt")
		VALUES ($1, $2, $3, $4, $5, NULL, $6)
	`
	idBytes := make([]byte, 12)
	rand.Read(idBytes)
	id := hex.EncodeToString(idBytes)

	var dbEmail, dbPhone *string
	if email != "" {
		dbEmail = &email
	}
	if phone != "" {
		dbPhone = &phone
	}

	_, err := r.db.Exec(ctx, query, id, token, dbEmail, dbPhone, expiresAt, time.Now())
	return err
}

func (r *UserRepository) GetResetToken(ctx context.Context, token string) (*PasswordResetToken, error) {
	query := `
		SELECT id, token, email, phone, "expiresAt", "usedAt", "createdAt"
		FROM password_reset_tokens
		WHERE token = $1
		  AND "usedAt" IS NULL
		  AND "expiresAt" > NOW()
		LIMIT 1
	`
	var t PasswordResetToken
	err := r.db.QueryRow(ctx, query, token).Scan(
		&t.ID, &t.Token, &t.Email, &t.Phone, &t.ExpiresAt, &t.UsedAt, &t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *UserRepository) DeleteResetTokenByID(ctx context.Context, id string) error {
	query := `DELETE FROM password_reset_tokens WHERE id = $1`
	_, err := r.db.Exec(ctx, query, id)
	return err
}

func (r *UserRepository) MarkResetTokenUsed(ctx context.Context, id string) error {
	query := `UPDATE password_reset_tokens SET "usedAt" = $1 WHERE id = $2`
	_, err := r.db.Exec(ctx, query, time.Now(), id)
	return err
}

func (r *UserRepository) UpdatePassword(ctx context.Context, email, phone, newPasswordHash string) error {
	query := `UPDATE users SET "passwordHash" = $1 WHERE email = $2 OR phone = $3`

	var dbEmail, dbPhone *string
	if email != "" {
		dbEmail = &email
	}
	if phone != "" {
		dbPhone = &phone
	}

	_, err := r.db.Exec(ctx, query, newPasswordHash, dbEmail, dbPhone)
	return err
}
