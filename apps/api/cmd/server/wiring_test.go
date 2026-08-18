package main

import (
	"go/ast"
	"go/parser"
	"go/token"
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
