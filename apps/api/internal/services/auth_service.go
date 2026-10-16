package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"hasnahena/apps/api/internal/models"
	"hasnahena/apps/api/internal/repositories"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserInactive       = errors.New("user not active")
	ErrInvalidToken       = errors.New("invalid token")
	ErrTokenRevoked       = errors.New("token has been revoked")

	// ErrIdentifierRequired: the only forgot-password refusal (empty body).
	ErrIdentifierRequired = errors.New("identifier is required")

	// ErrEmailNotConfigured is answered before any lookup, so it discloses nothing.
	ErrEmailNotConfigured = errors.New("email service is not configured")

	// ErrInvalidResetToken: unknown, expired or spent — deliberately one error.
	ErrInvalidResetToken = errors.New("invalid or expired token")
)

// revocationMargin is how far a revoke-all marker outlives the longest token
// it can revoke (WO-85).
const revocationMargin = time.Hour

// revocationTTLFor derives the marker lifetime from the token lifetime.
func revocationTTLFor(jwtExpirySeconds int64) time.Duration {
	if jwtExpirySeconds < 0 {
		jwtExpirySeconds = 0
	}
	return time.Duration(jwtExpirySeconds)*time.Second + revocationMargin
}

// timingEqualiserHash makes an unknown identifier cost the same bcrypt work
// as a known one, so the stopwatch is not a membership oracle (ADR-032).
var timingEqualiserHash = sync.OnceValue(func() []byte {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		// Only if the CSPRNG fails; a fixed value still equalises timing.
		secret = []byte("hasnahena-timing-equaliser-fallback")
	}
	hash, err := bcrypt.GenerateFromPassword(secret, bcrypt.DefaultCost)
	if err != nil {
		return nil
	}
	return hash
})

// equaliseFailedLoginTiming burns the bcrypt comparison the caller skipped.
func equaliseFailedLoginTiming(password string) {
	if hash := timingEqualiserHash(); hash != nil {
		_ = bcrypt.CompareHashAndPassword(hash, []byte(password))
	}
}

type ErrRateLimited struct {
	RetryAfterSeconds int
}

func (e *ErrRateLimited) Error() string {
	return "too many failed attempts"
}

type AuthService struct {
	users     *repositories.UserRepository
	security  *SecurityService
	email     *EmailService
	jwtSecret []byte
	jwtExpiry int64
}

func NewAuthService(users *repositories.UserRepository, security *SecurityService, email *EmailService, jwtSecret string, jwtExpiry int64) *AuthService {
	return &AuthService{
		users:     users,
		security:  security,
		email:     email,
		jwtSecret: []byte(jwtSecret),
		jwtExpiry: jwtExpiry,
	}
}

func (s *AuthService) Login(ctx context.Context, identifier string, password string, userIP string, userAgent string) (*models.LoginData, error) {
	identifier = strings.TrimSpace(identifier)
	password = strings.TrimSpace(password)
	if identifier == "" || password == "" {
		return nil, ErrInvalidCredentials
	}
	// Lowercased, so "A@b.com" and "a@b.com" share one bucket rather than two.
	identifierKey := strings.ToLower(identifier)
	// Second bucket: identifier+address escalates; identifier alone keeps a
	// flat 30s lockout so nobody can lock a member out (rateLimitPolicies).
	originKey := identifierKey + "|" + userIP

	if limited := s.loginLockout(ctx, identifierKey, originKey); limited != nil {
		return nil, limited
	}

	user, err := s.users.FindByIdentifier(ctx, identifier)
	if err != nil {
		// A failed lookup (DB blip) is not a failed attempt.
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		equaliseFailedLoginTiming(password)
		return nil, s.recordLoginFailure(ctx, identifier, "", identifierKey, originKey, userIP, userAgent)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, s.recordLoginFailure(ctx, identifier, user.ID, identifierKey, originKey, userIP, userAgent)
	}

	// Status is checked AFTER the password: revealing "suspended" to an
	// unauthenticated caller is a membership oracle (ADR-032).
	if strings.ToUpper(user.Status) != "ACTIVE" {
		return nil, ErrUserInactive
	}

	// Clear rate limits on success; failure is logged, not returned.
	for _, bucket := range []struct{ action, key string }{
		{RateLimitActionLogin, identifierKey},
		{RateLimitActionLoginOrigin, originKey},
	} {
		if err := s.security.ClearRateLimit(ctx, bucket.action, bucket.key); err != nil {
			slog.Error("failed to clear login rate limit after successful login",
				"userId", user.ID, "bucket", bucket.action, "error", err)
		}
	}

	now := time.Now().Unix()
	exp := now + s.jwtExpiry
	claims := jwt.MapClaims{
		"sub":   user.ID,
		"role":  user.Role,
		"email": user.Email,
		"phone": user.Phone,
		"iat":   now,
		"exp":   exp,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedToken, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return nil, err
	}

	// Audit failure is logged, not returned — the token is already signed.
	if err := s.security.CreateAuditLog(ctx, AuditLogEntry{
		Action:     "LOGIN",
		EntityType: "USER",
		EntityID:   user.ID,
		UserID:     user.ID,
		UserIP:     userIP,
		UserAgent:  userAgent,
		Details:    "Successful login",
	}); err != nil {
		slog.Error("failed to write LOGIN audit log", "userId", user.ID, "error", err)
	}

	return &models.LoginData{
		AccessToken: signedToken,
		TokenType:   "Bearer",
		ExpiresIn:   s.jwtExpiry,
		User: models.User{
			ID:                 user.ID,
			Email:              user.Email,
			Phone:              user.Phone,
			Role:               user.Role,
			Status:             user.Status,
			NameEn:             user.NameEn,
			MustChangePassword: user.MustChangePassword,
		},
	}, nil
}

// loginLockout reports whether either bucket is locked. Fails open on a
// lookup error so a DB blip cannot lock everyone out.
func (s *AuthService) loginLockout(ctx context.Context, identifierKey, originKey string) error {
	for _, bucket := range []struct{ action, key string }{
		{RateLimitActionLogin, identifierKey},
		{RateLimitActionLoginOrigin, originKey},
	} {
		result, err := s.security.CheckRateLimit(ctx, bucket.action, bucket.key)
		if err == nil && result != nil && !result.Allowed {
			return &ErrRateLimited{RetryAfterSeconds: result.RetryAfterSecs}
		}
	}
	return nil
}

// recordLoginFailure counts a failure against both buckets. Once the lockout
// escalates past its first step it also writes an audit row.
func (s *AuthService) recordLoginFailure(
	ctx context.Context,
	identifier string,
	userID string,
	identifierKey string,
	originKey string,
	userIP string,
	userAgent string,
) error {
	// Type inferred: spelling out `error` trips staticcheck ST1023.
	answer := ErrInvalidCredentials

	for _, bucket := range []struct{ action, key string }{
		{RateLimitActionLogin, identifierKey},
		{RateLimitActionLoginOrigin, originKey},
	} {
		result, err := s.security.RecordFailedAttempt(ctx, bucket.action, bucket.key)
		if err != nil || result == nil {
			continue
		}
		if !result.Allowed {
			answer = &ErrRateLimited{RetryAfterSeconds: result.RetryAfterSecs}
		}
		if !result.Escalated {
			continue
		}

		// Attributed to the member when resolved. The raw identifier is
		// recorded ONLY for non-members — never store a member's contact
		// detail in the append-only log.
		entityID, subject := userID, "this account"
		if entityID == "" {
			entityID, subject = identifier, identifier
		}
		if err := s.security.CreateAuditLog(ctx, AuditLogEntry{
			Action:     "LOGIN_LOCKOUT_ESCALATED",
			EntityType: "AUTH",
			EntityID:   entityID,
			UserID:     userID,
			UserIP:     userIP,
			UserAgent:  userAgent,
			Details: "sustained failed logins for " + subject +
				"; lockout escalated after " + strconv.Itoa(result.Attempts) + " attempts",
		}); err != nil {
			slog.Error("failed to write LOGIN_LOCKOUT_ESCALATED audit log",
				"entityId", entityID, "error", err)
		}
	}

	return answer
}

// Logout blacklists the current token
func (s *AuthService) Logout(ctx context.Context, token string, userID string, userIP string, userAgent string) error {
	// Parse token to get expiry
	claims, err := s.ParseAccessToken(token)
	if err != nil {
		return err
	}

	exp, ok := claims["exp"].(float64)
	if !ok {
		return ErrInvalidToken
	}
	expiresAt := time.Unix(int64(exp), 0)

	// Add token to blacklist
	if err := s.security.BlacklistToken(ctx, token, userID, "logout", expiresAt); err != nil {
		return err
	}

	// Audit failure is logged (rule 6).
	if err := s.security.CreateAuditLog(ctx, AuditLogEntry{
		Action:     "LOGOUT",
		EntityType: "USER",
		EntityID:   userID,
		UserID:     userID,
		UserIP:     userIP,
		UserAgent:  userAgent,
		Details:    "User logged out",
	}); err != nil {
		slog.Error("failed to write LOGOUT audit log", "userId", userID, "error", err)
	}

	return nil
}

// InvalidateAllUserTokens revokes all tokens for a user (used on password change)
func (s *AuthService) InvalidateAllUserTokens(ctx context.Context, userID string, reason string) error {
	return s.users.RevokeAllUserTokens(ctx, userID, reason, revocationTTLFor(s.jwtExpiry))
}

func (s *AuthService) ParseAccessToken(tokenString string) (jwt.MapClaims, error) {
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return nil, ErrInvalidToken
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return s.jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

// ValidateToken checks signature, expiry AND revocation; every authenticated
// handler uses it. ParseAccessToken alone is only right on logout. Fails closed.
func (s *AuthService) ValidateToken(ctx context.Context, tokenString string) (jwt.MapClaims, error) {
	claims, err := s.ParseAccessToken(tokenString)
	if err != nil {
		return nil, err
	}

	// Check if token is blacklisted
	blacklisted, err := s.security.IsTokenBlacklisted(ctx, tokenString)
	if err != nil {
		return nil, err
	}
	if blacklisted {
		return nil, ErrTokenRevoked
	}

	// Check if all user tokens were revoked (e.g., password change)
	userID, _ := claims["sub"].(string)
	iat, _ := claims["iat"].(float64)
	if userID != "" && iat > 0 {
		issuedAt := time.Unix(int64(iat), 0)
		revoked, err := s.security.IsUserTokensRevoked(ctx, userID, issuedAt)
		if err != nil {
			return nil, err
		}
		if revoked {
			return nil, ErrTokenRevoked
		}
	}

	return claims, nil
}

// ForgotPassword issues a reset link and returns nil for every outcome, so
// the reply never reveals who is a member (WO-88, ADR-032).
func (s *AuthService) ForgotPassword(ctx context.Context, identifier string, locale string, userIP string) error {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return ErrIdentifierRequired
	}

	// Checked BEFORE the lookup, so it says nothing about the identifier.
	if !s.email.IsConfigured() {
		return ErrEmailNotConfigured
	}

	identifierKey := strings.ToLower(identifier)

	// Both throttles apply before the lookup, so neither is an oracle.
	for _, bucket := range []struct{ action, key string }{
		{RateLimitActionForgotPassword, identifierKey},
		{RateLimitActionForgotPasswordOrigin, userIP},
	} {
		if result, err := s.security.CheckRateLimit(ctx, bucket.action, bucket.key); err == nil && result != nil && !result.Allowed {
			return &ErrRateLimited{RetryAfterSeconds: result.RetryAfterSecs}
		}
		if _, err := s.security.RecordAttempt(ctx, bucket.action, bucket.key); err != nil {
			slog.Error("failed to record forgot-password attempt", "bucket", bucket.action, "error", err)
		}
	}

	user, err := s.users.FindByIdentifier(ctx, identifier)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("forgot-password lookup failed", "error", err)
			return nil
		}
		// An audit row is the only signal of enumeration.
		if auditErr := s.security.CreateAuditLog(ctx, AuditLogEntry{
			Action:     "PASSWORD_RESET_REQUESTED_UNKNOWN",
			EntityType: "AUTH",
			EntityID:   identifier,
			UserIP:     userIP,
			Details:    "password reset requested for an identifier with no account",
		}); auditErr != nil {
			slog.Error("failed to write PASSWORD_RESET_REQUESTED_UNKNOWN audit log", "error", auditErr)
		}
		return nil
	}

	user.Email = strings.TrimSpace(user.Email)
	if user.Email == "" {
		slog.Warn("password reset requested for an account with no email address", "userId", user.ID)
		return nil
	}

	if err := s.users.DeleteForgotPasswordTokens(ctx, user.Email, user.Phone); err != nil {
		slog.Error("failed to clear previous reset tokens", "userId", user.ID, "error", err)
		return nil
	}

	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		slog.Error("failed to generate a reset secret", "userId", user.ID, "error", err)
		return nil
	}
	secretHex := hex.EncodeToString(secret)
	expiresAt := time.Now().UTC().Add(30 * time.Minute)

	if err := s.users.CreateResetToken(ctx, repositories.ResetScopeForgotPassword, secretHex, user.Email, user.Phone, expiresAt); err != nil {
		slog.Error("failed to store a reset token", "userId", user.ID, "error", err)
		return nil
	}

	if err := s.security.CreateAuditLog(ctx, AuditLogEntry{
		Action:     "PASSWORD_RESET_REQUESTED",
		EntityType: "USER",
		EntityID:   user.ID,
		UserID:     user.ID,
		UserIP:     userIP,
		Details:    "Password reset link issued",
	}); err != nil {
		slog.Error("failed to write PASSWORD_RESET_REQUESTED audit log", "userId", user.ID, "error", err)
	}

	// Logged, not returned — the reply must not depend on finding an account.
	if err := s.email.SendPasswordResetEmail(ctx, user.Email, secretHex, locale); err != nil {
		slog.Error("password reset email failed to send", "userId", user.ID, "error", err)
	}

	return nil
}

func (s *AuthService) ValidateResetToken(ctx context.Context, token string) (*repositories.PasswordResetToken, error) {
	resetToken, err := s.users.GetResetToken(ctx, repositories.ResetScopeForgotPassword, token)
	if err != nil {
		return nil, ErrInvalidResetToken
	}

	return resetToken, nil
}

func (s *AuthService) ResetPassword(ctx context.Context, token string, newPassword string) error {
	resetToken, err := s.ValidateResetToken(ctx, token)
	if err != nil {
		return err
	}

	email := ""
	if resetToken.Email != nil {
		email = *resetToken.Email
	}
	phone := ""
	if resetToken.Phone != nil {
		phone = *resetToken.Phone
	}

	user, err := s.resolveResetTarget(ctx, email, phone)
	if err != nil {
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	// One transaction, including revoking every session (WO-85).
	if err := s.users.CompletePasswordReset(ctx, user.ID, string(hash), resetToken.ID, revocationTTLFor(s.jwtExpiry)); err != nil {
		if errors.Is(err, repositories.ErrResetTokenAlreadyUsed) {
			return ErrInvalidResetToken
		}
		return err
	}

	// Checked for the same rule-6 reason; the password has already been written.
	if err := s.security.CreateAuditLog(ctx, AuditLogEntry{
		Action:     "PASSWORD_RESET",
		EntityType: "USER",
		EntityID:   user.ID,
		UserID:     user.ID,
		Details:    "Password reset via email link; all sessions revoked",
	}); err != nil {
		slog.Error("failed to write PASSWORD_RESET audit log", "userId", user.ID, "error", err)
	}

	return nil
}

// resolveResetTarget finds a reset token's account by email, then phone, and
// distinguishes "no row" from "lookup failed" (WO-87).
func (s *AuthService) resolveResetTarget(ctx context.Context, email, phone string) (*models.User, error) {
	if email != "" {
		user, err := s.users.FindByIdentifier(ctx, email)
		switch {
		case err == nil:
			return user, nil
		case !errors.Is(err, pgx.ErrNoRows):
			return nil, err
		}
	}

	if phone == "" {
		return nil, ErrInvalidResetToken
	}

	user, err := s.users.FindByIdentifier(ctx, phone)
	switch {
	case err == nil:
		return user, nil
	case errors.Is(err, pgx.ErrNoRows):
		return nil, ErrInvalidResetToken
	default:
		return nil, err
	}
}
