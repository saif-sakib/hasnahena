package repositories

// The repository type and shared helpers: in-transaction audit/notification
// inserts, id and document-number allocation, system_config readers.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hasnahena/apps/api/internal/money"
	"hasnahena/apps/api/internal/utils"
)

type UserRepository struct {
	db *pgxpool.Pool
}

func NewUserRepository(db *pgxpool.Pool) *UserRepository {
	return &UserRepository{db: db}
}

// disbursedLoanStatuses: loans whose principal left the fund — the one
// definition every screen uses. Labels checked by enum-literals.test.ts.
const disbursedLoanStatuses = `('ACTIVE', 'COMPLETED', 'SETTLED', 'DEFAULTED')`

func normalizedRolePtr(role string) *string {
	normalized := strings.ToUpper(strings.TrimSpace(role))
	if normalized == "" {
		return nil
	}
	return &normalized
}

// insertAuditLogTx appends an audit row inside the posting's transaction
// (rules 2 and 6).
func (r *UserRepository) insertAuditLogTx(
	ctx context.Context,
	tx pgx.Tx,
	action string,
	entityType string,
	entityID string,
	performedBy string,
	details string,
) error {
	// No id: the key is a database sequence (ADR-044).
	_, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", details, "createdAt")
		VALUES ($1, $2, $3, $4, $5, NOW())
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
		INSERT INTO notifications (type, title, message, "targetUserId", "targetRole", "createdAt")
		VALUES ($1::"NotificationType", $2, $3, $4, $5::"UserRole", NOW())
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

// nextDocumentNumber allocates the next number in a series. Call it with the
// posting's transaction so a number is consumed only if money moves.
func (r *UserRepository) nextDocumentNumber(ctx context.Context, tx pgx.Tx, series string) (string, error) {
	year := utils.CurrentSequenceYear()

	var counter int64
	if err := tx.QueryRow(ctx, utils.NextDocumentNumberQuery, series, year).Scan(&counter); err != nil {
		return "", fmt.Errorf("failed to allocate %s number: %w", series, err)
	}

	return utils.FormatDocumentNumber(series, year, counter), nil
}

func (r *UserRepository) generateNextAccountNo(ctx context.Context, tx pgx.Tx) (string, error) {
	if _, err := tx.Exec(ctx, utils.AccountNoAdvisoryLockQuery); err != nil {
		return "", fmt.Errorf("failed to acquire member id lock: %w", err)
	}

	var nextSequence int64
	if err := tx.QueryRow(ctx, utils.NextAccountNoQuery).Scan(&nextSequence); err != nil {
		return "", fmt.Errorf("failed to compute next member id: %w", err)
	}
	if nextSequence < 1 {
		nextSequence = 1
	}

	return utils.FormatAccountNo(nextSequence), nil
}

// Inside a transaction, use the Tx readers: the plain ones take a second pool
// connection and deadlock under concurrency (ADR-017).
func (r *UserRepository) getSystemConfigInt64Tx(ctx context.Context, tx pgx.Tx, key string, defaultValue int64) int64 {
	raw, ok := scanSystemConfigTx(ctx, tx, key)
	if !ok {
		return defaultValue
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || parsed <= 0 {
		return defaultValue
	}
	return parsed
}

func (r *UserRepository) getSystemConfigBoolTx(ctx context.Context, tx pgx.Tx, key string, defaultValue bool) bool {
	raw, ok := scanSystemConfigTx(ctx, tx, key)
	if !ok {
		return defaultValue
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(raw))
	if err != nil {
		return defaultValue
	}
	return parsed
}

// getMissedPaymentsForDefaultTx is the default threshold, read in-transaction.
func (r *UserRepository) getMissedPaymentsForDefaultTx(ctx context.Context, tx pgx.Tx) int {
	missed := int(r.getSystemConfigInt64Tx(ctx, tx, "loan.missedPaymentsForDefault", 3))
	if missed < 1 {
		missed = 3
	}
	return missed
}

func scanSystemConfigTx(ctx context.Context, tx pgx.Tx, key string) (string, bool) {
	var raw string
	if err := tx.QueryRow(ctx, systemConfigQuery, key).Scan(&raw); err != nil {
		return "", false
	}
	return raw, true
}

const systemConfigQuery = `
	SELECT value
	FROM system_config
	WHERE key = $1
	LIMIT 1
`

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

func (r *UserRepository) getLoanPolicy(ctx context.Context) (int64, int64, int) {
	minDepositRequired := r.getSystemConfigNonNegativeInt64(ctx, "loan.minDepositForLoan", 8000)
	maxLoanMultiplier := r.getSystemConfigInt64(ctx, "loan.maxLoanMultiplier", 5)
	maxInstallmentMonths := int(r.getSystemConfigInt64(ctx, "loan.maxInstallmentMonths", 24))
	if maxInstallmentMonths < 1 {
		maxInstallmentMonths = 24
	}
	return minDepositRequired, maxLoanMultiplier, maxInstallmentMonths
}

// attachLoanSchedule writes the schedule fields every loan list shows from
// internal/money, so the browser never re-derives isOverdue. Non-ACTIVE loans
// report no arrears.
func attachLoanSchedule(
	loan map[string]interface{},
	status string,
	installmentStart *time.Time,
	totalInstallments, paidInstallments int,
) {
	loan["missedInstallments"] = 0
	loan["isOverdue"] = false

	if installmentStart == nil || installmentStart.IsZero() {
		return
	}
	if due, ok := money.NextDueDate(*installmentStart, totalInstallments, paidInstallments); ok {
		loan["nextDueDate"] = due.Format(time.RFC3339)
	}
	if strings.ToUpper(status) != "ACTIVE" {
		return
	}
	missed := money.MissedInstallments(*installmentStart, time.Now(), totalInstallments, paidInstallments)
	loan["missedInstallments"] = missed
	loan["isOverdue"] = missed > 0
}
