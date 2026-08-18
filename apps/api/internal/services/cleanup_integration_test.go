//go:build integration

// WO-53 / RUN-06 — proof that the sweep sweeps.
//
// `startCleanupLoop` deletes expired `token_blacklist` and `rate_limits` rows
// every CLEANUP_INTERVAL. **A sweep that stops sweeping is completely silent**:
// no error, no log line worth noticing, just two write-heavy tables growing
// until a query gets slow months later. It is also the exact shape RUN-06 was
// written to fix — CleanupExpiredTokens and CleanupExpiredRateLimits sat
// written-and-never-called for months and looked like working code.
//
//	scripts/test-stack.sh up && eval "$(scripts/test-stack.sh env)"
//	cd apps/api && go test ./internal/services/ -tags=integration
package services

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	// Runs the package's other tests either way: they need no database, and a
	// missing TEST_DATABASE_URL must not silently skip them too.
	if url := os.Getenv("TEST_DATABASE_URL"); url != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		cfg, err := pgxpool.ParseConfig(url)
		if err != nil {
			panic("bad TEST_DATABASE_URL: " + err.Error())
		}
		cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
		cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"

		testPool, err = pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			panic("cannot connect to TEST_DATABASE_URL: " + err.Error())
		}
		if err := testPool.Ping(ctx); err != nil {
			panic("cannot ping TEST_DATABASE_URL: " + err.Error())
		}
	}

	code := m.Run()
	if testPool != nil {
		testPool.Close()
	}
	os.Exit(code)
}

// newTestSecurityService clears the two swept tables and returns a service over
// them. Only these two: other suites share this database and clearing their
// fixtures is how a test starts failing on package ordering.
func newTestSecurityService(t *testing.T) *SecurityService {
	t.Helper()
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	if _, err := testPool.Exec(context.Background(), `TRUNCATE TABLE token_blacklist, rate_limits`); err != nil {
		t.Fatalf("truncate failed: %v", err)
	}
	return NewSecurityService(testPool)
}

func seedBlacklistedToken(t *testing.T, id string, expiresAt time.Time) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO token_blacklist (id, "tokenHash", "userId", reason, "expiresAt", "createdAt")
		VALUES ($1, 'hash-' || $1, 'cleanup-user', 'logout', $2, NOW())
	`, id, expiresAt)
	if err != nil {
		t.Fatalf("seed token %s: %v", id, err)
	}
}

func seedRateLimit(t *testing.T, id string, expiresAt time.Time) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO rate_limits (id, attempts, "expiresAt", "updatedAt")
		VALUES ($1, 3, $2, NOW())
	`, id, expiresAt)
	if err != nil {
		t.Fatalf("seed rate limit %s: %v", id, err)
	}
}

func remainingIDs(t *testing.T, table string) []string {
	t.Helper()
	rows, err := testPool.Query(context.Background(), `SELECT id FROM `+table+` ORDER BY id`)
	if err != nil {
		t.Fatalf("read %s: %v", table, err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan %s: %v", table, err)
		}
		ids = append(ids, id)
	}
	return ids
}

func TestTheSweepRemovesExpiredRowsAndOnlyThose(t *testing.T) {
	security := newTestSecurityService(t)
	ctx := context.Background()

	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	seedBlacklistedToken(t, "tkn-expired-1", past)
	seedBlacklistedToken(t, "tkn-expired-2", time.Now().Add(-time.Minute))
	seedBlacklistedToken(t, "tkn-live", future)

	seedRateLimit(t, "login:expired-1", past)
	seedRateLimit(t, "login:live", future)

	tokens, err := security.CleanupExpiredTokens(ctx)
	if err != nil {
		t.Fatalf("CleanupExpiredTokens: %v", err)
	}
	if tokens != 2 {
		t.Errorf("swept %d blacklist rows, want 2", tokens)
	}

	limits, err := security.CleanupExpiredRateLimits(ctx)
	if err != nil {
		t.Fatalf("CleanupExpiredRateLimits: %v", err)
	}
	if limits != 1 {
		t.Errorf("swept %d rate limit rows, want 1", limits)
	}

	// A sweep that deletes too much is worse than one that deletes nothing: a
	// live blacklist row is a revoked session, and deleting it un-revokes a
	// token someone logged out — or an admin revoked.
	if got := remainingIDs(t, "token_blacklist"); len(got) != 1 || got[0] != "tkn-live" {
		t.Errorf("token_blacklist after sweep = %v, want [tkn-live]", got)
	}
	// A live rate-limit row is an attacker's lockout. Deleting it early hands
	// them a fresh allowance.
	if got := remainingIDs(t, "rate_limits"); len(got) != 1 || got[0] != "login:live" {
		t.Errorf("rate_limits after sweep = %v, want [login:live]", got)
	}
}

func TestTheSweepIsHarmlessWhenThereIsNothingToSweep(t *testing.T) {
	security := newTestSecurityService(t)
	ctx := context.Background()

	seedBlacklistedToken(t, "tkn-live", time.Now().Add(time.Hour))
	seedRateLimit(t, "login:live", time.Now().Add(time.Hour))

	for i := 0; i < 3; i++ {
		tokens, err := security.CleanupExpiredTokens(ctx)
		if err != nil || tokens != 0 {
			t.Fatalf("pass %d: swept %d tokens, err %v — want 0, nil", i, tokens, err)
		}
		limits, err := security.CleanupExpiredRateLimits(ctx)
		if err != nil || limits != 0 {
			t.Fatalf("pass %d: swept %d rate limits, err %v — want 0, nil", i, limits, err)
		}
	}

	if got := len(remainingIDs(t, "token_blacklist")); got != 1 {
		t.Errorf("token_blacklist has %d rows after three empty sweeps, want 1", got)
	}
}

// The loop wraps each pass in a one-minute context so a stuck delete cannot
// stack up behind the ticker. A cancelled context must therefore be an ordinary
// error — not a panic, and not a partial delete.
func TestACancelledSweepDeletesNothing(t *testing.T) {
	security := newTestSecurityService(t)

	seedBlacklistedToken(t, "tkn-expired", time.Now().Add(-time.Hour))
	seedRateLimit(t, "login:expired", time.Now().Add(-time.Hour))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := security.CleanupExpiredTokens(ctx); err == nil {
		t.Error("CleanupExpiredTokens on a cancelled context returned no error")
	}
	if _, err := security.CleanupExpiredRateLimits(ctx); err == nil {
		t.Error("CleanupExpiredRateLimits on a cancelled context returned no error")
	}

	// The rows are still there, to be swept on the next tick.
	if got := len(remainingIDs(t, "token_blacklist")); got != 1 {
		t.Errorf("token_blacklist has %d rows, want the 1 the cancelled sweep did not delete", got)
	}
	if got := len(remainingIDs(t, "rate_limits")); got != 1 {
		t.Errorf("rate_limits has %d rows, want the 1 the cancelled sweep did not delete", got)
	}
}
