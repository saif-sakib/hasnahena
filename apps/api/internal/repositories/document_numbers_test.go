package repositories

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// ADR-044. Every posting and every loan is identified by the number printed on
// the document, and nothing else.
//
// `transactions.id` used to be a `cuid()` beside a **nullable** `receiptNumber`,
// and `loans.id` a `cuid()` beside a `loanNumber`. Two identifiers for one
// thing, of which the readable one was the one the database did not require —
// so four inserts in loan_repository.go wrote no receipt at all, and the audit
// screen printed the other one.
//
// There is one column now, and it has no default, so an insert that forgets it
// fails on a NOT NULL primary key. What the compiler cannot catch is an insert
// that *supplies* one from somewhere other than the allocator:
// `gen_random_uuid()::text` compiles, satisfies the key, and puts an opaque
// string back on a member's receipt. Every one of these inserts used to do
// exactly that, so this is a regression that has already happened once at every
// call site simultaneously.
//
// This reads the source rather than a database because that is where the
// mistake is visible: an integration test posting one deposit passes whatever
// the id looks like.

var (
	// To the end of the enclosing raw string literal, not to the end of the
	// column list. The first version of this stopped at the `)` that closes the
	// columns — so it read every INSERT in the package, matched nothing in any
	// of them, and passed against a deliberately planted `gen_random_uuid()`.
	// The values are the whole point: that is where the id comes from.
	postingInsert = regexp.MustCompile("(?is)INSERT\\s+INTO\\s+(transactions|loans)\\b[^`]*")
	// The id has to come from somewhere. These are the ways it must not.
	opaqueID = regexp.MustCompile(`(?i)gen_random_uuid\(\)|uuid_generate|md5\(|random\(\)`)
)

func TestPostingsAndLoansAreNumbered(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read repositories directory: %v", err)
	}

	var inserts int
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(filepath.Clean(name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		source := stripComments(string(raw))

		for _, stmt := range postingInsert.FindAllString(source, -1) {
			inserts++
			if opaqueID.MatchString(stmt) {
				t.Errorf(
					"%s writes a posting or a loan with a generated id:\n\t%s\n\n"+
						"The id IS the receipt number or the loan number (ADR-044) and must come "+
						"from nextDocumentNumber, allocated inside the same transaction as the "+
						"row so a rollback releases it. A uuid here is an unreadable string on a "+
						"member's receipt and a hole in the series.",
					name, strings.Join(strings.Fields(stmt), " "),
				)
			}
		}
	}

	// Guards the walk. A regex that matches nothing passes silently, which is
	// the failure mode that let the audit-action census go blind when the
	// anchor it searched for was removed.
	if inserts < 8 {
		t.Fatalf("only found %d posting/loan inserts — the scan is broken, not the code", inserts)
	}
}

// Every series a posting can be filed under has a name, and the name is not
// "FEE".
//
// The enum label on a donation-pool recovery is `FEE` because that is the
// TransactionType this schema has. The *document* must not say so: this
// platform charges no fee of any kind (rule 3), and a receipt headed
// `FEE-2026-000001` is a written statement that it does.
func TestNoDocumentSeriesIsNamedFee(t *testing.T) {
	raw, err := os.ReadFile(filepath.Clean("../utils/generator.go"))
	if err != nil {
		t.Fatalf("read generator.go: %v", err)
	}
	for _, line := range strings.Split(stripComments(string(raw)), "\n") {
		if strings.Contains(line, `= "FEE"`) {
			t.Errorf("a document series is named FEE:\n\t%s", strings.TrimSpace(line))
		}
	}
}
