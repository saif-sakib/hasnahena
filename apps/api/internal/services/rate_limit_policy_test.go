package services

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// WO-85 — the revocation marker must outlive the tokens it revokes
// ---------------------------------------------------------------------------

// This test CANNOT be made red without changing a config default, and that is
// the point of writing it down.
//
// The marker used to be written with a hardcoded `INTERVAL '24 hours'`, which is
// exactly JWT_EXPIRY_SECONDS' default of 86400. It was safe only by coincidence:
// a marker is always created after the token it revokes, so it outlived it by
// the gap between the two. Raise JWT_EXPIRY_SECONDS past 86400 — a one-line
// change in a Render dashboard, with nothing anywhere warning against it — and
// revoked tokens come back to life when the marker expires first, silently, on
// both backends at once.
//
// Deriving the lifetime from the token lifetime is what removes the coincidence.
func TestTheRevocationMarkerOutlivesTheLongestIssuableToken(t *testing.T) {
	expiries := []int64{
		0,
		3600,      // an hour
		86400,     // the default
		86401,     // one second past the old hardcoded interval
		7 * 86400, // a week, which somebody will eventually ask for
	}

	for _, expiry := range expiries {
		ttl := revocationTTLFor(expiry)
		tokenLife := time.Duration(expiry) * time.Second
		if ttl <= tokenLife {
			t.Errorf("JWT_EXPIRY_SECONDS=%d gives a marker of %v for tokens that live %v — "+
				"every token issued before the marker comes back to life when it expires",
				expiry, ttl, tokenLife)
		}
	}
}

// ---------------------------------------------------------------------------
// WO-89 — the lockout escalates
// ---------------------------------------------------------------------------

func TestTheLockoutEscalatesOncePerRoundOfAttempts(t *testing.T) {
	policy := RateLimitPolicy{
		MaxAttempts: 5,
		Window:      15 * time.Minute,
		Steps:       []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute, time.Hour},
	}

	tests := []struct {
		attempts      int
		wantLocked    bool
		wantLockout   time.Duration
		wantEscalated bool
		why           string
	}{
		{1, false, 0, false, "one mistyped password locks nobody out"},
		{4, false, 0, false, "still inside the first allowance"},
		{5, true, 30 * time.Second, false, "the first lockout is as cheap as it always was"},
		{6, false, 0, false, "a single mistake after serving a lockout is not punished again"},
		{9, false, 0, false, "still inside the second allowance"},
		{10, true, 2 * time.Minute, true, "the second round costs more, and that is worth an audit row"},
		{15, true, 10 * time.Minute, true, "third"},
		{20, true, time.Hour, true, "fourth"},
		{25, true, time.Hour, true, "the last step repeats rather than overflowing"},
		{500, true, time.Hour, true, "and keeps repeating"},
	}

	for _, tc := range tests {
		lockout, escalated, locked := policy.lockoutFor(tc.attempts)
		if locked != tc.wantLocked {
			t.Errorf("attempts=%d locked=%v, want %v (%s)", tc.attempts, locked, tc.wantLocked, tc.why)
			continue
		}
		if lockout != tc.wantLockout {
			t.Errorf("attempts=%d lockout=%v, want %v (%s)", tc.attempts, lockout, tc.wantLockout, tc.why)
		}
		if escalated != tc.wantEscalated {
			t.Errorf("attempts=%d escalated=%v, want %v (%s)", tc.attempts, escalated, tc.wantEscalated, tc.why)
		}
	}
}

func TestRemainingTriesResetsAfterEachLockout(t *testing.T) {
	policy := RateLimitPolicy{MaxAttempts: 5}
	for attempts, want := range map[int]int{0: 5, 1: 4, 4: 1, 5: 5, 6: 4, 10: 5} {
		if got := policy.remainingTries(attempts); got != want {
			t.Errorf("remainingTries(%d) = %d, want %d", attempts, got, want)
		}
	}
}

// The tension WO-89 names, pinned in both directions. The counter keyed on the
// identifier alone is reachable by anybody who knows a member's phone number, so
// it must never grow into something that keeps that member out of their own
// savings for an hour. The pair must, or a sustained attack costs the attacker
// nothing.
func TestOnlyTheIdentifierAndAddressPairEscalates(t *testing.T) {
	flat := rateLimitPolicies[RateLimitActionLogin]
	if len(flat.Steps) != 1 {
		t.Fatalf("the identifier-alone login lockout has %d steps — escalating it hands an attacker "+
			"a way to lock a named member out of their savings for as long as they keep guessing",
			len(flat.Steps))
	}
	if flat.Steps[0] > time.Minute {
		t.Errorf("the identifier-alone lockout is %v; at that length it is a weapon against the member", flat.Steps[0])
	}

	pair := rateLimitPolicies[RateLimitActionLoginOrigin]
	if len(pair.Steps) < 2 {
		t.Fatalf("the identifier+address lockout has %d steps — without escalation a sustained attack "+
			"never costs more than the first lockout did", len(pair.Steps))
	}
	for i := 1; i < len(pair.Steps); i++ {
		if pair.Steps[i] <= pair.Steps[i-1] {
			t.Errorf("step %d (%v) is not longer than step %d (%v)", i+1, pair.Steps[i], i, pair.Steps[i-1])
		}
	}
	if pair.Steps[0] != flat.Steps[0] {
		t.Errorf("the first lockout differs by bucket (%v vs %v) — a member who mistyped once should "+
			"pay the same either way", pair.Steps[0], flat.Steps[0])
	}
	// The counter has to outlive the longest lockout, or serving it deletes the
	// row and hands the attacker a fresh start at step one.
	if pair.Window < pair.Steps[0] {
		t.Errorf("the window (%v) is shorter than the first lockout (%v)", pair.Window, pair.Steps[0])
	}
}

// ---------------------------------------------------------------------------
// the census: an action nobody declared is an action nobody throttled
// ---------------------------------------------------------------------------

var rateLimitMethods = map[string]bool{
	"CheckRateLimit":      true,
	"RecordFailedAttempt": true,
	"RecordAttempt":       true,
	"ClearRateLimit":      true,
}

// goFilesUnder lists every non-test .go file in the API, so this cannot stop
// covering a package by someone adding one.
func goFilesUnder(t *testing.T, root string) []string {
	t.Helper()
	var files []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		files = append(files, path)
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", root, err)
	}
	return files
}

// A rate limit is only as good as the policy behind it, and an action nobody
// named gets defaultRateLimitPolicy — five attempts and a flat thirty seconds —
// whatever the endpoint actually needs. A string literal at the call site is how
// that happens without anyone deciding it, so it is not allowed past this test.
func TestEveryRateLimitedActionIsDeclared(t *testing.T) {
	fset := token.NewFileSet()

	for _, path := range goFilesUnder(t, "../..") {
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}

		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || !rateLimitMethods[selector.Sel.Name] || len(call.Args) < 2 {
				return true
			}
			if literal, isLiteral := call.Args[1].(*ast.BasicLit); isLiteral {
				t.Errorf("%s: %s is called with the bare action %s — declare it as a "+
					"RateLimitAction constant and give it a policy, or it silently gets the default",
					fset.Position(literal.Pos()), selector.Sel.Name, literal.Value)
			}
			return true
		})
	}
}

// And every declared action has a policy. The constants are read from the source
// rather than listed here, so adding one and forgetting the policy fails.
func TestEveryDeclaredActionHasAPolicy(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "security_service.go", nil, 0)
	if err != nil {
		t.Fatalf("parse security_service.go: %v", err)
	}

	declared := 0
	ast.Inspect(file, func(node ast.Node) bool {
		spec, ok := node.(*ast.ValueSpec)
		if !ok {
			return true
		}
		for i, name := range spec.Names {
			if !strings.HasPrefix(name.Name, "RateLimitAction") || i >= len(spec.Values) {
				continue
			}
			literal, ok := spec.Values[i].(*ast.BasicLit)
			if !ok {
				continue
			}
			declared++
			action := strings.Trim(literal.Value, `"`)
			if _, hasPolicy := rateLimitPolicies[action]; !hasPolicy {
				t.Errorf("%s = %q has no entry in rateLimitPolicies", name.Name, action)
			}
		}
		return true
	})

	if declared == 0 {
		t.Fatal("found no RateLimitAction constants — this test is no longer checking anything")
	}
}
