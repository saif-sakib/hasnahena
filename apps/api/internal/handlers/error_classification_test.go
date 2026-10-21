package handlers

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Rule 2b: an expected refusal is a sentinel matched with errors.Is. Matching
// on err.Error() turned a database outage into "member not found" (404) and a
// suspended borrower into "this loan is not active". Any strings.* call over
// .Error() counts — the text was usually laundered through ToLower first.
// A third party's error text (it sends nothing else) is marked `rule2b:third-party`.
var errorTextMatch = regexp.MustCompile(`strings\.\w+\([^()]*\w+\.Error\(\)`)

func TestNoErrorIsClassifiedByItsText(t *testing.T) {
	var scanned int
	for _, root := range []string{"..", filepath.Join("..", "..", "cmd")} {
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			raw, err := os.ReadFile(filepath.Clean(path))
			if err != nil {
				return err
			}
			scanned++
			for i, line := range strings.Split(string(raw), "\n") {
				if strings.HasPrefix(strings.TrimSpace(line), "//") {
					continue
				}
				if errorTextMatch.MatchString(line) && !strings.Contains(line, "rule2b:third-party") {
					t.Errorf(
						"%s:%d classifies an error by its text:\n\t%s\n\n"+
							"Return a sentinel from the repository and match it with errors.Is "+
							"(CLAUDE.md rule 2b). Rewording a message must not change a status code.",
						path, i+1, strings.TrimSpace(line),
					)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", root, err)
		}
	}

	// A walk that reads no files would pass while checking nothing.
	if scanned < 20 {
		t.Fatalf("only scanned %d Go files — the directory walk is broken", scanned)
	}
}
