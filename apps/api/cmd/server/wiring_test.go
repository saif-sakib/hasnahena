package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

// WO-53 / RUN-06: background loops must actually be started from main().
// Checked on the source (a deleted call is a syntactic fact), since starting
// the real loop in a test would hang the package.
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

	// Must be runCtx: a loop given the 10s startupCtx runs once and stops.
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

// A stack nobody mounts has no limiter, access log or CORS — and fails nothing.
func TestMiddlewareAndRoutesAreMounted(t *testing.T) {
	for _, fn := range []string{"mountMiddleware", "mountRoutes"} {
		if callInMain(t, fn) == nil {
			t.Errorf("main() does not call %s", fn)
		}
	}
}

// WO-82: nothing fails when the reconciliation job stops running.
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

// The reconciliation loop and its query layer contain no balance write (ADR-027).
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

// WO-93: a stopped retention sweep looks exactly like nothing to sweep.
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

// The sweep must never touch a balance.
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

// A fatal error must flush Sentry before os.Exit, which skips defers. Read as
// text: what matters is the order of three statements.
func TestFatalErrorsFlushSentryBeforeExiting(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}

	lines := strings.Split(string(source), "\n")
	checked := 0

	for i, line := range lines {
		if !strings.Contains(line, "os.Exit(1)") {
			continue
		}

		// The lines above an exit are its error; an exit without one is a
		// deliberate status code.
		start := i - 3
		if start < 0 {
			start = 0
		}
		preceding := strings.Join(lines[start:i], "\n")
		if !strings.Contains(preceding, "slog.Error") {
			continue
		}

		checked++
		if !strings.Contains(preceding, "observability.Flush()") {
			t.Errorf(
				"main.go:%d exits after logging an error without calling observability.Flush() first;\n"+
					"the event is buffered and os.Exit discards it:\n%s",
				i+1, preceding,
			)
		}
	}

	// A census that silently matches nothing is the defect it exists to catch.
	if checked == 0 {
		t.Fatal("found no fatal exit to check — has main.go stopped exiting on error?")
	}
}
