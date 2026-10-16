package repositories

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// ADR-044 — a posting or loan is identified by its document number only. An
// INSERT must take the id from the allocator, never e.g. gen_random_uuid().
// Source-level: an integration test passes whatever the id looks like.

var (
	// To the end of the raw string, so the VALUES are read too.
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

	// Guards the walk: a regex matching nothing passes silently.
	if inserts < 8 {
		t.Fatalf("only found %d posting/loan inserts — the scan is broken, not the code", inserts)
	}
}

// No document series is named "FEE" — the platform charges none (rule 3).
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
