//go:build integration

// TEST-33 — failure injection. A posting happens wholly or not at all, and a
// rollback leaves no audit row, notification or receipt number behind.
package repositories

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ledgerState is everything a posting is supposed to write, counted together.
type ledgerState struct {
	savings      int64
	transactions int
	auditRows    int
	receipts     int
}

func readLedgerState(t *testing.T, member string) ledgerState {
	t.Helper()
	ctx := context.Background()
	var s ledgerState
	s.savings = savingsOf(t, member)
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE "userId" = $1`, member).Scan(&s.transactions); err != nil {
		t.Fatalf("count transactions: %v", err)
	}
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_logs WHERE "entityId" = $1`, member).Scan(&s.auditRows); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if err := testPool.QueryRow(ctx,
		`SELECT COALESCE(MAX(counter), 0) FROM document_sequences`).Scan(&s.receipts); err != nil {
		t.Fatalf("read sequence: %v", err)
	}
	return s
}

// TestACancelledPostingLeavesNothingBehind cuts the context mid-flight.
func TestACancelledPostingLeavesNothingBehind(t *testing.T) {
	repo := newTestRepo(t)
	member := seedMember(t, "m1", "ACC-KH-95001", 10_000)
	worker := seedStaff(t, "w1", "WORKER")

	before := readLedgerState(t, member)

	// Cancelled before the call even reaches the database: the extreme case, and
	// the one a drain produces.
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repo.AddMemberDeposit(cancelled, member, worker, 5_000, "cancelled"); err == nil {
		t.Fatal("a deposit on a cancelled context reported success")
	}

	// And cancelled after a moment, so the transaction has plausibly opened.
	for _, delay := range []time.Duration{0, 100 * time.Microsecond, time.Millisecond, 5 * time.Millisecond} {
		ctx, cancelLater := context.WithTimeout(context.Background(), delay)
		_, err := repo.AddMemberDeposit(ctx, member, worker, 5_000, "timeout")
		cancelLater()
		// Either outcome is fine if complete; the reconciliation is the assertion.
		_ = err
	}

	after := readLedgerState(t, member)

	// However many of those completed, the balance and the ledger must agree.
	var ledger int64
	if err := testPool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE -amount END)::bigint, 0)
		FROM transactions
		WHERE "userId" = $1 AND status = 'CONFIRMED'
	`, member).Scan(&ledger); err != nil {
		t.Fatalf("sum ledger: %v", err)
	}
	if want := before.savings + ledger; after.savings != want {
		t.Fatalf("balance %d but opening %d %+d = %d — a partial posting survived",
			after.savings, before.savings, ledger, want)
	}

	// One audit row per posting that actually landed, and none for one that did
	// not (rule 2).
	if after.auditRows != after.transactions {
		t.Fatalf("%d transactions but %d audit rows — a cancelled posting left one or lost one",
			after.transactions, after.auditRows)
	}
}

// TestAFailedPostingConsumesNoReceiptNumber: rollback returns the number.
func TestAFailedPostingConsumesNoReceiptNumber(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	member := seedMember(t, "m1", "ACC-KH-95002", 10_000)
	worker := seedStaff(t, "w1", "WORKER")

	// One good posting, to bring the sequence into existence.
	if _, err := repo.AddMemberDeposit(ctx, member, worker, 100, "first"); err != nil {
		t.Fatalf("first deposit: %v", err)
	}
	var counterAfterFirst int
	if err := testPool.QueryRow(ctx,
		`SELECT counter FROM document_sequences WHERE series = 'DEP'`).Scan(&counterAfterFirst); err != nil {
		t.Fatalf("read counter: %v", err)
	}

	// Now several postings that must fail: over-withdrawal, then a member who
	// does not exist. Neither may advance the sequence.
	if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 999_999_999, "too much"); err == nil {
		t.Fatal("an over-withdrawal succeeded")
	}
	if _, err := repo.AddMemberDeposit(ctx, "nobody-at-all", worker, 100, "ghost"); err == nil {
		t.Fatal("a deposit for a nonexistent member succeeded")
	}

	var counterNow int
	if err := testPool.QueryRow(ctx,
		`SELECT counter FROM document_sequences WHERE series = 'DEP'`).Scan(&counterNow); err != nil {
		t.Fatalf("read counter: %v", err)
	}
	if counterNow != counterAfterFirst {
		t.Fatalf("the DEP counter moved from %d to %d across two failed postings — "+
			"failed postings are burning receipt numbers, so the printed sequence will have gaps",
			counterAfterFirst, counterNow)
	}

	// The next successful posting takes the very next number, with no gap.
	receipt, err := repo.AddMemberDeposit(ctx, member, worker, 100, "second")
	if err != nil {
		t.Fatalf("second deposit: %v", err)
	}
	var counterAfterSecond int
	if err := testPool.QueryRow(ctx,
		`SELECT counter FROM document_sequences WHERE series = 'DEP'`).Scan(&counterAfterSecond); err != nil {
		t.Fatalf("read counter: %v", err)
	}
	if counterAfterSecond != counterAfterFirst+1 {
		t.Fatalf("counter went %d -> %d, want a single step", counterAfterFirst, counterAfterSecond)
	}
	if receipt == "" {
		t.Fatal("a successful posting returned an empty receipt number")
	}
}

// TestARolledBackDefaultRecoversNothing: the waterfall leaves nothing behind.
func TestARolledBackDefaultRecoversNothing(t *testing.T) {
	repo := newTestRepo(t)
	borrower := seedMember(t, "m1", "ACC-KH-95003", 20_000)
	guarantor := seedMember(t, "m2", "ACC-KH-95004", 20_000)
	admin := seedStaff(t, "a1", "ADMIN")
	loanID := seedLoanWithGuarantor(t, borrower, guarantor, 15_000)

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()

	if err := repo.MarkLoanDefaulted(cancelled, loanID, admin, "cancelled"); err == nil {
		t.Fatal("defaulting a loan on a cancelled context reported success")
	}

	if got := savingsOf(t, borrower); got != 20_000 {
		t.Fatalf("borrower savings = %d after a cancelled default; %d taka were taken anyway", got, 20_000-got)
	}
	if got := savingsOf(t, guarantor); got != 20_000 {
		t.Fatalf("guarantor savings = %d after a cancelled default", got)
	}
	if got := statusOfLoan(t, loanID); got != "ACTIVE" {
		t.Fatalf("loan status = %s after a cancelled default, want ACTIVE", got)
	}
	if n := countAuditLogs(t, loanID, ""); n != 0 {
		t.Fatalf("a cancelled default left %d audit rows describing a recovery that did not happen", n)
	}
}

// TestTheEmailServiceBeingDownDoesNotBlockMoney: Brevo is not on the money path.
func TestTheEmailServiceBeingDownDoesNotBlockMoney(t *testing.T) {
	// The repository takes no email service at all; keep it that way.
	repo := newTestRepo(t)
	ctx := context.Background()
	member := seedMember(t, "m1", "ACC-KH-95005", 1_000)
	worker := seedStaff(t, "w1", "WORKER")

	receipt, err := repo.AddMemberDeposit(ctx, member, worker, 500, "no mail service configured")
	if err != nil {
		t.Fatalf("a deposit failed with no email service available: %v", err)
	}
	if receipt == "" {
		t.Fatal("no receipt number issued")
	}
	if got := savingsOf(t, member); got != 1_500 {
		t.Fatalf("balance = %d, want 1500", got)
	}

	// The in-app notification is written in the same transaction and is not a
	// network call, so it must be there.
	var notifications int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE "targetUserId" = $1`, member).Scan(&notifications); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if notifications == 0 {
		t.Error("the member was not notified in-app, so with mail down they have no record at all")
	}
}

// TestAnUnreachableDatabaseFailsClosed uses its own closed pool.
func TestAnUnreachableDatabaseFailsClosed(t *testing.T) {
	newTestRepo(t)
	member := seedMember(t, "m1", "ACC-KH-95006", 5_000)
	worker := seedStaff(t, "w1", "WORKER")

	cfg, err := pgxpool.ParseConfig(testPool.Config().ConnString())
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("second pool: %v", err)
	}
	repo := NewUserRepository(pool)
	pool.Close()

	if _, err := repo.AddMemberDeposit(context.Background(), member, worker, 1_000, "db gone"); err == nil {
		t.Fatal("a deposit against a closed pool reported success")
	}

	// Read back through the *working* pool: the balance must be untouched, and
	// no half-written row may exist.
	if got := savingsOf(t, member); got != 5_000 {
		t.Fatalf("balance = %d after a posting against a dead database, want 5000", got)
	}
	var rows int
	if err := testPool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM transactions WHERE "userId" = $1`, member).Scan(&rows); err != nil {
		t.Fatalf("count transactions: %v", err)
	}
	if rows != 0 {
		t.Fatalf("%d transaction rows exist for a posting that never reached the database", rows)
	}
}
