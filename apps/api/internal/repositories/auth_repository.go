package repositories

// Identity: lookup, role and status, profile and password changes, and the
// password-reset token lifecycle.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"

	"hasnahena/apps/api/internal/models"
)

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

// ==================== APPROVAL MANAGEMENT ====================

// ErrDuplicateContact is returned when a profile edit would give a member the
// phone number or email address of an existing account. It exists so the
// handler can answer 409 instead of 500: the caller made a correctable mistake,
// and "Failed to update profile" tells them nothing about which field to change.
var ErrDuplicateContact = errors.New("phone or email already in use")

// profileFields is the allowlist. UpdateProfile takes a free-form map because
// the client sends a partial object, and an allowlist is what stops that from
// being mass assignment — a body carrying `role` or `status` changes nothing,
// because nothing here reads those keys.
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

	// `col IS DISTINCT FROM $1` makes each update a no-op when the client
	// re-sends a value it never edited, which is what the profile form does on
	// every save. RETURNING then reports whether anything actually changed, so
	// the audit row below lists real changes rather than everything on screen.
	changed := make([]string, 0, len(profileFields))
	for _, f := range profileFields {
		value, ok := data[f.key].(string)
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)

		// An empty phone would violate NOT NULL and an empty email would make
		// the account unrecoverable by password reset. Neither is a thing the
		// UI can ask for, so treat it as "field not sent" rather than erroring.
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

	// Email and phone are the addresses a password reset is delivered to, so a
	// change to either is a change to who can take over the account. That is
	// worth a row in the append-only log even though no money moved (rule 6),
	// and the log is the only place it would ever be visible: the profile
	// screen shows the new value and nothing remembers the old one.
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
