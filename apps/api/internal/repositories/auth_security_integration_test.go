//go:build integration

// WO-85/86/87 at the SQL layer: what a password reset writes. The cross-account
// half of WO-87 lives in cmd/server/auth_security_integration_test.go.
package repositories

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"
)

const testRevocationTTL = 25 * time.Hour

// contactOf reads the address a reset token would be issued against.
func contactOf(t *testing.T, userID string) (email, phone string) {
	t.Helper()
	err := testPool.QueryRow(context.Background(),
		`SELECT COALESCE(email, ''), phone FROM users WHERE id = $1`, userID).Scan(&email, &phone)
	if err != nil {
		t.Fatalf("read contact for %s: %v", userID, err)
	}
	return email, phone
}

func passwordHashOf(t *testing.T, userID string) string {
	t.Helper()
	var hash string
	if err := testPool.QueryRow(context.Background(),
		`SELECT "passwordHash" FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		t.Fatalf("read password hash for %s: %v", userID, err)
	}
	return hash
}

// resetTokenIDFor issues a forgot-password token and returns its row id.
func resetTokenIDFor(t *testing.T, repo *UserRepository, userID, secret string) string {
	t.Helper()
	email, phone := contactOf(t, userID)
	if err := repo.CreateResetToken(context.Background(),
		ResetScopeForgotPassword, secret, email, phone, time.Now().Add(30*time.Minute)); err != nil {
		t.Fatalf("create reset token: %v", err)
	}
	token, err := repo.GetResetToken(context.Background(), ResetScopeForgotPassword, secret)
	if err != nil {
		t.Fatalf("read back reset token: %v", err)
	}
	return token.ID
}

// ---------------------------------------------------------------------------
// WO-86 — the table is not a set of working credentials
// ---------------------------------------------------------------------------

// TestAResetSecretIsNeverStoredInPlaintext (WO-86): only the hash is stored.
func TestAResetSecretIsNeverStoredInPlaintext(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	user := seedMember(t, "wo86-owner", "ACC-KH-86001", 0)
	email, phone := contactOf(t, user)

	// Composed, so secret scanners (gitleaks) don't flag a 64-char hex literal.
	secret := strings.Repeat("0123456789abcdef", 4)

	if err := repo.CreateResetToken(ctx, ResetScopeForgotPassword, secret, email, phone,
		time.Now().Add(30*time.Minute)); err != nil {
		t.Fatalf("create reset token: %v", err)
	}

	// Every text column of the row, whatever it is called. Naming the columns
	// would let a future column carrying the secret pass unnoticed.
	rows, err := testPool.Query(ctx, `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_name = 'password_reset_tokens'
		  AND data_type IN ('text', 'character varying')
	`)
	if err != nil {
		t.Fatalf("list columns: %v", err)
	}
	var columns []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan column name: %v", err)
		}
		columns = append(columns, name)
	}
	rows.Close()
	if len(columns) == 0 {
		t.Fatal("found no text columns on password_reset_tokens — this test is no longer checking anything")
	}

	for _, column := range columns {
		var hits int
		if err := testPool.QueryRow(ctx,
			`SELECT COUNT(*) FROM password_reset_tokens WHERE "`+column+`" = $1`, secret).Scan(&hits); err != nil {
			t.Fatalf("scan column %s: %v", column, err)
		}
		if hits != 0 {
			t.Errorf("column %q holds the secret in plaintext — for the lifetime of this row, "+
				"the table IS a working credential for this account", column)
		}
	}

	var stored string
	if err := testPool.QueryRow(ctx,
		`SELECT "tokenHash" FROM password_reset_tokens WHERE scope = $1`, ResetScopeForgotPassword).Scan(&stored); err != nil {
		t.Fatalf("read tokenHash: %v", err)
	}
	want := sha256.Sum256([]byte(secret))
	if stored != hex.EncodeToString(want[:]) {
		t.Errorf("tokenHash = %q, want sha256(secret)", stored)
	}

	// And the plaintext still validates, or the whole flow is broken.
	if _, err := repo.GetResetToken(ctx, ResetScopeForgotPassword, secret); err != nil {
		t.Fatalf("presenting the plaintext no longer validates: %v", err)
	}
	if _, err := repo.GetResetToken(ctx, ResetScopeForgotPassword, secret+"x"); err == nil {
		t.Error("a secret that was never issued validated")
	}
	// The scope is part of the lookup, not decoration.
	if _, err := repo.GetResetToken(ctx, ResetScopeFirstLogin, secret); err == nil {
		t.Error("a forgot-password secret validated in the first-login scope")
	}
}

// Two members can hold the same six-digit code; the scope keeps them apart.
func TestTwoMembersCanHoldTheSamePasswordChangeCode(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	first := seedMember(t, "wo86-code-a", "ACC-KH-86002", 0)
	second := seedMember(t, "wo86-code-b", "ACC-KH-86003", 0)

	for _, user := range []string{first, second} {
		email, phone := contactOf(t, user)
		if err := repo.CreateResetToken(ctx, PasswordChangeScope(user), "424242", email, phone,
			time.Now().Add(10*time.Minute)); err != nil {
			t.Fatalf("create code for %s: %v", user, err)
		}
	}

	for _, user := range []string{first, second} {
		if _, err := repo.GetResetToken(ctx, PasswordChangeScope(user), "424242"); err != nil {
			t.Errorf("%s cannot use their own code: %v", user, err)
		}
	}
}

// ---------------------------------------------------------------------------
// WO-85 and WO-87 — what a completed reset writes
// ---------------------------------------------------------------------------

// TestAResetRevokesEverySessionInTheSameTransaction (WO-85).
func TestAResetRevokesEverySessionInTheSameTransaction(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	user := seedMember(t, "wo85-member", "ACC-KH-85001", 0)
	tokenID := resetTokenIDFor(t, repo, user, "wo85-secret")

	if err := repo.CompletePasswordReset(ctx, user, "$2a$10$new", tokenID, testRevocationTTL); err != nil {
		t.Fatalf("complete reset: %v", err)
	}

	var reason string
	var expiresAt, createdAt time.Time
	err := testPool.QueryRow(ctx, `
		SELECT reason, "expiresAt", "createdAt" FROM token_blacklist WHERE "tokenHash" = $1
	`, TokenRevocationMarker(user)).Scan(&reason, &expiresAt, &createdAt)
	if err != nil {
		t.Fatalf("no revocation marker after a password reset: %v", err)
	}
	if reason != "password_reset" {
		t.Errorf("marker reason = %q, want password_reset", reason)
	}

	// The lifetime comes from the caller, which derives it from JWT_EXPIRY_SECONDS.
	// A marker shorter than the tokens it revokes brings them back to life.
	gap := expiresAt.Sub(createdAt)
	if gap < testRevocationTTL-time.Minute {
		t.Errorf("marker lives %v, want about %v — it must outlive the longest issuable token", gap, testRevocationTTL)
	}
}

// A reset that matches no user is an error, not a silent success (WO-87).
func TestAResetThatMatchesNoUserIsAnError(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	user := seedMember(t, "wo87-vanished", "ACC-KH-87001", 0)
	tokenID := resetTokenIDFor(t, repo, user, "wo87-secret")

	err := repo.CompletePasswordReset(ctx, "no-such-user", "$2a$10$new", tokenID, testRevocationTTL)
	if !errors.Is(err, ErrPasswordUpdateRowCount) {
		t.Fatalf("err = %v, want ErrPasswordUpdateRowCount", err)
	}

	// And nothing was committed: the link is still spendable.
	if _, err := repo.GetResetToken(ctx, ResetScopeForgotPassword, "wo87-secret"); err != nil {
		t.Errorf("the failed reset spent the link anyway: %v", err)
	}
}

// One link, one password — `AND "usedAt" IS NULL` under concurrency.
func TestAResetLinkIsSpentExactlyOnce(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	user := seedMember(t, "wo85-replay", "ACC-KH-85002", 0)
	tokenID := resetTokenIDFor(t, repo, user, "wo85-replay-secret")

	if err := repo.CompletePasswordReset(ctx, user, "$2a$10$first", tokenID, testRevocationTTL); err != nil {
		t.Fatalf("first reset: %v", err)
	}
	err := repo.CompletePasswordReset(ctx, user, "$2a$10$second", tokenID, testRevocationTTL)
	if !errors.Is(err, ErrResetTokenAlreadyUsed) {
		t.Fatalf("second reset err = %v, want ErrResetTokenAlreadyUsed", err)
	}
	if got := passwordHashOf(t, user); got != "$2a$10$first" {
		t.Errorf("password hash = %q, want the one the first reset wrote", got)
	}
}

// The first-login marker survives a reset REQUEST and dies with the reset.
func TestTheFirstLoginMarkerSurvivesARequestAndDiesWithTheReset(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	user := seedMember(t, "wo86-firstlogin", "ACC-KH-86004", 0)
	email, phone := contactOf(t, user)

	if err := repo.CreateResetToken(ctx, ResetScopeFirstLogin, "temp-secret", email, phone,
		time.Now().Add(365*24*time.Hour)); err != nil {
		t.Fatalf("plant first-login marker: %v", err)
	}

	mustChange := func() bool {
		t.Helper()
		found, err := repo.FindByIdentifier(ctx, email)
		if err != nil {
			t.Fatalf("find by identifier: %v", err)
		}
		return found.MustChangePassword
	}

	if !mustChange() {
		t.Fatal("mustChangePassword is false with an unused first-login marker planted")
	}

	if err := repo.DeleteForgotPasswordTokens(ctx, email, phone); err != nil {
		t.Fatalf("clear previous reset links: %v", err)
	}
	if !mustChange() {
		t.Error("issuing a reset link cleared the forced password change before the member reset anything")
	}

	tokenID := resetTokenIDFor(t, repo, user, "wo86-firstlogin-secret")
	if err := repo.CompletePasswordReset(ctx, user, "$2a$10$chosen", tokenID, testRevocationTTL); err != nil {
		t.Fatalf("complete reset: %v", err)
	}
	if mustChange() {
		t.Error("the member chose a password and is still being asked to change it")
	}
}
