package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hasnahena/apps/api/internal/repositories"
)

// SecurityService handles token blacklisting and rate limiting in PostgreSQL.
type SecurityService struct {
	db *pgxpool.Pool
}

func NewSecurityService(db *pgxpool.Pool) *SecurityService {
	return &SecurityService{db: db}
}

// hashToken creates SHA-256 hash of JWT for storage (security best practice)
func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// BlacklistToken adds a token to the blacklist (called on logout or password change)
func (s *SecurityService) BlacklistToken(ctx context.Context, token string, userID string, reason string, expiresAt time.Time) error {
	tokenHash := hashToken(token)
	_, err := s.db.Exec(ctx, `
		INSERT INTO token_blacklist (id, "tokenHash", "userId", reason, "expiresAt", "createdAt")
		VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())
		ON CONFLICT ("tokenHash") DO NOTHING
	`, tokenHash, userID, reason, expiresAt)
	return err
}

// IsTokenBlacklisted checks if a token has been revoked
func (s *SecurityService) IsTokenBlacklisted(ctx context.Context, token string) (bool, error) {
	tokenHash := hashToken(token)
	var count int
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM token_blacklist
		WHERE "tokenHash" = $1 AND "expiresAt" > NOW()
	`, tokenHash).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// The revoke-all marker is WRITTEN by UserRepository.RevokeAllUserTokens (it
// must share a password change's transaction); it is read here.
// IsUserTokensRevoked checks if all user tokens have been revoked
func (s *SecurityService) IsUserTokensRevoked(ctx context.Context, userID string, tokenIssuedAt time.Time) (bool, error) {
	var revokedAt time.Time
	err := s.db.QueryRow(ctx, `
		SELECT "createdAt" FROM token_blacklist
		WHERE "tokenHash" = $1 AND "expiresAt" > NOW()
		ORDER BY "createdAt" DESC LIMIT 1
	`, repositories.TokenRevocationMarker(userID)).Scan(&revokedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return tokenIssuedBeforeRevocation(tokenIssuedAt, revokedAt), nil
}

// tokenIssuedBeforeRevocation compares at whole seconds: JWT iat has no
// sub-second part, and first login re-signs ~200ms after the revocation.
func tokenIssuedBeforeRevocation(tokenIssuedAt, revokedAt time.Time) bool {
	return tokenIssuedAt.Before(revokedAt.Truncate(time.Second))
}

// CleanupExpiredTokens removes expired blacklist entries (cleanup ticker).
func (s *SecurityService) CleanupExpiredTokens(ctx context.Context) (int64, error) {
	result, err := s.db.Exec(ctx, `DELETE FROM token_blacklist WHERE "expiresAt" < NOW()`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// ==================== RATE LIMITING ====================
// Table-backed: survives restarts, shared across instances, writes only on
// failure. Every action is declared here with a policy
// (TestEveryRateLimitedActionIsDeclared).
const (
	// Failures against one identifier, from anywhere.
	RateLimitActionLogin = "login"

	// Failures against one identifier from one address.
	RateLimitActionLoginOrigin = "login-origin"

	// RateLimitActionForgotPassword counts reset requests for one identifier.
	RateLimitActionForgotPassword = "forgot-password"

	// Reset requests from one address, any identifier.
	RateLimitActionForgotPasswordOrigin = "forgot-password-origin"
)

// RateLimitPolicy is how one action is throttled.
type RateLimitPolicy struct {
	// MaxAttempts failures before a lockout, and again after each one served.
	MaxAttempts int

	// Window: how long the counter outlives the last attempt, so waiting out
	// one step does not reset escalation.
	Window time.Duration

	// Steps: lockout durations in order; the last repeats.
	Steps []time.Duration
}

// Login has two policies (WO-89): the identifier alone keeps a flat 30s so an
// attacker cannot lock a member out; identifier+address escalates.
var rateLimitPolicies = map[string]RateLimitPolicy{
	RateLimitActionLogin: {
		MaxAttempts: 5,
		Window:      5 * time.Minute,
		Steps:       []time.Duration{30 * time.Second},
	},
	RateLimitActionLoginOrigin: {
		MaxAttempts: 5,
		Window:      15 * time.Minute,
		Steps: []time.Duration{
			30 * time.Second,
			2 * time.Minute,
			10 * time.Minute,
			time.Hour,
		},
	},
	RateLimitActionForgotPassword: {
		MaxAttempts: 5,
		Window:      15 * time.Minute,
		Steps:       []time.Duration{15 * time.Minute},
	},
	// The enumeration limit; matches registrations/route.ts (20 per 10 min).
	RateLimitActionForgotPasswordOrigin: {
		MaxAttempts: 20,
		Window:      10 * time.Minute,
		Steps:       []time.Duration{10 * time.Minute, time.Hour},
	},
}

// defaultRateLimitPolicy: a typo fails closed rather than unthrottled.
var defaultRateLimitPolicy = RateLimitPolicy{
	MaxAttempts: 5,
	Window:      5 * time.Minute,
	Steps:       []time.Duration{30 * time.Second},
}

func policyFor(action string) RateLimitPolicy {
	if p, ok := rateLimitPolicies[action]; ok {
		return p
	}
	return defaultRateLimitPolicy
}

// lockoutFor: a lockout starts on every multiple of MaxAttempts and lengthens
// each time; between multiples nothing new is set.
func (p RateLimitPolicy) lockoutFor(attempts int) (lockout time.Duration, escalated bool, locked bool) {
	if p.MaxAttempts <= 0 || len(p.Steps) == 0 || attempts <= 0 || attempts%p.MaxAttempts != 0 {
		return 0, false, false
	}
	step := attempts/p.MaxAttempts - 1
	if step >= len(p.Steps) {
		step = len(p.Steps) - 1
	}
	return p.Steps[step], step > 0, true
}

// remainingTries is how many failures are left before the next lockout.
func (p RateLimitPolicy) remainingTries(attempts int) int {
	if p.MaxAttempts <= 0 {
		return 0
	}
	return p.MaxAttempts - attempts%p.MaxAttempts
}

type RateLimitResult struct {
	Allowed        bool
	RemainingTries int
	LockedUntil    *time.Time
	RetryAfterSecs int

	// Attempts and Escalated together signal an attack on one account.
	Attempts  int
	Escalated bool
}

func lockedResult(lockedUntil *time.Time) *RateLimitResult {
	return &RateLimitResult{
		Allowed:        false,
		RemainingTries: 0,
		LockedUntil:    lockedUntil,
		RetryAfterSecs: int(time.Until(*lockedUntil).Seconds()) + 1,
	}
}

// CheckRateLimit refuses only while a lockout is actually outstanding.
func (s *SecurityService) CheckRateLimit(ctx context.Context, action, identifier string) (*RateLimitResult, error) {
	policy := policyFor(action)
	id := action + ":" + identifier

	var attempts int
	var lockedUntil *time.Time

	err := s.db.QueryRow(ctx, `
		SELECT attempts, "lockedUntil" FROM rate_limits
		WHERE id = $1 AND "expiresAt" > NOW()
	`, id).Scan(&attempts, &lockedUntil)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No record - first attempt
			return &RateLimitResult{Allowed: true, RemainingTries: policy.MaxAttempts}, nil
		}
		return nil, err
	}

	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		result := lockedResult(lockedUntil)
		result.Attempts = attempts
		return result, nil
	}

	return &RateLimitResult{
		Allowed:        true,
		RemainingTries: policy.remainingTries(attempts),
		Attempts:       attempts,
	}, nil
}

// RecordFailedAttempt increments the count atomically, then sets the lockout
// computed by lockoutFor.
func (s *SecurityService) RecordFailedAttempt(ctx context.Context, action, identifier string) (*RateLimitResult, error) {
	policy := policyFor(action)
	id := action + ":" + identifier

	var attempts int
	var lockedUntil *time.Time

	// GREATEST, so one more failure never shortens an extended window.
	err := s.db.QueryRow(ctx, `
		INSERT INTO rate_limits (id, attempts, "expiresAt", "updatedAt")
		VALUES ($1, 1, NOW() + make_interval(secs => $2), NOW())
		ON CONFLICT (id) DO UPDATE SET
			attempts = rate_limits.attempts + 1,
			"expiresAt" = GREATEST(rate_limits."expiresAt", NOW() + make_interval(secs => $2)),
			"updatedAt" = NOW()
		RETURNING attempts, "lockedUntil"
	`, id, policy.Window.Seconds()).Scan(&attempts, &lockedUntil)
	if err != nil {
		return nil, err
	}

	lockout, escalated, locked := policy.lockoutFor(attempts)
	if locked {
		// The row outlives the lockout by a window, or serving it resets escalation.
		err := s.db.QueryRow(ctx, `
			UPDATE rate_limits
			SET "lockedUntil" = NOW() + make_interval(secs => $2::double precision),
			    "expiresAt"   = NOW() + make_interval(secs => $2::double precision + $3::double precision),
			    "updatedAt"   = NOW()
			WHERE id = $1
			RETURNING "lockedUntil"
		`, id, lockout.Seconds(), policy.Window.Seconds()).Scan(&lockedUntil)
		if err != nil {
			return nil, err
		}
	}

	result := &RateLimitResult{
		Allowed:        true,
		RemainingTries: policy.remainingTries(attempts),
		Attempts:       attempts,
		Escalated:      escalated,
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		locked := lockedResult(lockedUntil)
		locked.Attempts = attempts
		locked.Escalated = escalated
		return locked, nil
	}

	return result, nil
}

// RecordAttempt counts every attempt, success or not — a reset is throttled
// whether or not an account was found, since that is the protected fact.
func (s *SecurityService) RecordAttempt(ctx context.Context, action, identifier string) (*RateLimitResult, error) {
	return s.RecordFailedAttempt(ctx, action, identifier)
}

// ClearRateLimit clears rate limit on successful action (e.g., successful login)
func (s *SecurityService) ClearRateLimit(ctx context.Context, action, identifier string) error {
	id := action + ":" + identifier
	_, err := s.db.Exec(ctx, `DELETE FROM rate_limits WHERE id = $1`, id)
	return err
}

// CleanupExpiredRateLimits removes expired rate-limit rows (cleanup ticker).
func (s *SecurityService) CleanupExpiredRateLimits(ctx context.Context) (int64, error) {
	result, err := s.db.Exec(ctx, `DELETE FROM rate_limits WHERE "expiresAt" < NOW()`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// Audit Logging helper

type AuditLogEntry struct {
	Action     string
	EntityType string
	EntityID   string
	UserID     string
	UserIP     string
	UserAgent  string
	Details    string
	OldValue   interface{}
	NewValue   interface{}
}

// CreateAuditLog creates an audit log entry
func (s *SecurityService) CreateAuditLog(ctx context.Context, entry AuditLogEntry) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", "userIp", "userAgent", details, "createdAt")
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
	`, entry.Action, entry.EntityType, entry.EntityID, entry.UserID, entry.UserIP, entry.UserAgent, entry.Details)
	return err
}
