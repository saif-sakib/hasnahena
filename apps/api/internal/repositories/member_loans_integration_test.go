//go:build integration

package repositories

import (
	"context"
	"testing"
)

// A member holding a loan must be told they hold it.
//
// `GetMemberLoans` selected thirteen columns into twelve scan destinations —
// `l.id` appeared twice, once cast to text and once bare — and the loop skipped
// any row whose scan failed. Every row's scan failed, so every borrower on the
// platform saw "No active loan" above an empty history, on a screen that
// rendered perfectly. It was found by filming it, not by a test, because
// nothing here asserted that a seeded loan comes back out.
//
// The scan error is returned now rather than skipped, which means a future
// column-list change fails loudly. This test is the other half: it fails if the
// row stops coming back for any reason at all, including one nobody has thought
// of.
func TestMemberLoansReturnsTheBorrowersActiveLoan(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "ml-borrower", "ACC-KH-33101", 40000)
	guarantor := seedMember(t, "ml-guarantor", "ACC-KH-33102", 60000)

	// Two months into a twelve-month schedule, which is the ordinary case and
	// the one that was invisible.
	loanID := seedLoanBehindBy(t, borrower, guarantor, 120000, 2)

	data, err := repo.GetMemberLoans(ctx, borrower)
	if err != nil {
		t.Fatalf("GetMemberLoans: %v", err)
	}

	active, ok := data["activeLoan"].(map[string]interface{})
	if !ok || active == nil {
		t.Fatalf("activeLoan is nil for a member with an ACTIVE loan (%s); "+
			"that is the shape the silent scan-skip produced. Got: %#v", loanID, data["activeLoan"])
	}

	if got := active["id"]; got != loanID {
		t.Errorf("activeLoan id = %v, want %v", got, loanID)
	}

	// Each of these came from a column in the same SELECT, so a mismatch that
	// shifts the column list shows up here as a wrong value rather than as an
	// absence.
	if got, want := active["totalInstallments"], 12; got != want {
		t.Errorf("totalInstallments = %v, want %v", got, want)
	}
	if got, want := active["principalAmount"], int64(120000); got != want {
		t.Errorf("principalAmount = %v, want %v", got, want)
	}
	if got, want := active["status"], "ACTIVE"; got != want {
		t.Errorf("status = %v, want %v", got, want)
	}
	// The guarantor's name arrives through a LEFT JOIN and was the last column
	// in the list — the one a short scan drops first.
	if got := active["guarantor"]; got == "" || got == nil {
		t.Errorf("guarantor name is empty; the joined column did not survive the scan")
	}
}

// A member with no loan gets an empty answer, not an error.
//
// The counterpart to the test above: now that a scan failure is returned rather
// than swallowed, "no rows" must still be an ordinary, successful, empty result.
func TestMemberLoansIsEmptyForAMemberWithNoLoan(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	saver := seedMember(t, "ml-saver", "ACC-KH-33103", 15000)

	data, err := repo.GetMemberLoans(ctx, saver)
	if err != nil {
		t.Fatalf("GetMemberLoans for a member with no loan: %v", err)
	}
	// A typed nil map inside an interface is not `== nil`, so the comparison has
	// to go through the type assertion the handler itself uses.
	if active, ok := data["activeLoan"].(map[string]interface{}); ok && active != nil {
		t.Errorf("activeLoan = %#v, want no loan", active)
	}
	history, ok := data["loanHistory"].([]map[string]interface{})
	if !ok {
		t.Fatalf("loanHistory is not a slice: %#v", data["loanHistory"])
	}
	if len(history) != 0 {
		t.Errorf("loanHistory has %d entries, want 0", len(history))
	}
}
