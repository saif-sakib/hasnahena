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

// The revoke-all marker is WRITTEN by repositories.UserRepository — see
// RevokeAllUserTokens and UpdatePasswordAndRevokeSessions there. It moved out of
// this file because a password reset has to write the marker inside the same
// transaction as the password, and repositories are the only layer that owns a
// transaction. This file still reads it, below.

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

// ==================== RATE LIMITING ====================
//
// Backed by the `rate_limits` table rather than by memory, and the reasons are
// in middleware/ratelimit.go: this counter must survive a restart (a restart is
// not a reason to forget an attacker), it must be the same count on every
// instance, and it writes only on failure, which is rare.

// RateLimitAction names a throttled action. Every value is declared here and
// every one has a policy — `TestEveryRateLimitedActionIsDeclared` reads the
// source and fails on a bare string literal passed to one of these methods,
// because an action with no policy would silently get the default.
const (
	// RateLimitActionLogin counts failures against one identifier, wherever
	// they come from.
	RateLimitActionLogin = "login"

	// RateLimitActionLoginOrigin counts failures against one identifier from
	// one address.
	RateLimitActionLoginOrigin = "login-origin"

	// RateLimitActionForgotPassword counts reset requests for one identifier.
	RateLimitActionForgotPassword = "forgot-password"

	// RateLimitActionForgotPasswordOrigin counts reset requests from one
	// address, whatever identifiers they name.
	RateLimitActionForgotPasswordOrigin = "forgot-password-origin"
)

// RateLimitPolicy is how one action is throttled.
type RateLimitPolicy struct {
	// MaxAttempts failures are allowed before a lockout starts — and another
	// MaxAttempts after each lockout has been served.
	MaxAttempts int

	// Window is how long the counter outlives the last attempt (added on top of
	// any lockout still outstanding). It is what stops an attacker resetting
	// the escalation by waiting out one step.
	Window time.Duration

	// Steps are the lockout durations in order; the last repeats for ever. A
	// single-element Steps is a flat lockout that never escalates.
	Steps []time.Duration
}

// The policies.
//
// Login carries two, and that is the point of WO-89. The counter used to key on
// the identifier alone, which means an attacker who knows a member's phone
// number can hold them out of their own savings for as long as they keep
// guessing. At a flat 30 seconds that is a nuisance; at the one hour a
// sustained attack deserves, it is a weapon — so the escalation keys on the
// identifier *and the address*, and the identifier alone keeps the flat 30
// seconds it always had. A member logging in from their own phone is then
// unaffected by an attack from somewhere else, and the attacker's own bucket
// prices itself out within a few minutes.
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
	// A member asking for a reset link twice is normal; asking six times in a
	// quarter of an hour is not, and the email costs money either way.
	RateLimitActionForgotPassword: {
		MaxAttempts: 5,
		Window:      15 * time.Minute,
		Steps:       []time.Duration{15 * time.Minute},
	},
	// The enumeration limit. 20 per 10 minutes is the number
	// apps/web/app/api/v1/registrations/route.ts already settled on for the
	// same question — membership itself is the sensitive fact for a
	// religious-finance cooperative in one town — and answering it twice with
	// two different numbers would be worse than either.
	RateLimitActionForgotPasswordOrigin: {
		MaxAttempts: 20,
		Window:      10 * time.Minute,
		Steps:       []time.Duration{10 * time.Minute, time.Hour},
	},
}

// defaultRateLimitPolicy is what an unnamed action gets. It exists so a typo
// fails closed rather than unthrottled.
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

// lockoutFor reports how long the nth consecutive failure locks the caller out,
// and whether this failure starts a lockout at all.
//
// A lockout starts on every multiple of MaxAttempts and lengthens each time: 5
// wrong guesses cost the first step, the next 5 cost the second, and so on to
// the last, which repeats. Between multiples nothing new is set, so a member
// who mistypes once after serving a lockout is not punished for it — which is
// what "five guesses, wait, five more" has always meant, and what the flat
// version could not express.
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

	// Attempts is the failure count this result was computed from, and
	// Escalated says the lockout just moved past its first step. Together they
	// are the signal that an attack on one account is under way — which used to
	// be invisible to everyone, because a flat lockout looks the same on the
	// fifth failure as on the five-hundredth.
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

// CheckRateLimit reports whether an action is allowed for the given identifier.
//
// It refuses only while a lockout is actually outstanding. It used to *also*
// refuse whenever `attempts >= MaxAttempts`, which had two consequences worth
// naming, because both look like the code working: the RetryAfterSecs it
// answered with ("30 seconds") was a number nothing enforced — the real wait
// was however long the row had left to live — and a lockout could never be
// served, so escalating it would have meant nothing.
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

// RecordFailedAttempt increments the failure count and starts a lockout when
// this failure is the one that earns it.
//
// Two statements rather than one. The count is what has to be atomic, and the
// first statement makes it so; the length of the lockout is then pure
// arithmetic over that count (lockoutFor), which is testable without a database
// and readable without an array subscript inside a CASE.
func (s *SecurityService) RecordFailedAttempt(ctx context.Context, action, identifier string) (*RateLimitResult, error) {
	policy := policyFor(action)
	id := action + ":" + identifier

	var attempts int
	var lockedUntil *time.Time

	// GREATEST, so counting one more failure can never shorten a window that a
	// lockout has already extended.
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
		// The row has to outlive the lockout by a whole window, or serving the
		// longest step would delete the counter and hand the attacker a fresh
		// start at step one.
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

// RecordAttempt counts one attempt against a limit that has no notion of
// success. A password-reset request is throttled whether or not an account was
// found, because *whether one was found* is precisely the fact being protected;
// a limit that only counted misses would tell an attacker which was which by
// how fast they ran out.
func (s *SecurityService) RecordAttempt(ctx context.Context, action, identifier string) (*RateLimitResult, error) {
	return s.RecordFailedAttempt(ctx, action, identifier)
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
