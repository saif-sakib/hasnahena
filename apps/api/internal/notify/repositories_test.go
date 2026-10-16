package notify

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// WO-52's backstop: a money verb in a repository file fails. Move the wording
// into messages.go and give it a table row — do not widen the exclusion.

const repositoriesDir = "../repositories"

// Float formatting verbs. `%.2f` on an amount is the LEDGER-07 defect; the
// others are the same mistake spelled differently.
var floatVerb = regexp.MustCompile(`%[-+ #0-9.]*[eEfFgG]`)

// Ratios (recovery and default rates), not money.
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
			// Comments may quote the banned shape.
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

// insertNotificationTx must not get a literal title or message.
func TestRepositoriesBuildNotificationTextHere(t *testing.T) {
	// Arg 3 is the enum (a literal is fine); args 4 and 5 must be variables.
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
