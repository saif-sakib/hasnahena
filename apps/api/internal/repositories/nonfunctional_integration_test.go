//go:build integration

// TEST-31 and TEST-32 — load, and the query cost of a read.
//
// Phase 2 proved a single posting is correct and that concurrent postings do not
// lose money. What neither answers is what happens over a *sustained* run: a
// lost update that shows up once in a thousand postings is invisible to a test
// that posts twenty, and an N+1 query that is fine against fifty rows is a
// timeout against five thousand.
package repositories

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// TEST-31 — sustained load, and the ledger must still balance
// ---------------------------------------------------------------------------

// TestSustainedPostingsKeepTheLedgerBalanced runs a long mixed workload and then
// reconciles.
//
// The assertion is the one an auditor would make, not a performance number:
// after everything settles, `accounts."savingsBalance"` must equal the opening
// balance plus the sum of every confirmed transaction. Any drift means a posting
// changed a balance without a matching ledger row, or the reverse.
//
// Deliberately mixed and deliberately contended: several workers posting to the
// *same* member is the shape that found LEDGER-01, and it stays the shape most
// likely to find its successor.
func TestSustainedPostingsKeepTheLedgerBalanced(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	const members = 4
	const roundsPerWorker = 40
	const workers = 6
	const opening int64 = 500_000

	memberIDs := make([]string, members)
	for i := range members {
		memberIDs[i] = seedMember(t, fmt.Sprintf("m%d", i), fmt.Sprintf("ACC-KH-6%04d", i), opening)
	}
	staff := seedStaff(t, "w1", "WORKER")

	var deposits, withdrawals, refused atomic.Int64
	var wg sync.WaitGroup
	start := time.Now()

	for w := range workers {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for r := range roundsPerWorker {
				member := memberIDs[(w+r)%members]
				// Amounts vary so a wrong-but-consistent total cannot pass by
				// coincidence.
				amount := int64(100 + (w*7+r*13)%900)

				if r%3 == 0 {
					if _, err := repo.AddMemberWithdrawal(ctx, member, staff, amount, "load"); err != nil {
						refused.Add(1)
					} else {
						withdrawals.Add(amount)
					}
					continue
				}
				if _, err := repo.AddMemberDeposit(ctx, member, staff, amount, "load"); err != nil {
					refused.Add(1)
				} else {
					deposits.Add(amount)
				}
			}
		}(w)
	}
	wg.Wait()
	elapsed := time.Since(start)

	posted := workers*roundsPerWorker - int(refused.Load())
	t.Logf("%d postings in %s (%d refused), %.0f/s",
		posted, elapsed.Round(time.Millisecond), refused.Load(), float64(posted)/elapsed.Seconds())

	// Reconcile every account against its own ledger.
	for i, member := range memberIDs {
		var ledger int64
		if err := testPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE -amount END)::bigint, 0)
			FROM transactions
			WHERE "userId" = $1 AND type IN ('DEPOSIT', 'WITHDRAWAL') AND status = 'CONFIRMED'
		`, member).Scan(&ledger); err != nil {
			t.Fatalf("sum ledger for member %d: %v", i, err)
		}
		if got, want := savingsOf(t, member), opening+ledger; got != want {
			t.Fatalf("member %d: balance %d but opening %d + ledger %+d = %d — %d taka unaccounted for",
				i, got, opening, ledger, want, want-got)
		}
		if savingsOf(t, member) < 0 {
			t.Fatalf("member %d went negative under load", i)
		}
	}

	// And every posting left exactly one audit row, which is the invariant most
	// likely to slip under contention: an audit insert outside the transaction
	// would show up here as a mismatch.
	//
	// The action names are DEPOSIT_POSTED / WITHDRAWAL_POSTED. This first went in
	// guessing `_ADDED`, matched nothing, and reported "240 postings but 0 audit
	// rows" — a test that looked like it had found rule 2 broken under load when
	// it had found a typo. Read the strings out of the source, do not recall them.
	var auditRows int
	if err := testPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM audit_logs WHERE action IN ('DEPOSIT_POSTED', 'WITHDRAWAL_POSTED')
	`).Scan(&auditRows); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	var confirmed int
	if err := testPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM transactions
		WHERE type IN ('DEPOSIT', 'WITHDRAWAL') AND status = 'CONFIRMED'
	`).Scan(&confirmed); err != nil {
		t.Fatalf("count transactions: %v", err)
	}
	if auditRows != confirmed {
		t.Fatalf("%d confirmed postings but %d audit rows — rule 2 broke under load", confirmed, auditRows)
	}

	// Receipt numbers are handed to members on paper; two postings sharing one
	// is a reconciliation nobody can finish.
	var distinct, total int
	if err := testPool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT "receiptNumber"), COUNT("receiptNumber") FROM transactions
		WHERE "receiptNumber" IS NOT NULL
	`).Scan(&distinct, &total); err != nil {
		t.Fatalf("count receipts: %v", err)
	}
	if distinct != total {
		t.Fatalf("%d receipt numbers across %d postings — %d collided", distinct, total, total-distinct)
	}
}

// ---------------------------------------------------------------------------
// TEST-32 — query counts, so an N+1 fails the build
// ---------------------------------------------------------------------------

// countingTracer records every query a pool executes.
//
// pgx exposes this properly through QueryTracer, which is far better than
// reading pg_stat_statements: it counts what *this* call issued, not what the
// database has seen since it started.
type countingTracer struct {
	mu      sync.Mutex
	queries []string
}

func (c *countingTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.queries = append(c.queries, data.SQL)
	return ctx
}

func (c *countingTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func (c *countingTracer) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.queries)
}

func (c *countingTracer) reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.queries = nil
}

// sql returns a copy of every statement seen since the last reset.
func (c *countingTracer) sql() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, len(c.queries))
	copy(out, c.queries)
	return out
}

// tracedRepo builds a second pool with a tracer attached, so query counting does
// not disturb the shared pool every other test uses.
func tracedRepo(t *testing.T) (*UserRepository, *countingTracer) {
	t.Helper()
	tracer := &countingTracer{}

	cfg, err := pgxpool.ParseConfig(testPool.Config().ConnString())
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	cfg.ConnConfig.Tracer = tracer
	// One connection: a pool that opens a second connection mid-test would run
	// its setup queries through the tracer and inflate the count.
	cfg.MaxConns = 1

	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("traced pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return NewUserRepository(pool), tracer
}

// TestListReadsDoNotScaleWithRowCount is the N+1 guard.
//
// The property is not "few queries" but "the same number of queries for ten rows
// as for a hundred". An N+1 is invisible on a seeded test database and is a
// timeout on a real one, and it is the single most common way a page that worked
// in Jashore stops working once the cooperative has grown.
func TestListReadsDoNotScaleWithRowCount(t *testing.T) {
	reads := []struct {
		name string
		call func(ctx context.Context, repo *UserRepository) error
	}{
		{"GetMembersList", func(ctx context.Context, repo *UserRepository) error {
			_, err := repo.GetMembersList(ctx, false)
			return err
		}},
		{"GetWorkerDashboard", func(ctx context.Context, repo *UserRepository) error {
			_, err := repo.GetWorkerDashboard(ctx)
			return err
		}},
		{"GetDonations", func(ctx context.Context, repo *UserRepository) error {
			_, err := repo.GetDonations(ctx)
			return err
		}},
	}

	for _, read := range reads {
		t.Run(read.name, func(t *testing.T) {
			ctx := context.Background()

			// Ten rows.
			newTestRepo(t)
			repo, tracer := tracedRepo(t)
			for i := range 10 {
				seedMember(t, fmt.Sprintf("s%d", i), fmt.Sprintf("ACC-KH-7%04d", i), 1000)
			}
			tracer.reset()
			if err := read.call(ctx, repo); err != nil {
				t.Fatalf("%s with 10 rows: %v", read.name, err)
			}
			small := tracer.count()

			// Forty rows, same call.
			newTestRepo(t)
			repo2, tracer2 := tracedRepo(t)
			for i := range 40 {
				seedMember(t, fmt.Sprintf("l%d", i), fmt.Sprintf("ACC-KH-8%04d", i), 1000)
			}
			tracer2.reset()
			if err := read.call(ctx, repo2); err != nil {
				t.Fatalf("%s with 40 rows: %v", read.name, err)
			}
			large := tracer2.count()

			t.Logf("%s: %d queries for 10 rows, %d for 40", read.name, small, large)
			if large != small {
				t.Fatalf("%s issues %d queries for 10 rows and %d for 40 — it scales with row count (N+1). "+
					"Fold the per-row lookup into the list query with a JOIN or an aggregate.",
					read.name, small, large)
			}
			// A read that needs a double-digit number of round trips is a
			// latency problem even without N+1, on a database an ocean away.
			if small > 8 {
				t.Errorf("%s issues %d queries for one page of results; that is a lot of round trips", read.name, small)
			}
		})
	}
}

// TestMemberDashboardQueryCountIsFlat is the same guard for the read a member
// hits most often, where the row count that grows is their own history.
func TestMemberDashboardQueryCountIsFlat(t *testing.T) {
	ctx := context.Background()

	measure := func(transactions int) int {
		newTestRepo(t)
		repo, tracer := tracedRepo(t)
		member := seedMember(t, "m1", "ACC-KH-90001", 100_000)
		staff := seedStaff(t, "w1", "WORKER")
		for range transactions {
			if _, err := repo.AddMemberDeposit(ctx, member, staff, 100, "history"); err != nil {
				t.Fatalf("seed history: %v", err)
			}
		}
		tracer.reset()
		if _, err := repo.GetMemberDashboardData(ctx, member); err != nil {
			t.Fatalf("member dashboard: %v", err)
		}
		return tracer.count()
	}

	few := measure(3)
	many := measure(25)
	t.Logf("GetMemberDashboardData: %d queries over 3 transactions, %d over 25", few, many)
	if many != few {
		t.Fatalf("GetMemberDashboardData issues %d queries for 3 transactions and %d for 25 — it scales with history",
			few, many)
	}
}

// ---------------------------------------------------------------------------
// WO-75 — the hot reads name their columns
// ---------------------------------------------------------------------------

// TestHotReadsDoNotSelectStar is the payload half of the two guards above.
//
// The query-count tests answer "how many round trips"; this answers "how much
// comes back on each". They are different failures with the same cause — a read
// written quickly and never looked at again — and only one of them is visible
// in a timing.
//
// `SELECT *` on this schema is not a small waste. `users` carries the address,
// both parents' names, the NID number and the photo URL; the member dashboard
// needs a name and a balance. Every one of those columns crosses an ocean from
// Neon on every page view, and the day someone adds a column to `users` the
// payload of every read that never named its columns grows with it, silently.
//
// Deliberately a *pattern* check rather than a column budget. A budget would
// need updating whenever a screen legitimately needs one more field, so it
// would be raised rather than examined. "Name your columns" needs no
// maintenance and fails only on the thing that is actually wrong.
func TestHotReadsDoNotSelectStar(t *testing.T) {
	ctx := context.Background()

	reads := []struct {
		name string
		call func(ctx context.Context, repo *UserRepository, memberID string) error
	}{
		{"GetMemberDashboardData", func(ctx context.Context, repo *UserRepository, memberID string) error {
			_, err := repo.GetMemberDashboardData(ctx, memberID)
			return err
		}},
		{"GetMembersList", func(ctx context.Context, repo *UserRepository, _ string) error {
			_, err := repo.GetMembersList(ctx, false)
			return err
		}},
		{"GetWorkerDashboard", func(ctx context.Context, repo *UserRepository, _ string) error {
			_, err := repo.GetWorkerDashboard(ctx)
			return err
		}},
		{"GetDonations", func(ctx context.Context, repo *UserRepository, _ string) error {
			_, err := repo.GetDonations(ctx)
			return err
		}},
		{"GetMemberTransactions", func(ctx context.Context, repo *UserRepository, memberID string) error {
			_, err := repo.GetMemberTransactions(ctx, memberID)
			return err
		}},
	}

	for _, read := range reads {
		t.Run(read.name, func(t *testing.T) {
			newTestRepo(t)
			repo, tracer := tracedRepo(t)
			member := seedMember(t, "star1", "ACC-KH-95001", 100_000)
			tracer.reset()

			if err := read.call(ctx, repo, member); err != nil {
				t.Fatalf("%s: %v", read.name, err)
			}

			statements := tracer.sql()
			if len(statements) == 0 {
				// A read that issues no query is a read that did not run, and
				// every assertion below would pass vacuously.
				t.Fatalf("%s issued no queries — the tracer is not seeing this call", read.name)
			}

			for _, statement := range statements {
				if selectsEveryColumn(statement) {
					t.Errorf("%s issues a SELECT * :\n\n%s\n\n"+
						"Name the columns the caller actually reads. On `users` that is the "+
						"difference between a name and a balance, and the member's address, "+
						"both parents' names, NID number and photo URL — on every page view, "+
						"and growing on its own whenever a column is added.",
						read.name, strings.TrimSpace(statement))
				}
			}
		})
	}
}

// selectsEveryColumn reports whether a statement contains a `SELECT *` or a
// `SELECT t.*` projection.
//
// Deliberately narrow. `COUNT(*)` is not a wide payload and is the right way to
// count rows; `EXISTS(SELECT 1 ...)` is fine; and a `*` inside a string literal
// or a comment is not a projection. Matching those would make this test
// something people work around rather than fix.
func selectsEveryColumn(statement string) bool {
	lowered := strings.ToLower(statement)
	for _, marker := range []string{"select *", "select\n\t*", "select all *"} {
		if strings.Contains(lowered, marker) {
			return true
		}
	}
	// `SELECT u.*`, `SELECT t.*, x.y` — an alias-qualified star.
	return aliasedStar.MatchString(lowered)
}

// `select` … `<alias>.*`, allowing for a leading DISTINCT and arbitrary
// whitespace. Anchored on the projection so a `*` in a WHERE clause or a
// multiplication does not match.
var aliasedStar = regexp.MustCompile(`select\s+(distinct\s+)?([a-z_][a-z0-9_]*\s*,\s*)*[a-z_][a-z0-9_]*\.\*`)

// TestSelectStarDetectorItself guards the guard.
//
// The check above is a regex over SQL, and a regex over SQL is exactly the kind
// of thing that quietly stops matching. Worse, it fails *open*: a pattern that
// matches nothing makes every subtest above pass while checking nothing at all.
// The false-positive cases matter as much as the true ones — a check that
// flagged `COUNT(*)` would be worked around rather than obeyed.
func TestSelectStarDetectorItself(t *testing.T) {
	cases := []struct {
		sql  string
		want bool
	}{
		{`SELECT * FROM users WHERE id = $1`, true},
		{`select * from users`, true},
		{`SELECT u.* FROM users u`, true},
		{`SELECT DISTINCT u.* FROM users u`, true},
		{`SELECT id, u.* FROM users u`, true},
		{`SELECT "id", "nameEn" FROM users`, false},
		// Counting rows is not a wide payload, and this is the right way to do it.
		{`SELECT COUNT(*) FROM transactions`, false},
		{`SELECT EXISTS(SELECT 1 FROM loans WHERE id = $1)`, false},
		// Multiplication, not a projection.
		{`SELECT amount * 2 FROM transactions`, false},
		// A star inside a string literal is not a projection either.
		{`SELECT id FROM t WHERE note = 'a * b'`, false},
	}
	for _, tc := range cases {
		if got := selectsEveryColumn(tc.sql); got != tc.want {
			t.Errorf("selectsEveryColumn(%q) = %v, want %v", tc.sql, got, tc.want)
		}
	}
}
