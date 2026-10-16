package repositories

// Identity: lookup, role and status, profile and password changes, and the
// password-reset token lifecycle.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"

	"hasnahena/apps/api/internal/models"
)

// PendingApprovalPasswordHash is written at registration until approval;
// bcrypt never produces it, so no applicant can log in. It also tells a
// rejected application (this hash) from a deactivated member (real hash).
const PendingApprovalPasswordHash = "__PENDING_APPROVAL_NO_LOGIN__"

// RejectedApplicationSQL matches a refused registration. Such a row owns no
// email, phone or NID (partial *_live_key indexes), so EVERY lookup by contact
// detail must exclude it. Identical copies: apps/web/lib/rejected-application.ts
// and the migration (rejected-application.test.ts).
const RejectedApplicationSQL = `role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL AND "passwordHash" = '` + PendingApprovalPasswordHash + `'`

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
				  AND prt.scope = 'first-login'
				  AND prt."usedAt" IS NULL
			) AS must_change_password
		FROM users
		WHERE (lower(COALESCE(email, '')) = lower($1) OR phone = $1)
		  AND NOT (` + RejectedApplicationSQL + `)
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
			COALESCE(u."accountNo", '')
		FROM users u
		WHERE u.id = $1
	`
	var id, nameEn, nameBn, email, phone, role, status, avatarUrl, accountNo string
	if err := r.db.QueryRow(ctx, query, userID).Scan(
		&id, &nameEn, &nameBn, &email, &phone, &role, &status, &avatarUrl, &accountNo,
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
		"accountNo": accountNo,
	}, nil
}

func (r *UserRepository) UpdateUserStatus(ctx context.Context, userID string, status string, reason string) error {
	const query = `UPDATE users SET status = $2, "updatedAt" = NOW() WHERE id = $1`
	_, err := r.db.Exec(ctx, query, userID, status)
	return err
}

// ErrDuplicateContact: a profile edit would reuse another account's phone or
// email — 409, not 500.
var ErrDuplicateContact = errors.New("phone or email already in use")

// profileFields is the allowlist that stops UpdateProfile's free-form map from
// being mass assignment.
var profileFields = []struct {
	key    string
	column string
}{
	{"nameEn", `"nameEn"`},
	{"nameBn", `"nameBn"`},
	{"phone", `phone`},
	{"email", `email`},
}

func (r *UserRepository) UpdateProfile(ctx context.Context, userID string, data map[string]interface{}) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after a successful commit is a no-op

	// IS DISTINCT FROM + RETURNING so the audit row lists only real changes.
	changed := make([]string, 0, len(profileFields))
	for _, f := range profileFields {
		value, ok := data[f.key].(string)
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)

		// Empty phone/email is treated as "not sent" (NOT NULL; reset delivery).
		if value == "" && (f.key == "phone" || f.key == "email") {
			continue
		}

		tag, err := tx.Exec(ctx,
			`UPDATE users SET `+f.column+` = $1, "updatedAt" = NOW()
			 WHERE id = $2 AND `+f.column+` IS DISTINCT FROM $1`,
			value, userID)
		if err != nil {
			var pgErr *pgconn.PgError
			// 23505 unique_violation: phone and email both carry unique indexes.
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return ErrDuplicateContact
			}
			return err
		}
		if tag.RowsAffected() > 0 {
			changed = append(changed, f.key)
		}
	}

	// A changed email/phone changes who can reset the account — audit it (rule 6).
	if len(changed) > 0 {
		if err := r.insertAuditLogTx(ctx, tx, "PROFILE_UPDATED", "USER", userID, userID,
			"fields: "+strings.Join(changed, ", ")); err != nil {
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

	_, err = r.db.Exec(ctx, retireFirstLoginMarkerSQL, userID)
	return err
}

// retireFirstLoginMarkerSQL closes the row whose existence is
// `mustChangePassword`. Shared by the logged-in change and the reset path. $1 = user id.
const retireFirstLoginMarkerSQL = `
	UPDATE password_reset_tokens
	SET "usedAt" = NOW()
	WHERE scope = 'first-login'
	  AND "usedAt" IS NULL
	  AND ("email" = (SELECT email FROM users WHERE id = $1) OR "phone" = (SELECT phone FROM users WHERE id = $1))
`

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

// Reset-token scopes: the purpose lives in a column because secrets are hashed (WO-86).
const (
	// ResetScopeForgotPassword is the link emailed by "forgot password".
	ResetScopeForgotPassword = "reset"

	// ResetScopeFirstLogin marks an account still on its temporary password;
	// its existence IS `mustChangePassword`. Deliberately read WITHOUT its
	// expiry — the forced change is a state, not a deadline.
	ResetScopeFirstLogin = "first-login"
)

// PasswordChangeScope buckets the signed-in password-change code. The user id
// is in the scope so equal six-digit codes do not collide.
func PasswordChangeScope(userID string) string {
	return "pwd-change:" + userID
}

// hashResetSecret is the only way a secret reaches password_reset_tokens.
// SHA-256, not bcrypt: the lookup is by hash, and the 32-byte reset secret is
// unguessable. The 6-digit code relies on its 10-minute expiry instead.
func hashResetSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// PasswordResetToken is a row of password_reset_tokens. It carries no secret
// or hash, so neither can leak into a log or response.
type PasswordResetToken struct {
	ID        string
	Scope     string
	Email     *string
	Phone     *string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

// DeleteForgotPasswordTokens invalidates outstanding reset links. Scoped to
// forgot-password rows so the first-login marker survives.
func (r *UserRepository) DeleteForgotPasswordTokens(ctx context.Context, email, phone string) error {
	query := `DELETE FROM password_reset_tokens WHERE scope = $1 AND (email = $2 OR phone = $3)`
	_, err := r.db.Exec(ctx, query, ResetScopeForgotPassword, nilIfEmpty(email), nilIfEmpty(phone))
	return err
}

// DeleteResetTokensByScope drops every secret in one scope. The password-change
// flow calls it before issuing a code so a member never holds two.
func (r *UserRepository) DeleteResetTokensByScope(ctx context.Context, scope string) error {
	scope = strings.TrimSpace(scope)
	if scope == "" {
		return fmt.Errorf("token scope is required")
	}

	query := `DELETE FROM password_reset_tokens WHERE scope = $1`
	_, err := r.db.Exec(ctx, query, scope)
	return err
}

func (r *UserRepository) CreateResetToken(ctx context.Context, scope, secret, email, phone string, expiresAt time.Time) error {
	scope = strings.TrimSpace(scope)
	if scope == "" {
		return fmt.Errorf("token scope is required")
	}
	if secret == "" {
		return fmt.Errorf("token secret is required")
	}

	query := `
		INSERT INTO password_reset_tokens (id, scope, "tokenHash", email, phone, "expiresAt", "usedAt", "createdAt")
		VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
	`
	idBytes := make([]byte, 12)
	if _, err := rand.Read(idBytes); err != nil {
		return err
	}
	id := hex.EncodeToString(idBytes)

	_, err := r.db.Exec(ctx, query, id, scope, hashResetSecret(secret),
		nilIfEmpty(email), nilIfEmpty(phone), expiresAt, time.Now())
	return err
}

// GetResetToken finds an unused, unexpired secret in one scope, by its hash.
func (r *UserRepository) GetResetToken(ctx context.Context, scope, secret string) (*PasswordResetToken, error) {
	query := `
		SELECT id, scope, email, phone, "expiresAt", "usedAt", "createdAt"
		FROM password_reset_tokens
		WHERE scope = $1
		  AND "tokenHash" = $2
		  AND "usedAt" IS NULL
		  AND "expiresAt" > NOW()
		LIMIT 1
	`
	var t PasswordResetToken
	err := r.db.QueryRow(ctx, query, scope, hashResetSecret(secret)).Scan(
		&t.ID, &t.Scope, &t.Email, &t.Phone, &t.ExpiresAt, &t.UsedAt, &t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *UserRepository) MarkResetTokenUsed(ctx context.Context, id string) error {
	query := `UPDATE password_reset_tokens SET "usedAt" = $1 WHERE id = $2`
	_, err := r.db.Exec(ctx, query, time.Now(), id)
	return err
}

// nilIfEmpty passes an absent email/phone as NULL, not "".
func nilIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// ErrPasswordUpdateRowCount: a password write touched other than exactly one
// row — an invariant failure, not a refusal (WO-87).
var ErrPasswordUpdateRowCount = errors.New("password update did not affect exactly one user")

// revokeAllUserTokensSQL writes the "every token issued before createdAt is
// dead" marker, checked by both backends (services.IsUserTokensRevoked,
// apps/web/lib/auth-revocation.ts). $4 is the TTL in seconds, derived from
// JWT_EXPIRY_SECONDS so a marker never expires before the tokens it kills (WO-85).
const revokeAllUserTokensSQL = `
	INSERT INTO token_blacklist (id, "tokenHash", "userId", reason, "expiresAt", "createdAt")
	VALUES (gen_random_uuid()::text, $1, $2, $3, NOW() + make_interval(secs => $4), NOW())
	ON CONFLICT ("tokenHash") DO UPDATE SET
		reason = EXCLUDED.reason,
		"expiresAt" = EXCLUDED."expiresAt",
		"createdAt" = EXCLUDED."createdAt"
`

// TokenRevocationMarker is the token_blacklist key for a whole account.
func TokenRevocationMarker(userID string) string {
	return "all:" + userID
}

// RevokeAllUserTokens ends every session. It lives here, not in SecurityService,
// so it can share a password change's transaction (ADR-031).
func (r *UserRepository) RevokeAllUserTokens(ctx context.Context, userID, reason string, ttl time.Duration) error {
	_, err := r.db.Exec(ctx, revokeAllUserTokensSQL, TokenRevocationMarker(userID), userID, reason, ttl.Seconds())
	return err
}

// ErrResetTokenAlreadyUsed: the link was spent between validation and write.
var ErrResetTokenAlreadyUsed = errors.New("reset token has already been used")

// CompletePasswordReset spends the link, writes the hash, retires the
// first-login marker and revokes every session — in ONE transaction (WO-85).
// Spending requires exactly one "usedAt" IS NULL row: single-use under
// concurrency. The password write is scoped to id and row-count checked.
func (r *UserRepository) CompletePasswordReset(
	ctx context.Context,
	userID string,
	newPasswordHash string,
	resetTokenID string,
	revocationTTL time.Duration,
) error {
	if strings.TrimSpace(userID) == "" {
		return errors.New("user id is required")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after a successful commit is a no-op

	spent, err := tx.Exec(ctx,
		`UPDATE password_reset_tokens SET "usedAt" = NOW() WHERE id = $1 AND "usedAt" IS NULL`,
		resetTokenID)
	if err != nil {
		return err
	}
	if spent.RowsAffected() != 1 {
		return ErrResetTokenAlreadyUsed
	}

	tag, err := tx.Exec(ctx,
		`UPDATE users SET "passwordHash" = $2, "updatedAt" = NOW() WHERE id = $1`,
		userID, newPasswordHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: %d rows", ErrPasswordUpdateRowCount, tag.RowsAffected())
	}

	if _, err := tx.Exec(ctx, retireFirstLoginMarkerSQL, userID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, revokeAllUserTokensSQL,
		TokenRevocationMarker(userID), userID, "password_reset", revocationTTL.Seconds()); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
