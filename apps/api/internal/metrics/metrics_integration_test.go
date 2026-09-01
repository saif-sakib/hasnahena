//go:build integration

// The business gauges are aggregate SQL over `transactions` and `loans`, and
// SQL that nothing exercises is SQL that silently stops meaning what it says.
// The 48-hour boundary in particular is the kind of thing a later refactor
// rounds off without noticing.
//
//	TEST_DATABASE_URL=... go test ./... -tags=integration
package metrics

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
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		os.Exit(0) // A skip, not a red build, for anyone without a database.
	}

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
		panic("cannot connect: " + err.Error())
	}

	code := m.Run()
	testPool.Close()
	os.Exit(code)
}

func TestBusinessSnapshotCountsWhatItClaims(t *testing.T) {
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `
		TRUNCATE TABLE transactions, loans, accounts, users RESTART IDENTITY CASCADE
	`); err != nil {
		t.Fatalf("truncate: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO users (id, email, phone, "passwordHash", role, status, "accountNo",
			"nameEn", "fatherName", "motherName", gender, "maritalStatus", "childrenCount",
			"createdAt", "updatedAt")
		VALUES ('mu1', 'mu1@test.local', '01911111111', 'x', 'MEMBER', 'ACTIVE', 'HF-M1',
			'Metric One', 'F', 'M', 'MALE', 'MARRIED', 0, NOW(), NOW())
	`); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO accounts ("savingsBalance", "loanBalance",
			"createdAt", "updatedAt", "userId")
		VALUES (10000, 0, NOW(), NOW(), 'mu1')
	`); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	// Two stale, one fresh. The fresh one is the whole test: a posting made an
	// hour ago is not a backlog, and counting it would make the alert cry wolf
	// every single day.
	if _, err := testPool.Exec(ctx, `
		INSERT INTO transactions (id, type, amount, description, status, "processedAt", "createdAt", "userId")
		VALUES
			('mt1', 'DEPOSIT',    1000, 's', 'PROCESSED', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', 'mu1'),
			('mt2', 'DEPOSIT',    1000, 's', 'PROCESSED', NOW() - INTERVAL '49 hours', NOW() - INTERVAL '49 hours', 'mu1'),
			('mt3', 'DEPOSIT',    1000, 'f', 'PROCESSED', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour', 'mu1'),
			('mt4', 'WITHDRAWAL',  500, 'd', 'DISPUTED',  NOW(), NOW(), 'mu1'),
			('mt5', 'DEPOSIT',     700, 'p', 'PENDING',   NULL,  NOW(), 'mu1')
	`); err != nil {
		t.Fatalf("seed transactions: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO loans (id, "principalAmount", "remainingAmount",
			"totalInstallments", "installmentAmount", status, purpose,
			"createdAt", "updatedAt", "borrowerId")
		VALUES
			('LOAN-M-1', 9000, 9000, 3, 3000, 'ACTIVE',    'p', NOW(), NOW(), 'mu1'),
			('LOAN-M-2', 9000, 0,    3, 3000, 'COMPLETED', 'p', NOW(), NOW(), 'mu1')
	`); err != nil {
		t.Fatalf("seed loans: %v", err)
	}

	snap, err := readBusinessSnapshot(ctx, testPool)
	if err != nil {
		t.Fatalf("readBusinessSnapshot: %v", err)
	}

	if snap.UnconfirmedOver48h != 2 {
		t.Errorf("unconfirmed over 48h = %d, want 2 (the 1-hour-old posting must not count)", snap.UnconfirmedOver48h)
	}
	if snap.OpenDisputes != 1 {
		t.Errorf("open disputes = %d, want 1", snap.OpenDisputes)
	}
	if snap.Pending != 1 {
		t.Errorf("pending = %d, want 1", snap.Pending)
	}
	if snap.ActiveLoans != 1 {
		t.Errorf("active loans = %d, want 1 (COMPLETED must not count)", snap.ActiveLoans)
	}
	// mt3, mt4 and mt5 were created today; mt1 and mt2 were not.
	if got := snap.PostedToday["DEPOSIT"]; got != 2 {
		t.Errorf("deposits posted today = %d, want 2", got)
	}
	if got := snap.PostedToday["WITHDRAWAL"]; got != 1 {
		t.Errorf("withdrawals posted today = %d, want 1", got)
	}
}
