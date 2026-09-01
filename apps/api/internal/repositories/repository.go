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

// disbursedLoanStatuses names the loans whose principal actually left the fund.
//
// Interpolated into SQL rather than passed as a parameter because it is a fixed
// set of enum labels, not user input; `enum-literals.test.ts` checks that every
// label here is one this schema declares.
//
// It exists because three places counted "disbursed" three ways: the admin
// dashboard summed every row (so a REJECTED application counted as lending),
// GetLoanStats summed ACTIVE/COMPLETED/DEFAULTED but forgot SETTLED (so a loan
// closed against a member's savings vanished from both the total and the
// recovery rate), and the loans screen used all four. Three answers to "how
// much has the foundation lent?" on three screens a worker can open at once.
const disbursedLoanStatuses = `('ACTIVE', 'COMPLETED', 'SETTLED', 'DEFAULTED')`

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
func (r *UserRepository) insertAuditLogTx(
	ctx context.Context,
	tx pgx.Tx,
	action string,
	entityType string,
	entityID string,
	performedBy string,
	details string,
) error {
	// No `id`. The key is a sequence the database owns (ADR-044) — a log is read
	// in the order it happened, and the key is what says what that order is.
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

// A note on the Tx variants below, which matters more than it looks.
//
// The plain readers use r.db, so calling one *while holding a transaction*
// takes a SECOND connection out of the pool. Under concurrency that deadlocks:
// with N goroutines and a pool of N, every connection is held by an open
// transaction and every transaction is waiting for a free connection to read a
// config key. Nothing times out, because nothing is doing anything wrong — the
// pool is simply empty and stays empty.
//
// This was latent for a long time. `AddMemberWithdrawal` already read
// `loan.allowActiveLoanWithdrawal` from the pool inside its transaction, and
// only escaped because `activeLoan > 0 &&` short-circuits it away in the common
// case. Adding an unconditional read hung TestConcurrentWithdrawalsCannotOverdraw
// immediately and permanently.
//
// **Inside a transaction, use the Tx variant.** It also reads the value the
// transaction can see, which is the correct answer rather than an incidentally
// similar one.
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

// The withdrawal notice period used to be read here, twice — once through the
// pool and once inside a transaction — because FR-08 gated both the admin's
// approval and the worker's payout on it. It gates neither any more: staff pay
// a withdrawal at the desk when the member asks, and `loan.noticePeriodDays` is
// now the *courtesy* period a member is asked to give, published to them and
// enforced by nobody. Nothing in this backend reads it; the member's savings
// screen and the FAQ do. See ADR-030.

// getMissedPaymentsForDefaultTx is the default threshold, read inside the
// caller's transaction.
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

// attachLoanSchedule writes the three schedule fields every loan list shows,
// from the one calculation in internal/money.
//
// Before this, "next due date" was whatever column the query nearest to hand
// happened to have, and the answers disagreed by design: the worker's loan list
// sent `installmentStartDate` (always in the past on an active loan) and every
// borrower rendered as overdue; the admin's sent nothing and none did. The two
// staff dashboards are one component now, so the same four loans read "4
// overdue" and "0 overdue" depending only on which URL fetched them.
//
// `isOverdue` is decided here rather than in the browser for the same reason
// `matured` is decided here for a withdrawal notice: a second implementation of
// a policy rule eventually disagrees with the one that acts on it.
//
// A loan that is not ACTIVE has no arrears to report — a pending application
// has no schedule, and a completed or defaulted loan's schedule is over.
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
