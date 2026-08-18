package notify

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// WO-52's backstop. The table test in messages_test.go proves the builders in
// this package render whole taka — but it can only prove that about strings
// that go THROUGH this package. Nothing stops the next repository change from
// building a notification message inline again, which is where all fourteen
// `%.2f` amounts lived until 2026-08-18.
//
// So this reads the repository source. It is deliberately blunt: a money verb
// in a repository file fails, and the fix is to add a builder here rather than
// to widen the exclusion.
//
// **This test is supposed to fail when you format an amount outside this
// package.** Move the wording into messages.go and give it a table row.

const repositoriesDir = "../repositories"

// Float formatting verbs. `%.2f` on an amount is the LEDGER-07 defect; the
// others are the same mistake spelled differently.
var floatVerb = regexp.MustCompile(`%[-+ #0-9.]*[eEfFgG]`)

// Lines that legitimately compute a percentage rather than an amount. Recovery
// and default rates are ratios, not money, and are reported as numbers rather
// than rendered into a member-facing string.
var percentageIdentifiers = []string{
	"recoveryRate",
	"defaultRate",
	"monthlyGrowth",
}

func repositoryFiles(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(repositoriesDir)
	if err != nil {
		t.Fatalf("read %s: %v", repositoriesDir, err)
	}
	var files []string
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		files = append(files, filepath.Join(repositoriesDir, name))
	}
	if len(files) == 0 {
		t.Fatalf("no repository source found under %s — this census has stopped reading anything", repositoriesDir)
	}
	return files
}

func TestRepositoriesDoNotFormatMoneyAsFloat(t *testing.T) {
	for _, path := range repositoryFiles(t) {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for i, line := range strings.Split(string(data), "\n") {
			trimmed := strings.TrimSpace(line)
			// Comments describe the defect on purpose — loan_repository.go
			// carries the history of two of them. A rule that fires on its own
			// documentation teaches people to delete the documentation.
			if strings.HasPrefix(trimmed, "//") {
				continue
			}
			if !floatVerb.MatchString(line) {
				continue
			}
			if isPercentageLine(line) {
				continue
			}
			t.Errorf("%s:%d formats a value with a float verb:\n\t%s\n"+
				"Amounts are int64 whole taka (rule 1). Build the string in internal/notify instead.",
				path, i+1, trimmed)
		}
	}
}

func isPercentageLine(line string) bool {
	for _, id := range percentageIdentifiers {
		if strings.Contains(line, id) {
			return true
		}
	}
	return false
}

// The repositories must not hand insertNotificationTx a string literal either.
// A literal title or message is one this package's census cannot see, and
// therefore one nothing tests.
func TestRepositoriesBuildNotificationTextHere(t *testing.T) {
	// `insertNotificationTx(ctx, tx, "TYPE", <title>, <message>, ...)` — the
	// third argument is the NotificationType enum and is legitimately a literal.
	// Arguments four and five are the title and message, and must be variables.
	call := regexp.MustCompile(`insertNotificationTx\(`)

	for _, path := range repositoryFiles(t) {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		lines := strings.Split(string(data), "\n")
		for i, line := range lines {
			if !call.MatchString(line) || strings.HasPrefix(strings.TrimSpace(line), "//") {
				continue
			}
			// The call is written one argument per line throughout the
			// repositories, so the title and message are lines i+4 and i+5.
			if i+5 >= len(lines) {
				continue
			}
			for offset, what := range map[int]string{4: "title", 5: "message"} {
				arg := strings.TrimSpace(strings.TrimSuffix(lines[i+offset], ","))
				if strings.HasPrefix(arg, `"`) || strings.Contains(arg, "fmt.Sprintf") {
					t.Errorf("%s:%d builds a notification %s inline:\n\t%s\n"+
						"Add a builder to internal/notify/messages.go so the wording is tested.",
						path, i+offset+1, what, arg)
				}
			}
		}
	}
}
