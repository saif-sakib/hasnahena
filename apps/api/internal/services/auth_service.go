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

	// ErrIdentifierRequired is the one thing forgot-password will still refuse:
	// an empty body. It says nothing about anybody.
	ErrIdentifierRequired = errors.New("identifier is required")

	// ErrEmailNotConfigured means this deployment cannot send anything. It is
	// answered before any lookup happens, so it is true for every caller and
	// discloses nothing about who is a member.
	ErrEmailNotConfigured = errors.New("email service is not configured")

	// ErrInvalidResetToken covers a link that is unknown, expired, or already
	// spent. One error for all three: which of them it was is a fact about the
	// account, and the person holding an invalid link has not proved they own
	// it.
	ErrInvalidResetToken = errors.New("invalid or expired token")
)

// revocationMargin is how far a revoke-all marker must outlive the longest
// token it can revoke.
//
// The marker used to be written with a hardcoded `INTERVAL '24 hours'`, which
// happened to equal JWT_EXPIRY_SECONDS' default of 86400 and was safe only
// because a marker is always created *after* the token it revokes. Raise
// JWT_EXPIRY_SECONDS past 86400 — a plausible operational change, with nothing
// anywhere warning against it — and revoked tokens come back to life when the
// marker expires first, silently, on both backends at once (WO-85).
const revocationMargin = time.Hour

// revocationTTLFor derives the marker's lifetime from the token lifetime, so
// the two can never be configured apart. A free function rather than a method
// so the invariant can be tested without a database or a service.
func revocationTTLFor(jwtExpirySeconds int64) time.Duration {
	if jwtExpirySeconds < 0 {
		jwtExpirySeconds = 0
	}
	return time.Duration(jwtExpirySeconds)*time.Second + revocationMargin
}

// timingEqualiserHash is compared against when no account matched, so an
// unknown identifier costs the same bcrypt work as a known one.
//
// Without it, "not a member" answers in microseconds and "member, wrong
// password" answers in ~60 ms — the WO-88 membership oracle again, reading off
// a stopwatch instead of a status code. Computed once, lazily, because
// generating it costs the same bcrypt work at process start.
var timingEqualiserHash = sync.OnceValue(func() []byte {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		// Only reachable if the system CSPRNG fails, which is fatal elsewhere
		// too. A fixed value still equalises the timing.
		secret = []byte("hasnahena-timing-equaliser-fallback")
	}
	hash, err := bcrypt.GenerateFromPassword(secret, bcrypt.DefaultCost)
	if err != nil {
		return nil
	}
	return hash
})

// equaliseFailedLoginTiming burns the bcrypt comparison that the caller did not
// get to make. The result is deliberately discarded.
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
	// The second bucket: this identifier from this address. See
	// rateLimitPolicies — the identifier alone keeps a flat 30-second lockout so
	// an attacker cannot lock a member out of their own savings for an hour,
	// and the pair escalates so a sustained attack prices itself out.
	originKey := identifierKey + "|" + userIP

	if limited := s.loginLockout(ctx, identifierKey, originKey); limited != nil {
		return nil, limited
	}

	user, err := s.users.FindByIdentifier(ctx, identifier)
	if err != nil {
		// A failed *lookup* is not a failed attempt. Counting one would let a
		// database blip push every member who tried to sign in during it
		// towards a lockout, and the caller did nothing wrong. It leaks nothing
		// either way: the database is down for everybody, not for members.
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		// Burn the comparison this branch skipped, so "no such account" and
		// "wrong password" take the same time as well as returning the same
		// error.
		equaliseFailedLoginTiming(password)
		return nil, s.recordLoginFailure(ctx, identifier, "", identifierKey, originKey, userIP, userAgent)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, s.recordLoginFailure(ctx, identifier, user.ID, identifierKey, originKey, userIP, userAgent)
	}

	// AFTER the password has been verified, and that order is load-bearing.
	// ErrUserInactive tells the caller "this identifier is a real account,
	// currently suspended", which is the WO-88 membership oracle on a different
	// endpoint — but only if an unauthenticated caller can reach it. Answering
	// it to someone who has just proved the password is telling the account
	// holder why they cannot get in, which they need to know.
	if strings.ToUpper(user.Status) != "ACTIVE" {
		return nil, ErrUserInactive
	}

	// Clear rate limit on successful login.
	//
	// Checked: a failure here leaves the member's failed-attempt counter
	// standing after they have proved the correct password, so the next few
	// logins are throttled or locked out for no reason they can see. Not fatal
	// — the login itself succeeded — so it is logged, not returned.
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

	// Create audit log for successful login. Checked — an audit row that
	// silently fails to write is a rule-6 problem, and the login record is what
	// an investigation starts from. The token has already been signed, so the
	// failure is logged rather than returned.
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

// loginLockout reports whether either bucket is currently locked out, as the
// error to return. A lookup failure is not a lockout: the limiter fails open,
// as it always has, because a database blip must not lock every member out of
// their own account at once.
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

// recordLoginFailure counts one failure against both buckets and returns what
// the caller should answer.
//
// The same error whichever branch called it — an unknown identifier and a wrong
// password are indistinguishable from outside, and were before this change too.
// What is new is the audit row: a flat lockout looks identical on the fifth
// failed attempt and on the five-hundredth, so a sustained attack on one named
// member was visible to nobody. It becomes an audit row the moment the lockout
// moves past its first step.
func (s *AuthService) recordLoginFailure(
	ctx context.Context,
	identifier string,
	userID string,
	identifierKey string,
	originKey string,
	userIP string,
	userAgent string,
) error {
	var answer error = ErrInvalidCredentials

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

		// Attributed to the member when the identifier resolved to one, so the
		// row shows up in that account's own history — which is where anyone
		// investigating "somebody is trying to get into my account" will look.
		//
		// The identifier itself is named ONLY when it resolves to nobody. For a
		// member the user id already says which account, and adding their email
		// or phone number to an append-only table is storing a contact detail
		// where it can never be corrected or removed (RUN-05's reasoning, at a
		// different layer). For a non-member it is the whole signal: a run of
		// these against identifiers nobody here holds is what enumeration looks
		// like.
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

	// Create audit log. Checked for the same rule-6 reason as LOGIN above; the
	// token is already blacklisted, so this cannot be unwound.
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

// ValidateToken checks if token is valid AND not blacklisted. This is the entry
// point every authenticated handler uses (via authFromRequest); ParseAccessToken
// alone skips revocation and is only correct on the logout path, which is
// blacklisting the very token it is parsing.
//
// Both revocation checks fail closed: a database error rejects the request
// rather than letting a revoked token through.
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

// ForgotPassword issues a reset link — and answers the same way whether or not
// there is an account to send one to.
//
// WO-88. This endpoint used to answer with the truth about who exists: 404 "No
// account found with this email or phone" meant *not a member*, 400 "This
// account does not have an email address" meant *a member, and here is a fact
// about their record*, and 200 meant *a member*. This repository had already
// reasoned about exactly that risk three files away — the registration
// availability endpoint is throttled because "membership itself is the
// sensitive fact" for a religious-finance cooperative in one town — and this
// endpoint answered the same question, more precisely, with no throttle at all.
//
// So: every outcome below returns nil, and the handler's reply does not depend
// on any of them. The one case where a member is worse off is an account with
// no email address, which becomes a silent no-op; they could not have been sent
// a link either way, and the support route exists for them.
func (s *AuthService) ForgotPassword(ctx context.Context, identifier string, locale string, userIP string) error {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return ErrIdentifierRequired
	}

	// Checked BEFORE the lookup. A deployment that cannot send email cannot
	// send it for anybody, so answering that is not an answer about this
	// identifier — but only as long as nothing has been looked up yet.
	if !s.email.IsConfigured() {
		return ErrEmailNotConfigured
	}

	identifierKey := strings.ToLower(identifier)

	// Two throttles, both applied before anything is looked up so neither can
	// become an oracle in its own right: one address cycling through numbers is
	// stopped by the origin bucket, and one member retrying their own address
	// is nowhere near either limit.
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
		// The signal that an enumeration is under way. Before this it was
		// invisible: the only record of a probe was a 404 nobody keeps.
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

	// A delivery failure is logged, not returned. Returning it would make the
	// reply depend on having found an account, which is the whole defect —
	// and the member is told to check their inbox either way, so this line is
	// the only place an outage is visible. It has to be loud.
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

	// One transaction: the link spent, the password written, the first-login
	// marker retired, and every existing session revoked. That last one is
	// WO-85 — the logged-in password change revoked other sessions and the
	// reset did not, which is the wrong way round. A member who resets because
	// somebody else is using their account was leaving that somebody signed in.
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

// resolveResetTarget finds the one account a reset token belongs to.
//
// It falls back from the token's email to its phone, and it distinguishes "no
// such row" from "the lookup failed". The version this replaces treated *any*
// error from the email lookup as not-found and retried with the phone, so a
// transient database error during the email query silently resolved — and reset
// — a different account (WO-87).
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
