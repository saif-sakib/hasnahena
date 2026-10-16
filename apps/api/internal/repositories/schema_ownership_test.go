package repositories

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// WO-70: the migrations are the ONLY schema definition. No repository may
// CREATE/ALTER/DROP schema — `IF NOT EXISTS` makes a divergent definition
// invisible. `pnpm db:migrate:check` is the other half.
var schemaDDL = regexp.MustCompile(`(?i)\b(CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|TYPE|SCHEMA)|ALTER\s+TABLE|DROP\s+(TABLE|INDEX)|CREATE\s+OR\s+REPLACE\s+FUNCTION)\b`)

// Comments are stripped first so the detector reads code, not prose.
var (
	lineComment  = regexp.MustCompile(`(?m)^\s*//.*$`)
	blockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
)

func stripComments(src string) string {
	return lineComment.ReplaceAllString(blockComment.ReplaceAllString(src, ""), "")
}

func TestRepositoriesDoNotDefineSchema(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read repositories directory: %v", err)
	}

	var scanned int
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(filepath.Clean(name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		scanned++

		for i, line := range strings.Split(stripComments(string(raw)), "\n") {
			if schemaDDL.MatchString(line) {
				t.Errorf(
					"%s:%d defines schema at runtime:\n\t%s\n\n"+
						"The migrations in apps/web/prisma/migrations are the only definition of "+
						"this database (WO-70). A second one here disagrees with them eventually, "+
						"and `IF NOT EXISTS` guarantees the disagreement is silent. Add a migration "+
						"with `pnpm db:migrate:dev` instead.",
					name, i+1, strings.TrimSpace(line),
				)
			}
		}
	}

	// A walk that reads no files would pass while checking nothing.
	if scanned < 5 {
		t.Fatalf("only scanned %d repository files — the directory walk is broken", scanned)
	}
}
