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

// Every SQL literal in this service, PREPAREd against the real schema. SQL in
// a Go string is invisible to the compiler and to every other suite; ADR-044's
// dropped id columns broke three statements while everything stayed green.
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
			// Runtime-assembled statements and untyped placeholders are not
			// schema faults; both are matched by message.
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

// collectSQLLiterals parses (not greps) the Go sources for raw-string literals
// holding a whole statement. Test files are included.
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

		// Skipped: `+`-joined fragments, and literals inside composite
		// literals (example tables for other tests, e.g. selectsEveryColumn).
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
