package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

// WO-53 / RUN-06. `CleanupExpiredTokens` and `CleanupExpiredRateLimits` existed,
// were exported, were correct, and were called by nothing for months. They
// looked exactly like working code, and `token_blacklist` and `rate_limits`
// grew the whole time. The behaviour of the sweep is proved in
// internal/services/cleanup_integration_test.go; what that cannot prove is that
// anything starts it.
//
// Reading the source rather than the runtime is deliberate: starting the real
// loop in a test means owning its lifetime, and a loop nobody cancels hangs the
// package. The failure this guards against is a deleted call, which is a
// syntactic fact.
func mainFunc(t *testing.T) *ast.FuncDecl {
	t.Helper()

	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse main.go: %v", err)
	}
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Name.Name == "main" && fn.Recv == nil {
			return fn
		}
	}
	t.Fatal("main.go has no func main")
	return nil
}

// callInMain returns the arguments of the first call to name inside main().
func callInMain(t *testing.T, name string) []ast.Expr {
	t.Helper()

	var args []ast.Expr
	ast.Inspect(mainFunc(t), func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if ident, ok := call.Fun.(*ast.Ident); ok && ident.Name == name {
			args = call.Args
			return false
		}
		return true
	})
	return args
}

func TestCleanupLoopIsStarted(t *testing.T) {
	args := callInMain(t, "startCleanupLoop")
	if args == nil {
		t.Fatal("main() does not call startCleanupLoop — token_blacklist and rate_limits will grow " +
			"for the life of the deployment, with no error and no log line saying so (RUN-06)")
	}

	// A startup context is not a background context. main.go's startupCtx is a
	// ten-second timeout; a loop handed that one runs its first pass, returns,
	// and never ticks again — silently, which is indistinguishable from a
	// system with nothing to sweep.
	ctxArg, ok := args[0].(*ast.Ident)
	if !ok {
		t.Fatalf("startCleanupLoop's context argument is %T, expected an identifier", args[0])
	}
	if ctxArg.Name == "startupCtx" {
		t.Fatal("startCleanupLoop is given startupCtx, which expires ten seconds after boot: " +
			"the loop would run once and stop. Use runCtx.")
	}
	if ctxArg.Name != "runCtx" {
		t.Errorf("startCleanupLoop's context is %q; expected runCtx, the one cancelled on SIGTERM", ctxArg.Name)
	}
}

// The same class of defect, one layer up: the middleware stack is now built by
// mountMiddleware, and a stack nobody mounts is a process with no rate limiter,
// no access log and no CORS — none of which fails a request.
func TestMiddlewareAndRoutesAreMounted(t *testing.T) {
	for _, fn := range []string{"mountMiddleware", "mountRoutes"} {
		if callInMain(t, fn) == nil {
			t.Errorf("main() does not call %s", fn)
		}
	}
}

// WO-82. The reconciliation job is the strongest guard the ledger has, and it
// is also the easiest one to lose: nothing fails when it stops running. Every
// balance still reads correctly, every request still returns 200, and the
// gauges keep their last value — which is why `hasnahena_ledger_reconciled_
// timestamp_seconds` exists and why this test does.
func TestReconciliationLoopIsStarted(t *testing.T) {
	args := callInMain(t, "startReconciliationLoop")
	if args == nil {
		t.Fatal("main() does not call startReconciliationLoop — the ledger is never summed and " +
			"compared to the stored balances, so a lost update is found in an audit months later " +
			"rather than within the hour (WO-82/OPS-07)")
	}

	ctxArg, ok := args[0].(*ast.Ident)
	if !ok {
		t.Fatalf("startReconciliationLoop's context argument is %T, expected an identifier", args[0])
	}
	if ctxArg.Name == "startupCtx" {
		t.Fatal("startReconciliationLoop is given startupCtx, which expires ten seconds after boot: " +
			"the ledger would be reconciled once per deploy and never again. Use runCtx.")
	}
	if ctxArg.Name != "runCtx" {
		t.Errorf("startReconciliationLoop's context is %q; expected runCtx", ctxArg.Name)
	}
}

// The job's whole value is that it reports rather than repairs. An automated
// correction to a ledger is a second defect written on top of the first, and it
// destroys the evidence needed to understand the first — so the loop, and the
// query layer under it, must contain no write to a balance.
//
// Reading the source rather than the behaviour is deliberate: proving "it never
// writes" from the outside means enumerating every path it could take.
func TestReconciliationNeverCorrects(t *testing.T) {
	for _, file := range []string{"main.go", "../../internal/repositories/reconcile_repository.go"} {
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		text := string(source)

		start := strings.Index(text, "func startReconciliationLoop")
		if file != "main.go" {
			start = 0
		} else if start < 0 {
			t.Fatal("main.go has no startReconciliationLoop")
		}
		region := text[start:]

		for _, forbidden := range []string{
			`UPDATE accounts`,
			`UPDATE loans`,
			`UPDATE transactions`,
			`"savingsBalance" =`,
			`"loanBalance" =`,
			`"remainingAmount" =`,
		} {
			if strings.Contains(region, forbidden) {
				t.Errorf("%s: reconciliation contains %q. It reports drift; it must never correct it "+
					"(WO-82). The one INSERT it is allowed is the append-only audit row.", file, forbidden)
			}
		}
	}
}

// WO-93. The retention sweep is the whole of FR-23's second half: nothing else
// removes a rejected applicant's NID number, and nobody would notice it had
// stopped, because "no rows swept" and "the loop is not running" produce the
// same silence.
func TestRetentionSweepLoopIsStarted(t *testing.T) {
	args := callInMain(t, "startRetentionSweepLoop")
	if args == nil {
		t.Fatal("main() does not call startRetentionSweepLoop — a rejected applicant's NID number, " +
			"photograph, addresses and parents' names are then kept forever, which is the state " +
			"WO-93 and ADR-033 exist to end")
	}

	ctxArg, ok := args[0].(*ast.Ident)
	if !ok {
		t.Fatalf("startRetentionSweepLoop's context argument is %T, expected an identifier", args[0])
	}
	if ctxArg.Name == "startupCtx" {
		t.Fatal("startRetentionSweepLoop is given startupCtx, which expires ten seconds after boot: " +
			"the sweep would run once per deploy and never again. Use runCtx.")
	}
	if ctxArg.Name != "runCtx" {
		t.Errorf("startRetentionSweepLoop's context is %q; expected runCtx", ctxArg.Name)
	}
}

// The sweep touches `users`, which is one row away from `accounts`. It must
// never touch a balance, for the same reason reconciliation must not: a
// background job with no operator watching is the worst possible place for a
// write to money to happen.
func TestRetentionSweepNeverTouchesMoney(t *testing.T) {
	for _, file := range []string{"main.go", "../../internal/repositories/retention_repository.go"} {
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		text := string(source)

		start := 0
		if file == "main.go" {
			start = strings.Index(text, "func startRetentionSweepLoop")
			if start < 0 {
				t.Fatal("main.go has no startRetentionSweepLoop")
			}
		}
		region := text[start:]

		for _, forbidden := range []string{
			`UPDATE accounts`,
			`UPDATE transactions`,
			`UPDATE loans`,
			`DELETE FROM accounts`,
			`DELETE FROM transactions`,
			`DELETE FROM loans`,
			`DELETE FROM users`,
		} {
			if strings.Contains(region, forbidden) {
				t.Errorf("%s: the retention sweep contains %q. It clears identity columns on a "+
					"rejected application and nothing else — a rejected applicant has no postings, "+
					"and if one ever does, deleting them is a decision for a person (ADR-033).",
					file, forbidden)
			}
		}
	}
}
