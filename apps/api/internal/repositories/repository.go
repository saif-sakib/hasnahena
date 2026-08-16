package repositories

// The repository type itself and the helpers every other file here leans on:
// audit and notification inserts that must run inside the caller's transaction,
// id and document-number allocation, and the system_config readers.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hasnahena/apps/api/internal/utils"
)

type UserRepository struct {
	db *pgxpool.Pool
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

// insertAuditLogTx appends an audit row inside the caller's transaction.
//
// Every balance change must leave one (CLAUDE.md rule 2), and it must share the
// posting's transaction: an audit row written separately can survive a rollback
// and describe money that never moved. audit_logs is append-only — a correction
// appends a second row, it never edits the first (rule 6).

// insertAuditLogTx appends an audit row inside the caller's transaction.
//
// Every balance change must leave one (CLAUDE.md rule 2), and it must share the
// posting's transaction: an audit row written separately can survive a rollback
// and describe money that never moved. audit_logs is append-only — a correction
// appends a second row, it never edits the first (rule 6).
func (r *UserRepository) insertAuditLogTx(
	ctx context.Context,
	tx pgx.Tx,
	action string,
	entityType string,
	entityID string,
	performedBy string,
	details string,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", details, "createdAt")
		VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW())
	`, action, entityType, entityID, performedBy, details)
	return err
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

// nextDocumentNumber allocates the next receipt, withdrawal, loan or repayment
// number in its series. It must be called with the same transaction as the
// posting it identifies: the number is then only consumed if the money actually
// moves, and concurrent postings can never share a number.
func (r *UserRepository) nextDocumentNumber(ctx context.Context, tx pgx.Tx, series string) (string, error) {
	year := utils.CurrentSequenceYear()

	var counter int64
	if err := tx.QueryRow(ctx, utils.NextDocumentNumberQuery, series, year).Scan(&counter); err != nil {
		return "", fmt.Errorf("failed to allocate %s number: %w", series, err)
	}

	return utils.FormatDocumentNumber(series, year, counter), nil
}

func (r *UserRepository) generateNextMemberID(ctx context.Context, tx pgx.Tx) (string, error) {
	if _, err := tx.Exec(ctx, utils.MemberIDAdvisoryLockQuery); err != nil {
		return "", fmt.Errorf("failed to acquire member id lock: %w", err)
	}

	var nextSequence int64
	if err := tx.QueryRow(ctx, utils.NextMemberIDQuery).Scan(&nextSequence); err != nil {
		return "", fmt.Errorf("failed to compute next member id: %w", err)
	}
	if nextSequence < 1 {
		nextSequence = 1
	}

	return utils.FormatMemberID(nextSequence), nil
}

func (r *UserRepository) getSystemConfigInt64(ctx context.Context, key string, defaultValue int64) int64 {
	const query = `
		SELECT value
		FROM system_config
		WHERE key = $1
		LIMIT 1
	`
	var raw string
	if err := r.db.QueryRow(ctx, query, key).Scan(&raw); err != nil {
		return defaultValue
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || parsed <= 0 {
		return defaultValue
	}
	return parsed
}

func (r *UserRepository) getSystemConfigNonNegativeInt64(ctx context.Context, key string, defaultValue int64) int64 {
	const query = `
		SELECT value
		FROM system_config
		WHERE key = $1
		LIMIT 1
	`
	var raw string
	if err := r.db.QueryRow(ctx, query, key).Scan(&raw); err != nil {
		return defaultValue
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || parsed < 0 {
		return defaultValue
	}
	return parsed
}

func (r *UserRepository) getSystemConfigBool(ctx context.Context, key string, defaultValue bool) bool {
	const query = `
		SELECT value
		FROM system_config
		WHERE key = $1
		LIMIT 1
	`
	var raw string
	if err := r.db.QueryRow(ctx, query, key).Scan(&raw); err != nil {
		return defaultValue
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(raw))
	if err != nil {
		return defaultValue
	}
	return parsed
}

func (r *UserRepository) getLoanPolicy(ctx context.Context) (int64, int64, int) {
	minDepositRequired := r.getSystemConfigNonNegativeInt64(ctx, "loan.minDepositForLoan", 8000)
	maxLoanMultiplier := r.getSystemConfigInt64(ctx, "loan.maxLoanMultiplier", 5)
	maxInstallmentMonths := int(r.getSystemConfigInt64(ctx, "loan.maxInstallmentMonths", 24))
	if maxInstallmentMonths < 1 {
		maxInstallmentMonths = 24
	}
	return minDepositRequired, maxLoanMultiplier, maxInstallmentMonths
}
