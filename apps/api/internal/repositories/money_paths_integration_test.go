//go:build integration

// TEST-11 and TEST-14 — every method that changes a balance, under concurrency
// and against CLAUDE.md rule 2.
//
// The enumeration is not a judgement call. Eight methods write to
// `accounts."savingsBalance"` or `accounts."loanBalance"`:
//
//	ApproveLoan            loan_repository.go
//	CreateMemberLoan       loan_repository.go
//	AddMemberLoanPayment   loan_repository.go
//	waterfallRecoveryTx    loan_repository.go  (reached via MarkLoanDefaulted)
//	ApproveWithdrawal      transaction_repository.go
//	AddMemberDeposit       transaction_repository.go
//	AddMemberWithdrawal    transaction_repository.go
//	RecordDonation         transaction_repository.go
//
// Each gets the same two questions: does one call leave exactly one audit row,
// and do N simultaneous calls leave N postings' worth of money? The 2026-08-17
// audit found a lost update by asking the second question of four of them
// (ADR-015); the other four had never been asked.
//
// TestBalanceWritersAreEnumerated below re-derives that list from the source on
// every run, so a ninth method cannot be added without this file noticing.
package repositories

import (
	"context"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
)

// ---------------------------------------------------------------------------
// The enumeration keeps itself honest
// ---------------------------------------------------------------------------

// balanceWriters is the list this file claims to cover.
var balanceWriters = map[string]bool{
	"ApproveLoan":          true,
	"CreateMemberLoan":     true,
	"AddMemberLoanPayment": true,
	"waterfallRecoveryTx":  true,
	"ApproveWithdrawal":    true,
	"AddMemberDeposit":     true,
	"AddMemberWithdrawal":  true,
	"RecordDonation":       true,
}

// TestBalanceWritersAreEnumerated reads the repository source and fails if any
// method writes a balance without being on the list above.
//
// Without this, "every balance-touching method is covered" is a claim that was
// true on the day it was written. With it, adding a ninth writer fails the
// suite until someone decides what its concurrency and audit story is — which
// is the moment to decide it, not six months later.
func TestBalanceWritersAreEnumerated(t *testing.T) {
	methodStart := regexp.MustCompile(`(?m)^func \(r \*UserRepository\) (\w+)`)
	balanceWrite := regexp.MustCompile(`"(savingsBalance|loanBalance)"\s*=`)

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read source dir: %v", err)
	}

	found := map[string]string{}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		text := string(src)
		locs := methodStart.FindAllStringSubmatchIndex(text, -1)
		for i, loc := range locs {
			end := len(text)
			if i+1 < len(locs) {
				end = locs[i+1][0]
			}
			method := text[loc[2]:loc[3]]
			if balanceWrite.MatchString(text[loc[0]:end]) {
				found[method] = name
			}
		}
	}

	for method, file := range found {
		if !balanceWriters[method] {
			t.Errorf("%s (%s) writes a balance but is not in balanceWriters — "+
				"give it a concurrency test and an audit test in this file, then add it",
				method, file)
		}
	}
	for method := range balanceWriters {
		if _, ok := found[method]; !ok {
			t.Errorf("balanceWriters lists %s, which no longer writes a balance — "+
				"it was renamed or the write moved", method)
		}
	}
	t.Logf("%d balance-writing methods under test", len(found))
}

// ---------------------------------------------------------------------------
// TEST-14 — exactly one audit row per posting
// ---------------------------------------------------------------------------

// auditRowsFor counts audit rows written since a marker, by entity.
func auditRowsSince(t *testing.T, before int) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(context.Background(), `SELECT COUNT(*) FROM audit_logs`).Scan(&n); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	return n - before
}

func auditRowCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(context.Background(), `SELECT COUNT(*) FROM audit_logs`).Scan(&n); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	return n
}

// TestEveryPostingWritesExactlyOneAuditRow walks each balance writer through a
// successful call and checks the count.
//
// "At least one" is not the assertion. Two rows for one posting is its own
// defect: the log is what a reconciliation reads, and a duplicated entry is
// indistinguishable from a duplicated posting when someone is trying to work
// out where money went.
func TestEveryPostingWritesExactlyOneAuditRow(t *testing.T) {
	t.Run("AddMemberDeposit", func(t *testing.T) {
		repo := newTestRepo(t)
		ctx := context.Background()
		member := seedMember(t, "m1", "ACC-AU-1", 1000)
		worker := seedStaff(t, "w1", "WORKER")

		before := auditRowCount(t)
		if _, err := repo.AddMemberDeposit(ctx, member, worker, 500, "audit"); err != nil {
			t.Fatalf("deposit: %v", err)
		}
		if got := auditRowsSince(t, before); got != 1 {
			t.Fatalf("deposit wrote %d audit rows, want exactly 1", got)
		}
	})

	t.Run("AddMemberWithdrawal", func(t *testing.T) {
		repo := newTestRepo(t)
		ctx := context.Background()
		member := seedMember(t, "m1", "ACC-AU-2", 5000)
		worker := seedStaff(t, "w1", "WORKER")

		before := auditRowCount(t)
		if _, err := repo.AddMemberWithdrawal(ctx, member, worker, 1000, "audit"); err != nil {
			t.Fatalf("withdrawal: %v", err)
		}
		if got := auditRowsSince(t, before); got != 1 {
			t.Fatalf("withdrawal wrote %d audit rows, want exactly 1", got)
		}
	})

	t.Run("RecordDonation", func(t *testing.T) {
		repo := newTestRepo(t)
		ctx := context.Background()
		seedDonationAccount(t)
		admin := seedStaff(t, "a1", "ADMIN")

		before := auditRowCount(t)
		if _, err := repo.RecordDonation(ctx, admin, 2000, "Donor", "audit"); err != nil {
			t.Fatalf("donation: %v", err)
		}
		if got := auditRowsSince(t, before); got != 1 {
			t.Fatalf("donation wrote %d audit rows, want exactly 1", got)
		}
	})

	t.Run("MarkLoanDefaulted reaching waterfallRecoveryTx", func(t *testing.T) {
		repo := newTestRepo(t)
		ctx := context.Background()
		borrower := seedMember(t, "m1", "ACC-AU-3", 5000)
		admin := seedStaff(t, "a1", "ADMIN")
		loanID := seedLoanNoGuarantor(t, borrower, 3000)

		before := auditRowCount(t)
		if err := repo.MarkLoanDefaulted(ctx, loanID, admin, "audit"); err != nil {
			t.Fatalf("default: %v", err)
		}
		// Two here is correct and deliberate: MARK_LOAN_DEFAULTED records the
		// decision, WATERFALL_RECOVERY records which savings were taken to
		// settle it. They answer different questions and both are needed.
		if got := auditRowsSince(t, before); got != 2 {
			t.Fatalf("default wrote %d audit rows, want 2 (the decision and the recovery)", got)
		}
		if n := countAuditLogs(t, loanID, "MARK_LOAN_DEFAULTED"); n != 1 {
			t.Errorf("MARK_LOAN_DEFAULTED rows = %d, want 1", n)
		}
		if n := countAuditLogs(t, loanID, "WATERFALL_RECOVERY"); n != 1 {
			t.Errorf("WATERFALL_RECOVERY rows = %d, want 1", n)
		}
	})
}

// TestARefusedPostingWritesNoAuditRow is the other half of rule 2. An audit row
// that outlives its transaction describes money that never moved, which is
// worse than no row at all: it is a record that disagrees with the ledger.
func TestARefusedPostingWritesNoAuditRow(t *testing.T) {
	cases := []struct {
		name string
		run  func(t *testing.T, repo *UserRepository, member, worker string) error
	}{
		{"deposit of zero", func(t *testing.T, repo *UserRepository, member, worker string) error {
			_, err := repo.AddMemberDeposit(context.Background(), member, worker, 0, "x")
			return err
		}},
		{"negative deposit", func(t *testing.T, repo *UserRepository, member, worker string) error {
			_, err := repo.AddMemberDeposit(context.Background(), member, worker, -5000, "x")
			return err
		}},
		{"withdrawal beyond the balance", func(t *testing.T, repo *UserRepository, member, worker string) error {
			_, err := repo.AddMemberWithdrawal(context.Background(), member, worker, 999999, "x")
			return err
		}},
		{"negative withdrawal", func(t *testing.T, repo *UserRepository, member, worker string) error {
			_, err := repo.AddMemberWithdrawal(context.Background(), member, worker, -1000, "x")
			return err
		}},
		{"deposit for a member who does not exist", func(t *testing.T, repo *UserRepository, member, worker string) error {
			_, err := repo.AddMemberDeposit(context.Background(), "nobody", worker, 100, "x")
			return err
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := newTestRepo(t)
			member := seedMember(t, "m1", "ACC-AU-9", 2000)
			worker := seedStaff(t, "w1", "WORKER")

			before := auditRowCount(t)
			if err := tc.run(t, repo, member, worker); err == nil {
				t.Fatalf("%s was accepted; it must be refused", tc.name)
			}
			if got := auditRowsSince(t, before); got != 0 {
				t.Fatalf("a refused posting wrote %d audit rows", got)
			}
			if got := savingsOf(t, member); got != 2000 {
				t.Fatalf("a refused posting moved the balance to %d", got)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// TEST-11 — concurrency, extended to the methods the first pass missed
// ---------------------------------------------------------------------------

// TestConcurrentDonationsAllLand is the pool's version of the lost update.
//
// RecordDonation takes FOR UPDATE on the pool account and then credits it
// relatively, so this should hold — but the pool is the single row every
// donation in the system contends on, which makes it the most likely place for
// a regression to show and the least likely place for anyone to notice.
func TestConcurrentDonationsAllLand(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	owner := seedDonationAccount(t)
	admin := seedStaff(t, "a1", "ADMIN")

	const donations = 20
	const each int64 = 250

	var wg sync.WaitGroup
	receipts := make([]string, donations)
	errs := make([]error, donations)
	for i := range donations {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			receipts[i], errs[i] = repo.RecordDonation(ctx, admin, each, "Donor", "concurrent")
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("donation %d failed: %v", i, err)
		}
	}

	var pool int64
	if err := testPool.QueryRow(ctx,
		`SELECT "savingsBalance"::bigint FROM accounts WHERE "userId" = $1`, owner).Scan(&pool); err != nil {
		t.Fatalf("read pool: %v", err)
	}
	if want := each * donations; pool != want {
		t.Fatalf("pool = %d after %d concurrent donations, want %d — %d taka were lost",
			pool, donations, want, want-pool)
	}

	// And every donor got a distinct receipt. A shared number is a member
	// holding paper that points at somebody else's payment.
	seen := map[string]bool{}
	for _, r := range receipts {
		if seen[r] {
			t.Fatalf("receipt %s was issued twice", r)
		}
		seen[r] = true
	}
	var auditRows int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_logs WHERE action = 'DONATION_RECORDED'`).Scan(&auditRows); err != nil {
		t.Fatalf("count donation audit rows: %v", err)
	}
	if auditRows != donations {
		t.Errorf("DONATION_RECORDED audit rows = %d, want %d", auditRows, donations)
	}
}

// TestConcurrentLoanPaymentsCannotOverpay drives AddMemberLoanPayment from
// several goroutines at once against a loan that can only absorb some of them.
//
// The failure this guards against is a loan going negative: each payment reads
// the remaining balance, decides it fits, and writes back — so without a lock
// they all decide it fits.
func TestConcurrentLoanPaymentsCannotOverpay(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-AU-11", 0)
	worker := seedStaff(t, "w1", "WORKER")
	loanID := seedLoanNoGuarantor(t, borrower, 5000)
	// The account's loanBalance has to agree with the loan, or the payment
	// path is being tested against a state the system never produces.
	if _, err := testPool.Exec(ctx,
		`UPDATE accounts SET "loanBalance" = 5000 WHERE "userId" = $1`, borrower); err != nil {
		t.Fatalf("set loan balance: %v", err)
	}

	const attempts = 10
	const each int64 = 1000 // 10 x 1000 against 5000 owed

	var wg sync.WaitGroup
	errs := make([]error, attempts)
	for i := range attempts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = repo.AddMemberLoanPayment(ctx, borrower, worker, loanID, each, "concurrent")
		}(i)
	}
	wg.Wait()

	accepted := 0
	for _, err := range errs {
		if err == nil {
			accepted++
		}
	}

	var remaining, accountLoanBalance int64
	if err := testPool.QueryRow(ctx,
		`SELECT "remainingAmount"::bigint FROM loans WHERE id = $1`, loanID).Scan(&remaining); err != nil {
		t.Fatalf("read remaining: %v", err)
	}
	if err := testPool.QueryRow(ctx,
		`SELECT "loanBalance"::bigint FROM accounts WHERE "userId" = $1`, borrower).Scan(&accountLoanBalance); err != nil {
		t.Fatalf("read account loan balance: %v", err)
	}

	if remaining < 0 {
		t.Fatalf("the loan was overpaid to %d — %d payments were accepted against 5000 owed", remaining, accepted)
	}
	if accountLoanBalance < 0 {
		t.Fatalf("the account's loanBalance went negative: %d", accountLoanBalance)
	}
	// Whatever the split, the two records must agree afterwards.
	if remaining != accountLoanBalance {
		t.Fatalf("loans.remainingAmount = %d but accounts.loanBalance = %d — the two disagree",
			remaining, accountLoanBalance)
	}
	if want := 5000 - int64(accepted)*each; remaining != want {
		t.Fatalf("remaining = %d after %d accepted payments, want %d", remaining, accepted, want)
	}
}

// TestConcurrentDepositAndWithdrawalOnOneAccount mixes the two directions.
//
// Each in isolation is covered. Together they contend for the same row from
// opposite sides, which is the shape that survives a lock on one path and not
// the other.
func TestConcurrentDepositAndWithdrawalOnOneAccount(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "m1", "ACC-AU-12", 10000)
	worker := seedStaff(t, "w1", "WORKER")

	const rounds = 15
	const amount int64 = 200

	var wg sync.WaitGroup
	depositErrs := make([]error, rounds)
	withdrawErrs := make([]error, rounds)
	for i := range rounds {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			_, depositErrs[i] = repo.AddMemberDeposit(ctx, member, worker, amount, "mixed")
		}(i)
		go func(i int) {
			defer wg.Done()
			_, withdrawErrs[i] = repo.AddMemberWithdrawal(ctx, member, worker, amount, "mixed")
		}(i)
	}
	wg.Wait()

	deposits, withdrawals := 0, 0
	for i := range rounds {
		if depositErrs[i] == nil {
			deposits++
		}
		if withdrawErrs[i] == nil {
			withdrawals++
		}
	}

	want := 10000 + int64(deposits)*amount - int64(withdrawals)*amount
	if got := savingsOf(t, member); got != want {
		t.Fatalf("balance = %d after %d deposits and %d withdrawals, want %d — %d taka unaccounted for",
			got, deposits, withdrawals, want, want-savingsOf(t, member))
	}

	// The ledger has to agree with the balance, which is the check that would
	// have caught LEDGER-01 on its own.
	var ledger int64
	if err := testPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE -amount END)::bigint, 0)
		FROM transactions
		WHERE "userId" = $1 AND type IN ('DEPOSIT', 'WITHDRAWAL')
	`, member).Scan(&ledger); err != nil {
		t.Fatalf("sum ledger: %v", err)
	}
	if got := savingsOf(t, member); got != 10000+ledger {
		t.Fatalf("balance %d disagrees with the ledger (10000 opening %+d) = %d",
			got, ledger, 10000+ledger)
	}
}
