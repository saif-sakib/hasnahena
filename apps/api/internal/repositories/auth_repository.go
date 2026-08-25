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

// PendingApprovalPasswordHash is the password hash written at registration and
// left in place until an admin approves. bcrypt can never produce this string,
// so a pending or rejected applicant cannot log in whatever they type.
//
// It is also the flag that tells a **rejected application** apart from a
// **deactivated member**: both are INACTIVE, but the member has a real hash and
// an approvedAt, and keeps their identifiers reserved.
const PendingApprovalPasswordHash = "__PENDING_APPROVAL_NO_LOGIN__"

// RejectedApplicationSQL matches a registration an admin turned down.
//
// Such a row owns nothing: its email, phone and NID are all free for somebody
// else — or for the same applicant reapplying, which is the owner's ruling of
// 2026-08-26 and the reason this predicate exists. Uniqueness is enforced by
// three *partial* indexes carrying exactly this condition
// (`users_email_live_key`, `users_phone_live_key`, `users_nid_live_key`, added
// by 20260826120000_live_identity_uniqueness).
//
// **Every lookup by email or phone must exclude these rows.** Two rows may now
// hold the same address, and the one that is not a member has a password hash
// nothing can match — so a login that found it would refuse a real member's
// correct password, and the availability check would tell a genuine applicant
// their own email was taken.
//
// The identical string lives in `apps/web/lib/rejected-application.ts` and in
// the migration. `apps/web/test/unit/rejected-application.test.ts` reads all
// three and fails when one drifts.
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

	_, err = r.db.Exec(ctx, retireFirstLoginMarkerSQL, userID)
	return err
}

// retireFirstLoginMarkerSQL closes the row whose existence *is*
// `mustChangePassword` (see the EXISTS in FindByIdentifier). $1 is the user id.
//
// One definition, used by both paths a password can change on: the logged-in
// change above, and the forgot-password reset in
// UpdatePasswordAndRevokeSessions. The reset path used to get this for free —
// ForgotPassword deleted *every* row for the account before issuing a link,
// first-login marker included — which cleared the forced password change at
// request time, for a reset the member might never complete.
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

// ==================== PASSWORD RESET TOKENS ====================

// Reset-token scopes — the values `password_reset_tokens.scope` may take.
//
// The purpose of a secret used to be a prefix on the secret itself
// ("first-login-<hex>", "pwd-change:<userId>:<code>"), matched with `LIKE`.
// Hashing the secret (WO-86) leaves nothing to match a prefix against, so the
// purpose moved to a column and these are the only values that go in it.
const (
	// ResetScopeForgotPassword is the link emailed by "forgot password".
	ResetScopeForgotPassword = "reset"

	// **The first-login marker is deliberately read without its expiry**, unlike
	// every other scope. The row carried `expiresAt = NOW() + 365 days` and
	// FindByIdentifier's EXISTS used to require `expiresAt > NOW()` — so a member
	// who was approved and did not log in for a year silently stopped being
	// forced to change their password, and the temporary password emailed to
	// them became their permanent one, with nothing anywhere saying so.
	//
	// That contradicted this package's own description of the marker: its
	// *existence* is the flag. A forced password change is not a deadline the
	// member can run out, it is a state they leave by changing the password —
	// which is what sets `usedAt`. The approval email says as much: "Validity:
	// until first login".
	//
	// ResetScopeFirstLogin marks an account that still has the temporary
	// password it was created with. Nothing ever presents one of these: its
	// existence *is* `mustChangePassword` (see the EXISTS in FindByIdentifier).
	ResetScopeFirstLogin = "first-login"
)

// PasswordChangeScope is the bucket for the six-digit code emailed to a member
// who is already signed in and changing their password.
//
// The user id is part of the *scope* rather than part of the secret because the
// secret is now hashed and only six digits wide: two members can hold the same
// code at the same moment, and the scope is what keeps their rows apart under
// the (scope, tokenHash) unique index.
func PasswordChangeScope(userID string) string {
	return "pwd-change:" + userID
}

// hashResetSecret is the only way a secret reaches password_reset_tokens.
//
// SHA-256 rather than bcrypt, deliberately. The forgot-password secret is 32
// bytes from crypto/rand, so it is not guessable and a slow hash buys nothing;
// the lookup is *by* the hash, and a per-row salt would turn that into a table
// scan. The six-digit change-password code genuinely is brute-forceable from a
// stolen row — what protects that flow is the ten-minute expiry and the current
// password the same request has to carry, not this hash. What the hash buys
// there is that a leaked row is not, by itself, a working code.
func hashResetSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// PasswordResetToken is a row of password_reset_tokens.
//
// It deliberately carries no secret and no hash. Callers already hold the
// plaintext they presented, nothing downstream needs the stored value, and a
// struct that carries one is a struct that can end up in a log line or a
// response body.
type PasswordResetToken struct {
	ID        string
	Scope     string
	Email     *string
	Phone     *string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

// DeleteForgotPasswordTokens removes any outstanding reset link for an account,
// so issuing a new one invalidates the old.
//
// Scoped to the forgot-password rows. It used to delete every row matching the
// address, which also destroyed the first-login marker — clearing the forced
// password change at *request* time, for a reset the member might never
// complete.
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

// CreateResetToken stores the hash of a secret. The plaintext is the caller's
// to email and is never written anywhere.
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

// GetResetToken finds an unused, unexpired secret in one scope.
//
// The presented plaintext is hashed and the hash is matched; the stored value
// is never compared to anything a caller sent in the clear.
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

// nilIfEmpty keeps an absent email or phone out of the WHERE clause as NULL
// rather than as the empty string, which would match nothing and read as if it
// might.
func nilIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// ==================== SESSION REVOCATION ====================

// ErrPasswordUpdateRowCount means a password write touched a number of rows
// other than exactly one.
//
// It is an invariant failure, not a refusal: zero rows means the account the
// caller resolved has since gone, and more than one means the statement was not
// scoped to a user. The old statement did both — `WHERE email = $2 OR phone =
// $3` could set two accounts' passwords at once, and it never looked at the row
// count, so zero rows returned nil and the API answered "password reset" to a
// member whose password had not changed (WO-87).
var ErrPasswordUpdateRowCount = errors.New("password update did not affect exactly one user")

// revokeAllUserTokensSQL writes the marker that means "every token issued for
// this user before createdAt is dead". Both backends check it on every request
// — services.IsUserTokensRevoked and apps/web/lib/auth-revocation.ts.
//
// `tokenHash` is unique, so a repeat revocation moves the existing marker
// forward rather than inserting a second one.
//
// $4 is the lifetime in seconds, and it is a parameter rather than the
// `INTERVAL '24 hours'` literal it replaced. That literal was exactly
// JWT_EXPIRY_SECONDS' default, and safe only because a marker is always created
// after the token it revokes. Raise JWT_EXPIRY_SECONDS past 86400 — a plausible
// operational change with nothing warning against it — and revoked tokens come
// back to life when the marker expires first, silently, on both backends at
// once (WO-85).
const revokeAllUserTokensSQL = `
	INSERT INTO token_blacklist (id, "tokenHash", "userId", reason, "expiresAt", "createdAt")
	VALUES (gen_random_uuid()::text, $1, $2, $3, NOW() + make_interval(secs => $4), NOW())
	ON CONFLICT ("tokenHash") DO UPDATE SET
		reason = EXCLUDED.reason,
		"expiresAt" = EXCLUDED."expiresAt",
		"createdAt" = EXCLUDED."createdAt"
`

// TokenRevocationMarker is the token_blacklist key for a whole account. It is
// exported so a test can look the row up by the same name the writer used.
func TokenRevocationMarker(userID string) string {
	return "all:" + userID
}

// RevokeAllUserTokens ends every session an account has open.
//
// The write lives here rather than in services.SecurityService, which owns the
// rest of token_blacklist, for one reason: it has to be able to run inside the
// same transaction as a password change, and repositories are the only layer
// that owns a transaction. Two copies of this INSERT — one here, one there — is
// the shape that disagrees eventually, so there is one, and the service calls
// it.
func (r *UserRepository) RevokeAllUserTokens(ctx context.Context, userID, reason string, ttl time.Duration) error {
	_, err := r.db.Exec(ctx, revokeAllUserTokensSQL, TokenRevocationMarker(userID), userID, reason, ttl.Seconds())
	return err
}

// ErrResetTokenAlreadyUsed means the link was spent between the moment it was
// validated and the moment the password was written. Two clicks on the same
// email do exactly that; so does a replay. The winner resets the password, the
// loser is told the link is no longer valid.
var ErrResetTokenAlreadyUsed = errors.New("reset token has already been used")

// CompletePasswordReset is everything a finished forgot-password reset means,
// in one transaction: the link spent, the new hash written, the first-login
// marker retired, and every session the account has open revoked.
//
// They are one fact, and the reason to write them as one is WO-85. Revocation
// is built, wired and enforced on both backends, and it was called from the
// logged-in password *change* — the path taken by someone who still has access
// — and not from the reset, the path a member reaches precisely *because* they
// have lost control of the account. The attacker's token went on working for up
// to 24 hours against a password the member had already changed, and the member
// had no way to know. Two independent statements would rebuild that on a
// smaller scale, with a crash in between and nothing anywhere saying so.
//
// The token is spent first, and spending it requires exactly one row with
// "usedAt" IS NULL. That is what makes the link single-use under concurrency
// rather than merely single-use in the happy path.
//
// The password write is scoped to `id` and its row count is checked — see
// ErrPasswordUpdateRowCount for what the statement it replaces did instead.
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
