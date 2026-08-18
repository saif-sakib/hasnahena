//go:build integration

// Integration tests run against a real PostgreSQL database, because the things
// worth testing here — transactions, constraints, the waterfall's ordering —
// only exist in the database. They are behind a build tag so `go test ./...`
// stays fast and dependency-free for everyone else.
//
//	docker compose up -d db
//	TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hasnahena_test \
//	  pnpm --filter @hasnahena/web exec prisma db push
//	TEST_DATABASE_URL=... go test ./... -tags=integration
//
// The schema comes from `prisma db push`, not from these tests: the point is to
// exercise the schema the application actually deploys, including the defaults
// Prisma strips. See docs/data-model.md.
package repositories

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testPool is shared by every integration test; connecting per test would
// dominate the runtime.
var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		// Not a failure: a developer running the whole suite without a database
		// should get a skip, not a red build.
		os.Exit(0)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		panic("bad TEST_DATABASE_URL: " + err.Error())
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	// Same UTC pinning as main.go. Without it, timestamp comparisons in these
	// tests would depend on the machine's timezone — which is exactly the bug
	// documented in docs/data-model.md.
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"

	testPool, err = pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		panic("cannot connect to TEST_DATABASE_URL: " + err.Error())
	}
	if err := testPool.Ping(ctx); err != nil {
		panic("cannot ping TEST_DATABASE_URL: " + err.Error())
	}

	repo := NewUserRepository(testPool)
	if err := repo.EnsureSupportSchema(ctx); err != nil {
		panic("EnsureSupportSchema failed: " + err.Error())
	}

	code := m.Run()
	testPool.Close()
	os.Exit(code)
}

// newTestRepo gives each test a clean database. Truncating is faster than
// recreating the schema and keeps the tests independent of execution order.
func newTestRepo(t *testing.T) *UserRepository {
	t.Helper()
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}

	ctx := context.Background()
	_, err := testPool.Exec(ctx, `
		TRUNCATE TABLE
			audit_logs, transactions, loans, accounts,
			notifications, support_messages, support_threads,
			token_blacklist, rate_limits, document_sequences, sse_tickets,
			system_config,
			users
		RESTART IDENTITY CASCADE
	`)
	if err != nil {
		t.Fatalf("truncate failed: %v", err)
	}
	return NewUserRepository(testPool)
}

// seedMember inserts an ACTIVE member with an account at the given savings
// balance and returns the user id.
func seedMember(t *testing.T, id, memberID string, savings int64) string {
	t.Helper()
	ctx := context.Background()

	_, err := testPool.Exec(ctx, `
		INSERT INTO users (id, email, phone, "passwordHash", role, status, "memberId",
			"nameEn", "fatherName", "motherName", gender, "maritalStatus", "childrenCount",
			"createdAt", "updatedAt")
		VALUES ($1, $1 || '@test.local', $2, 'x', 'MEMBER', 'ACTIVE', $3,
			'Test ' || $1, 'Father', 'Mother', 'MALE', 'MARRIED', 0, NOW(), NOW())
	`, id, "0170"+phoneSuffix(id), memberID)
	if err != nil {
		t.Fatalf("seed member %s: %v", id, err)
	}

	_, err = testPool.Exec(ctx, `
		INSERT INTO accounts (id, "savingsBalance", "loanBalance",
			"isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
		VALUES ('acct_' || $1, $2, 0, true, 0, NOW(), NOW(), $1)
	`, id, savings)
	if err != nil {
		t.Fatalf("seed account %s: %v", id, err)
	}
	return id
}

// seedStaff inserts an ACTIVE worker or admin, used as the actor on postings.
func seedStaff(t *testing.T, id, role string) string {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO users (id, email, phone, "passwordHash", role, status,
			"nameEn", "fatherName", "motherName", gender, "maritalStatus", "childrenCount",
			"createdAt", "updatedAt")
		VALUES ($1, $1 || '@test.local', $2, 'x', $3::"UserRole", 'ACTIVE',
			'Staff ' || $1, 'Father', 'Mother', 'MALE', 'MARRIED', 0, NOW(), NOW())
	`, id, "0180"+phoneSuffix(id), role)
	if err != nil {
		t.Fatalf("seed staff %s: %v", id, err)
	}
	return id
}

// phoneSuffix derives a stable unique 7-digit tail from an id, so seeded users
// never collide on the phone unique index.
func phoneSuffix(id string) string {
	sum := 0
	for _, r := range id {
		sum = (sum*31 + int(r)) % 10000000
	}
	digits := []byte("0000000")
	for i := 6; i >= 0; i-- {
		digits[i] = byte('0' + sum%10)
		sum /= 10
	}
	return string(digits)
}

// savingsOf reads a member's current savings balance.
func savingsOf(t *testing.T, userID string) int64 {
	t.Helper()
	var v int64
	err := testPool.QueryRow(context.Background(),
		`SELECT "savingsBalance"::bigint FROM accounts WHERE "userId" = $1`, userID).Scan(&v)
	if err != nil {
		t.Fatalf("read savings for %s: %v", userID, err)
	}
	return v
}

// loanBalanceOf reads a member's account-level loan balance.
func loanBalanceOf(t *testing.T, userID string) int64 {
	t.Helper()
	var v int64
	err := testPool.QueryRow(context.Background(),
		`SELECT "loanBalance"::bigint FROM accounts WHERE "userId" = $1`, userID).Scan(&v)
	if err != nil {
		t.Fatalf("read loan balance for %s: %v", userID, err)
	}
	return v
}

// giveMaturedWithdrawalNotice inserts a withdrawal notice that has already
// served its notice period, so a test can exercise the payout without waiting
// three months.
//
// FR-08 makes the notice a precondition of every payout: AddMemberWithdrawal
// settles a matured notice rather than originating a withdrawal. Tests that
// only care about balances still need one, which is what this is for. It writes
// the row directly rather than calling CreateMemberWithdrawalNotice, because
// that method stamps createdAt as NOW() and the whole point here is a backdated
// one.
func giveMaturedWithdrawalNotice(t *testing.T, memberID string, amount int64) string {
	t.Helper()
	var id string
	err := testPool.QueryRow(context.Background(), `
		INSERT INTO transactions (id, type, amount, description, status, "createdAt", "accountId", "userId")
		VALUES (gen_random_uuid()::text, 'WITHDRAWAL', $2, 'test notice', 'PENDING',
			NOW() - INTERVAL '12 months', 'acct_' || $1, $1)
		RETURNING id::text
	`, memberID, amount).Scan(&id)
	if err != nil {
		t.Fatalf("seed matured withdrawal notice for %s: %v", memberID, err)
	}
	return id
}

// setConfig writes a system_config key, used to exercise policy-driven branches.
func setConfig(t *testing.T, key, value string) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO system_config (id, key, value, "updatedAt")
		VALUES ('cfg_' || $1, $1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
	`, key, value)
	if err != nil {
		t.Fatalf("set config %s: %v", key, err)
	}
}

// countAuditLogs counts audit rows for an entity, optionally filtered by action.
func countAuditLogs(t *testing.T, entityID string, action string) int {
	t.Helper()
	var n int
	query := `SELECT COUNT(*) FROM audit_logs WHERE "entityId" = $1`
	args := []any{entityID}
	if action != "" {
		query += ` AND action = $2`
		args = append(args, action)
	}
	if err := testPool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count audit logs: %v", err)
	}
	return n
}
