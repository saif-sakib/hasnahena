package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SecurityService handles token blacklisting and distributed rate limiting
// using PostgreSQL (free, already available) instead of Redis
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

// BlacklistAllUserTokens revokes all tokens for a user (called on password change)
func (s *SecurityService) BlacklistAllUserTokens(ctx context.Context, userID string, reason string) error {
	// Insert a special marker that means "all tokens issued before this time are invalid".
	// "tokenHash" is unique, so a repeat revocation for the same user has to move
	// the existing marker forward rather than insert a second one.
	_, err := s.db.Exec(ctx, `
		INSERT INTO token_blacklist (id, "tokenHash", "userId", reason, "expiresAt", "createdAt")
		VALUES (gen_random_uuid()::text, $1, $2, $3, NOW() + INTERVAL '24 hours', NOW())
		ON CONFLICT ("tokenHash") DO UPDATE SET
			reason = EXCLUDED.reason,
			"expiresAt" = EXCLUDED."expiresAt",
			"createdAt" = EXCLUDED."createdAt"
	`, "all:"+userID, userID, reason)
	return err
}

// IsUserTokensRevoked checks if all user tokens have been revoked
func (s *SecurityService) IsUserTokensRevoked(ctx context.Context, userID string, tokenIssuedAt time.Time) (bool, error) {
	var revokedAt time.Time
	err := s.db.QueryRow(ctx, `
		SELECT "createdAt" FROM token_blacklist
		WHERE "tokenHash" = $1 AND "expiresAt" > NOW()
		ORDER BY "createdAt" DESC LIMIT 1
	`, "all:"+userID).Scan(&revokedAt)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return false, nil
		}
		return false, err
	}
	return tokenIssuedBeforeRevocation(tokenIssuedAt, revokedAt), nil
}

// tokenIssuedBeforeRevocation reports whether a token predates a revocation marker.
//
// The two timestamps do not have the same precision. A JWT `iat` is whole
// seconds (`time.Now().Unix()`), while the marker's createdAt comes from NOW()
// with microseconds. Comparing them raw rejects a token issued in the *same
// second* as the revocation — which is exactly what first login does: it
// changes the temporary password, then signs in again ~200 ms later. That new
// token would be born revoked and every dashboard call would 401.
//
// So compare at the precision the token actually carries. The cost is that a
// token issued earlier in the same second as the password change also survives;
// that is a sub-second window, and the alternative is a broken first login for
// every member.
func tokenIssuedBeforeRevocation(tokenIssuedAt, revokedAt time.Time) bool {
	return tokenIssuedAt.Before(revokedAt.Truncate(time.Second))
}

// CleanupExpiredTokens removes expired entries from the blacklist. Called on
// the cleanup ticker in main.go; without it token_blacklist grows without bound.
func (s *SecurityService) CleanupExpiredTokens(ctx context.Context) (int64, error) {
	result, err := s.db.Exec(ctx, `DELETE FROM token_blacklist WHERE "expiresAt" < NOW()`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// Rate Limiting using PostgreSQL

const (
	RateLimitMaxAttempts = 5
	RateLimitLockout     = 30 * time.Second
	RateLimitWindow      = 5 * time.Minute // Cleanup old entries after this
)

type RateLimitResult struct {
	Allowed         bool
	RemainingTries  int
	LockedUntil     *time.Time
	RetryAfterSecs  int
}

// CheckRateLimit checks if an action is allowed for the given identifier
func (s *SecurityService) CheckRateLimit(ctx context.Context, action, identifier string) (*RateLimitResult, error) {
	id := action + ":" + identifier

	var attempts int
	var lockedUntil *time.Time

	err := s.db.QueryRow(ctx, `
		SELECT attempts, "lockedUntil" FROM rate_limits
		WHERE id = $1 AND "expiresAt" > NOW()
	`, id).Scan(&attempts, &lockedUntil)

	if err != nil {
		if err.Error() == "no rows in result set" {
			// No record - first attempt
			return &RateLimitResult{Allowed: true, RemainingTries: RateLimitMaxAttempts - 1}, nil
		}
		return nil, err
	}

	// Check if currently locked
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return &RateLimitResult{
			Allowed:        false,
			RemainingTries: 0,
			LockedUntil:    lockedUntil,
			RetryAfterSecs: int(time.Until(*lockedUntil).Seconds()) + 1,
		}, nil
	}

	// Check if max attempts reached
	if attempts >= RateLimitMaxAttempts {
		lockUntil := time.Now().Add(RateLimitLockout)
		return &RateLimitResult{
			Allowed:        false,
			RemainingTries: 0,
			LockedUntil:    &lockUntil,
			RetryAfterSecs: int(RateLimitLockout.Seconds()),
		}, nil
	}

	return &RateLimitResult{
		Allowed:        true,
		RemainingTries: RateLimitMaxAttempts - attempts - 1,
	}, nil
}

// RecordFailedAttempt increments the failure count and applies lockout if needed
func (s *SecurityService) RecordFailedAttempt(ctx context.Context, action, identifier string) (*RateLimitResult, error) {
	id := action + ":" + identifier
	expiresAt := time.Now().Add(RateLimitWindow)

	var attempts int
	var lockedUntil *time.Time

	// Upsert: increment attempts and check if lock is needed
	err := s.db.QueryRow(ctx, `
		INSERT INTO rate_limits (id, attempts, "expiresAt", "updatedAt")
		VALUES ($1, 1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET
			attempts = rate_limits.attempts + 1,
			"lockedUntil" = CASE
				WHEN rate_limits.attempts + 1 >= $3 THEN NOW() + INTERVAL '30 seconds'
				ELSE rate_limits."lockedUntil"
			END,
			"expiresAt" = $2,
			"updatedAt" = NOW()
		RETURNING attempts, "lockedUntil"
	`, id, expiresAt, RateLimitMaxAttempts).Scan(&attempts, &lockedUntil)

	if err != nil {
		return nil, err
	}

	result := &RateLimitResult{
		Allowed:        attempts < RateLimitMaxAttempts,
		RemainingTries: RateLimitMaxAttempts - attempts,
	}

	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		result.Allowed = false
		result.LockedUntil = lockedUntil
		result.RetryAfterSecs = int(time.Until(*lockedUntil).Seconds()) + 1
	}

	return result, nil
}

// ClearRateLimit clears rate limit on successful action (e.g., successful login)
func (s *SecurityService) ClearRateLimit(ctx context.Context, action, identifier string) error {
	id := action + ":" + identifier
	_, err := s.db.Exec(ctx, `DELETE FROM rate_limits WHERE id = $1`, id)
	return err
}

// CleanupExpiredRateLimits removes expired rate limit entries. Called on the
// cleanup ticker in main.go; without it rate_limits grows without bound.
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
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "userIp", "userAgent", details, "createdAt")
		VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW())
	`, entry.Action, entry.EntityType, entry.EntityID, entry.UserID, entry.UserIP, entry.UserAgent, entry.Details)
	return err
}
