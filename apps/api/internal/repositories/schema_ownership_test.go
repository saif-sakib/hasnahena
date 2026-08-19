package repositories

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// WO-70. The database schema has exactly one definition, and it is the
// migrations.
//
// `EnsureSupportSchema` used to run `CREATE TABLE IF NOT EXISTS` at every boot
// for `document_sequences`, `support_threads`, `support_messages` and
// `sse_tickets` — four tables `schema.prisma` also defines and the `0_init`
// migration also creates. Two definitions, in two languages, with nothing
// checking that they agreed.
//
// They did not agree. Both differences were the shape that only shows up on a
// database where the *other* definition happened to run first:
//
//   - `document_sequences."updatedAt"` was `NOT NULL DEFAULT NOW()` in the
//     bootstrap and `NOT NULL` with no default in the migration. That exact
//     divergence once broke all four money flows at once as a generic 500, when
//     a `db push` stripped a default the bootstrap had supplied.
//   - `idx_support_messages_thread_created_desc` was a covering index
//     (`INCLUDE (message, "senderUserId")`) in the bootstrap and a plain one in
//     the migration. Same name plus `IF NOT EXISTS` means the second creator is
//     a silent no-op — and since migrations run first everywhere, the covering
//     variant had never existed in any environment. It read like an
//     optimisation and was a no-op.
//
// This test reads the repository source rather than a database, because the
// failure it guards against is someone re-adding a convenience `CREATE TABLE IF
// NOT EXISTS` — a syntactic fact, and one that a passing integration suite
// would never reveal.
//
// `pnpm db:migrate:check` is the other half: it fails CI when the migrated
// database and `schema.prisma` disagree. Together they mean the schema has one
// author and one reviewer.

// Statements that define schema. `IF NOT EXISTS` is what makes these dangerous
// rather than obviously wrong: on a database that already has the object they
// do nothing at all, so a divergent definition is invisible until the day
// something creates the object from the wrong one.
var schemaDDL = regexp.MustCompile(`(?i)\b(CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|TYPE|SCHEMA)|ALTER\s+TABLE|DROP\s+(TABLE|INDEX)|CREATE\s+OR\s+REPLACE\s+FUNCTION)\b`)

// Line comments and block comments, stripped before searching.
//
// A detector must search code, not prose — a rule forbidding "CREATE TABLE"
// would otherwise fire on the comment above explaining why it is forbidden, and
// a check that flags its own documentation teaches people to delete the
// documentation.
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

	// Guards the walk itself: a version of this test that reads no files passes
	// while checking nothing, which is the shape of green that means a test has
	// stopped working rather than the code being correct.
	if scanned < 5 {
		t.Fatalf("only scanned %d repository files — the directory walk is broken", scanned)
	}
}
