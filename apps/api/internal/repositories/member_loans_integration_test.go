//go:build integration

package repositories

import (
	"context"
	"testing"
)

// A member holding a loan is shown it (a Scan/column mismatch once hid every
// loan behind an empty state).
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

	// Values from the same SELECT, so a shifted column list shows as wrong data.
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

// A member with no loan gets an empty result, not an error.
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
