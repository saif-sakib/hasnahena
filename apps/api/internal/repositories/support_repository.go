package repositories

// Support chat, its retention policy, and the SSE tickets (SEC-05). Tables
// come from migrations only (WO-70).

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
)

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
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		INSERT INTO system_config (key, value, "updatedAt")
		VALUES ('support.chatRetentionDays', $1, NOW())
		ON CONFLICT (key)
		DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
	`, strconv.Itoa(days)); err != nil {
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

// CreateSSETicket stores a hashed stream ticket. Expired rows are swept on the
// way in, so the table stays bounded without needing a scheduled job.
func (r *UserRepository) CreateSSETicket(ctx context.Context, ticketHash string, userID string, purpose string, expiresAt time.Time) error {
	if _, err := r.db.Exec(ctx, `DELETE FROM sse_tickets WHERE "expiresAt" < NOW()`); err != nil {
		return err
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO sse_tickets ("ticketHash", "userId", purpose, "expiresAt", "createdAt")
		VALUES ($1, $2, $3, $4, NOW())
	`, ticketHash, userID, purpose, expiresAt)
	return err
}

// ConsumeSSETicket resolves an unexpired ticket to its owner. The ticket is not
// deleted: EventSource reconnects re-send the same URL, and the TTL is short
// enough that reuse inside the window is not a meaningful widening.
func (r *UserRepository) ConsumeSSETicket(ctx context.Context, ticketHash string, purpose string) (string, error) {
	var userID string
	err := r.db.QueryRow(ctx, `
		SELECT "userId"
		FROM sse_tickets
		WHERE "ticketHash" = $1 AND purpose = $2 AND "expiresAt" > NOW()
	`, ticketHash, purpose).Scan(&userID)
	if err != nil {
		return "", errors.New("invalid stream ticket")
	}
	return userID, nil
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

// ErrSupportForbidden: only staff may close a member's thread (rule 2b).
var ErrSupportForbidden = errors.New("forbidden")

func (r *UserRepository) MarkSupportThreadProcessed(ctx context.Context, actorUserID, actorRole, threadID string) error {
	role := strings.ToUpper(strings.TrimSpace(actorRole))
	if role != "WORKER" && role != "ADMIN" && role != "SUPER_ADMIN" {
		return ErrSupportForbidden
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
