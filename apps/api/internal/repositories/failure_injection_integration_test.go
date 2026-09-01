//go:build integration

// TEST-33 — failure injection. Every failure must fail *closed* and leave no
// orphan.
//
// The interesting failures are not the ones a handler checks for. They are the
// ones that happen halfway: the member's phone loses signal after the request is
// sent, the pooler drops the connection between the balance update and the
// ledger insert, the process is killed mid-deploy. In each case there are two
// acceptable outcomes — the whole posting happened, or none of it did — and one
// unacceptable one, which is half.
//
// A rolled-back posting that left an audit row behind is worse than a failed
// posting, because the log then describes money that never moved and nothing
// says which record to believe.
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

// TestACancelledPostingLeavesNothingBehind cuts the context while the posting is
// in flight.
//
// A cancelled context is how every real mid-flight failure reaches pgx: an HTTP
// client disconnecting, a request deadline expiring, the process draining on
// SIGTERM. pgx aborts the transaction, and the question this answers is whether
// anything escaped it.
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
		// Either outcome is legitimate — what matters is that whichever
		// happened, it happened completely. The reconciliation below is the
		// assertion, not the error.
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

// TestAFailedPostingConsumesNoReceiptNumber covers a subtler orphan.
//
// `nextDocumentNumber` increments a counter inside the posting's transaction, so
// a rollback should give the number back. If it did not — if the allocator ran
// on its own connection, say — every failed posting would burn a receipt number
// and the sequence a member sees on paper would have gaps nobody could explain
// during an audit.
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

// TestARolledBackDefaultRecoversNothing is the same property on the path with the
// most moving parts.
//
// The waterfall touches the loan, the borrower's account, the guarantor's
// account, the transactions table and two audit rows. If any of that can outlive
// a rollback, a member's savings are gone and no record explains why.
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

// TestTheEmailServiceBeingDownDoesNotBlockMoney is the third-party case.
//
// Brevo is not on the money path and must not become one. A worker standing at a
// member's door with no mail service still has to be able to record the deposit;
// the notification is a courtesy, the posting is the record.
func TestTheEmailServiceBeingDownDoesNotBlockMoney(t *testing.T) {
	// The repository takes no email service at all, which is the strongest form
	// of this guarantee: it cannot depend on one. This test exists to *hold*
	// that — if a posting ever grows an email call, it will need this nil and
	// will fail here rather than in production during an outage.
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

// TestAnUnreachableDatabaseFailsClosed is the "database gone" case.
//
// A pool of its own, closed deliberately: that is what a Neon restart or a
// pooler eviction looks like from the application's side. The shared testPool
// cannot be used because closing it would break every test after this one.
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
