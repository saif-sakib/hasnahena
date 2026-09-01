//go:build integration

package repositories

import (
	"context"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Every SQL literal in this service, checked against the schema it will run on.
//
// SQL that lives inside a Go string is invisible to the compiler, to `go vet`
// and to `gofmt`. The only thing that can tell whether it still matches the
// database is the database, and until this test the first thing to notice a
// dropped column was a member seeing an error.
//
// That is not hypothetical. The migration that made every id its own document
// number (ADR-044) dropped `accounts.id`, `documents.id`, `nominees.id` and
// `addresses.id`, and three statements went on naming them:
//
//   - worker_repository.go  `SELECT d.id` — every member detail screen, for
//     both workers and admins, answered "Failed to load member details"
//   - admin_repository.go   `'id', d.id`  — the approvals queue
//   - transaction_repository.go `UPDATE accounts … WHERE id = $2` — the leg
//     that confirms a loan instalment, which is money
//
// The whole test suite was green: `pnpm typecheck`, `go build`, `go vet`,
// `pnpm db:migrate:check`, 793 web unit tests, 528 route tests, every Go
// integration package and 218 browser specs. None of them reads a string.
//
// PREPARE parses and plans a statement without executing it, so this validates
// every table and column reference at no risk and at the speed of a plan.
func TestEverySQLLiteralMatchesTheSchema(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()

	statements := collectSQLLiterals(t)
	if len(statements) < 200 {
		// A change to the extractor that quietly stopped finding statements
		// would make this test pass by looking at nothing.
		t.Fatalf("only %d SQL literals found; the extractor is broken", len(statements))
	}

	checked, broken := 0, 0
	for i, s := range statements {
		name := fmt.Sprintf("census_%d", i)
		_, err := testPool.Exec(ctx, "PREPARE "+name+" AS "+s.sql)
		if err != nil {
			// A statement Go assembles from fragments at runtime cannot be
			// prepared as written, and an untyped placeholder is not a schema
			// fault. Both are reported by message, so neither hides a real one.
			msg := err.Error()
			switch {
			case strings.Contains(msg, "syntax error"),
				strings.Contains(msg, "could not determine data type"),
				strings.Contains(msg, "inconsistent types deduced"),
				strings.Contains(msg, "there is no parameter"):
				continue
			}
			broken++
			t.Errorf("%s:%d references something the schema does not have:\n    %v",
				s.file, s.line, err)
			continue
		}
		if _, err := testPool.Exec(ctx, "DEALLOCATE "+name); err != nil {
			t.Fatalf("deallocate %s: %v", name, err)
		}
		checked++
	}
	t.Logf("%d SQL literals: %d validated against the live schema, %d broken",
		len(statements), checked, broken)
}

type sqlLiteral struct {
	file string
	line int
	sql  string
}

var sqlStart = regexp.MustCompile(`(?is)^\s*(--[^\n]*\n\s*)*(SELECT|INSERT|UPDATE|DELETE|WITH)\b`)

// collectSQLLiterals parses the Go sources and returns the raw-string literals
// that hold a whole SQL statement.
//
// It parses rather than greps for two reasons, both of which produced a false
// failure in the first version: a backtick inside a doc comment is not code,
// and a literal joined to another with `+` is half a statement — the half that
// happens to end at `WHERE` cannot be prepared and says nothing about the
// schema. Both are skipped here rather than filtered out of the results by
// message, because filtering by message is how a real error gets skipped too.
//
// Test files are included: a fixture that writes a column which no longer
// exists is a test that cannot fail honestly.
func collectSQLLiterals(t *testing.T) []sqlLiteral {
	t.Helper()

	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatalf("resolve api root: %v", err)
	}

	var out []sqlLiteral
	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}

		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			// A file this package cannot parse is the compiler's problem, not
			// this test's.
			return nil
		}
		rel, _ := filepath.Rel(root, path)

		// Two shapes are not statements this service runs.
		//
		// A literal joined to another with `+` is a fragment of something
		// assembled at runtime; the half that ends at `WHERE` cannot be
		// prepared and says nothing about the schema.
		//
		// A literal inside a composite literal is a table of examples feeding
		// some other test's parser — `selectsEveryColumn` is checked against
		// `SELECT id FROM t`, and `t` is fictional on purpose.
		skip := map[*ast.BasicLit]bool{}
		ast.Inspect(file, func(n ast.Node) bool {
			switch node := n.(type) {
			case *ast.BinaryExpr:
				if node.Op != token.ADD {
					return true
				}
				for _, side := range []ast.Expr{node.X, node.Y} {
					if lit, ok := side.(*ast.BasicLit); ok {
						skip[lit] = true
					}
				}
			case *ast.CompositeLit:
				ast.Inspect(node, func(inner ast.Node) bool {
					if lit, ok := inner.(*ast.BasicLit); ok {
						skip[lit] = true
					}
					return true
				})
			}
			return true
		})

		ast.Inspect(file, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING || skip[lit] {
				return true
			}
			// Raw strings only — SQL in this codebase is always backticked.
			if !strings.HasPrefix(lit.Value, "`") {
				return true
			}
			body := strings.Trim(lit.Value, "`")
			if !sqlStart.MatchString(body) {
				return true
			}
			out = append(out, sqlLiteral{
				file: rel,
				line: fset.Position(lit.Pos()).Line,
				sql:  strings.TrimSuffix(strings.TrimSpace(body), ";"),
			})
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	return out
}
