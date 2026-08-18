package money

import (
	"testing"
	"time"
)

func date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 12, 0, 0, 0, time.UTC)
}

func TestInstallmentsDue(t *testing.T) {
	start := date(2026, time.January, 15)

	cases := []struct {
		name  string
		now   time.Time
		total int
		want  int
	}{
		// The first instalment is due one month after the schedule starts.
		// Counting from day zero would put every loan an instalment behind on
		// the day it was disbursed.
		{"on the start date", start, 12, 0},
		{"the day before the first is due", date(2026, time.February, 14), 12, 0},
		{"the day the first is due", date(2026, time.February, 15), 12, 1},
		{"the day after", date(2026, time.February, 16), 12, 1},
		{"three months in", date(2026, time.April, 15), 12, 3},
		{"eleven months in", date(2026, time.December, 15), 12, 11},
		{"the final instalment", date(2027, time.January, 15), 12, 12},
		// Capped: a schedule that ran out two years ago is not 24 further
		// instalments overdue.
		{"long after the schedule ended", date(2030, time.January, 15), 12, 12},
		{"before the schedule starts", date(2025, time.December, 1), 12, 0},
		{"no instalments", date(2027, time.January, 15), 0, 0},
	}

	for _, c := range cases {
		if got := InstallmentsDue(start, c.now, c.total); got != c.want {
			t.Errorf("%s: InstallmentsDue = %d, want %d", c.name, got, c.want)
		}
	}
}

// A schedule starting on the 31st must stay pinned to month ends rather than
// drifting a day earlier every short month, which is what 30-day arithmetic
// does. Go's AddDate normalises 31 February to 3 March, so the due date moves
// later — never earlier — which is the conservative direction for a borrower.
func TestInstallmentsDueAtMonthEnd(t *testing.T) {
	start := date(2026, time.January, 31)

	if got := InstallmentsDue(start, date(2026, time.February, 28), 12); got != 0 {
		t.Errorf("28 Feb after a 31 Jan start: due = %d, want 0 — the first instalment is not yet due", got)
	}
	if got := InstallmentsDue(start, date(2026, time.March, 3), 12); got != 1 {
		t.Errorf("3 Mar after a 31 Jan start: due = %d, want 1", got)
	}
	if got := InstallmentsDue(start, date(2026, time.March, 31), 12); got != 2 {
		t.Errorf("31 Mar after a 31 Jan start: due = %d, want 2", got)
	}
}

func TestInstallmentsDueWithAZeroStart(t *testing.T) {
	// A loan approved but never disbursed has no installmentStartDate. It must
	// read as nothing due rather than as every instalment overdue since year 1.
	if got := InstallmentsDue(time.Time{}, date(2026, time.June, 1), 12); got != 0 {
		t.Errorf("zero start date: due = %d, want 0", got)
	}
}

func TestMissedInstallments(t *testing.T) {
	start := date(2026, time.January, 15)
	now := date(2026, time.July, 15) // six instalments due

	cases := []struct {
		name  string
		paid  int
		want  int
		total int
	}{
		{"nothing paid", 0, 6, 12},
		{"two paid", 2, 4, 12},
		{"all six paid", 6, 0, 12},
		// Paying ahead is not arrears.
		{"paid ahead", 9, 0, 12},
		{"negative paid count is treated as zero", -3, 6, 12},
	}

	for _, c := range cases {
		if got := MissedInstallments(start, now, c.total, c.paid); got != c.want {
			t.Errorf("%s: MissedInstallments = %d, want %d", c.name, got, c.want)
		}
	}
}

func TestIsDefaultable(t *testing.T) {
	cases := []struct {
		missed, threshold int
		want              bool
	}{
		{0, 3, false},
		{2, 3, false},
		{3, 3, true},
		{9, 3, true},
		{1, 1, true},
		// A threshold below 1 would default a loan on the day it was
		// disbursed. Treated as unset rather than as "always".
		{0, 0, false},
		{5, 0, false},
		{5, -1, false},
	}
	for _, c := range cases {
		if got := IsDefaultable(c.missed, c.threshold); got != c.want {
			t.Errorf("IsDefaultable(missed=%d, threshold=%d) = %v, want %v",
				c.missed, c.threshold, got, c.want)
		}
	}
}

// The whole point of the policy: a borrower who is behind but within the
// threshold cannot be defaulted, and the one who crosses it can. Written as a
// scenario because the two halves are what an admin actually experiences.
func TestABorrowerBecomesDefaultableOnlyAtTheThreshold(t *testing.T) {
	start := date(2026, time.January, 10)
	const total, paid, threshold = 12, 0, 3

	twoMonthsIn := date(2026, time.March, 10)
	missed := MissedInstallments(start, twoMonthsIn, total, paid)
	if IsDefaultable(missed, threshold) {
		t.Errorf("two instalments missed (%d) should not be defaultable at a threshold of %d", missed, threshold)
	}

	threeMonthsIn := date(2026, time.April, 10)
	missed = MissedInstallments(start, threeMonthsIn, total, paid)
	if !IsDefaultable(missed, threshold) {
		t.Errorf("three instalments missed (%d) should be defaultable at a threshold of %d", missed, threshold)
	}
}
