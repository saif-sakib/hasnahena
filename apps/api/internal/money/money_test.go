package money

import (
	"fmt"
	"testing"
)

func TestInstallmentPlan(t *testing.T) {
	tests := []struct {
		name         string
		principal    int64
		installments int
		wantPer      int64
		wantFinal    int64
	}{
		{"divides evenly", 12000, 12, 1000, 1000},
		{"single installment takes the whole principal", 5000, 1, 5000, 5000},
		{"remainder lands in the final installment", 10000, 3, 3333, 3334},
		{"largest possible remainder", 10000, 7, 1428, 1432},
		{"principal smaller than the installment count", 5, 10, 0, 5},
		{"one taka over twelve months", 1, 12, 0, 1},
		{"zero principal", 0, 12, 0, 0},
		{"negative principal", -5000, 12, 0, 0},
		{"zero installments does not divide by zero", 10000, 0, 0, 0},
		{"negative installments does not divide by zero", 10000, -3, 0, 0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			per, final := InstallmentPlan(tc.principal, tc.installments)
			if per != tc.wantPer || final != tc.wantFinal {
				t.Errorf("InstallmentPlan(%d, %d) = (%d, %d), want (%d, %d)",
					tc.principal, tc.installments, per, final, tc.wantPer, tc.wantFinal)
			}
		})
	}
}

// The Shariah invariant: the schedule must repay the principal exactly. Not one
// taka more (riba) and not one taka less (the loan never closes).
func TestInstallmentPlanRepaysPrincipalExactly(t *testing.T) {
	principals := []int64{1, 7, 99, 100, 999, 1000, 5000, 10000, 33333, 100000, 1_00_00_000}
	counts := []int{1, 2, 3, 5, 6, 7, 9, 11, 12, 18, 24, 36}

	for _, principal := range principals {
		for _, count := range counts {
			t.Run(fmt.Sprintf("%d_over_%d", principal, count), func(t *testing.T) {
				per, final := InstallmentPlan(principal, count)

				total := per*int64(count-1) + final
				if total != principal {
					t.Errorf("schedule sums to %d, want exactly %d (per=%d, final=%d over %d installments)",
						total, principal, per, final, count)
				}
				if !InstallmentPlanIsExact(principal, count, per, final) {
					t.Error("InstallmentPlanIsExact disagrees with the arithmetic above")
				}
				// The final installment absorbs the remainder, so it is never
				// smaller than a regular one — a member is never surprised by a
				// larger payment mid-schedule.
				if final < per {
					t.Errorf("final installment %d is smaller than the regular %d", final, per)
				}
			})
		}
	}
}

func TestMaxLoanAmount(t *testing.T) {
	tests := []struct {
		name       string
		savings    int64
		multiplier int64
		want       int64
	}{
		{"standard five times savings", 10000, 5, 50000},
		{"no savings", 0, 5, 0},
		{"negative savings", -100, 5, 0},
		{"zero multiplier borrows nothing", 10000, 0, 0},
		{"negative multiplier borrows nothing", 10000, -5, 0},
		{"multiplier of one", 8000, 1, 8000},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := MaxLoanAmount(tc.savings, tc.multiplier); got != tc.want {
				t.Errorf("MaxLoanAmount(%d, %d) = %d, want %d", tc.savings, tc.multiplier, got, tc.want)
			}
		})
	}
}

func TestEvaluateEligibility(t *testing.T) {
	const (
		minDeposit = 8000
		multiplier = 5
	)

	tests := []struct {
		name          string
		savings       int64
		hasActiveLoan bool
		wantEligible  bool
		wantMax       int64
		wantReason    string
	}{
		{"meets the minimum exactly", 8000, false, true, 40000, ""},
		{"comfortably above the minimum", 20000, false, true, 100000, ""},
		{"one taka short", 7999, false, false, 39995, ReasonInsufficientDeposit},
		{"no savings at all", 0, false, false, 0, ReasonInsufficientDeposit},
		{"eligible but already borrowing", 20000, true, false, 100000, ReasonActiveLoan},
		{"deposit is reported before the active loan", 100, true, false, 500, ReasonInsufficientDeposit},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := EvaluateEligibility(tc.savings, minDeposit, multiplier, tc.hasActiveLoan)
			if got.Eligible != tc.wantEligible {
				t.Errorf("Eligible = %v, want %v", got.Eligible, tc.wantEligible)
			}
			if got.MaxLoanAmount != tc.wantMax {
				t.Errorf("MaxLoanAmount = %d, want %d", got.MaxLoanAmount, tc.wantMax)
			}
			if got.Reason != tc.wantReason {
				t.Errorf("Reason = %q, want %q", got.Reason, tc.wantReason)
			}
		})
	}
}

func TestRecoverFrom(t *testing.T) {
	tests := []struct {
		name        string
		outstanding int64
		available   int64
		want        int64
	}{
		{"source covers the debt fully", 5000, 20000, 5000},
		{"source covers it exactly", 5000, 5000, 5000},
		{"source covers part of it", 5000, 2000, 2000},
		{"empty source gives nothing", 5000, 0, 0},
		{"negative balance is never drawn on", 5000, -100, 0},
		{"nothing outstanding takes nothing", 0, 20000, 0},
		{"negative outstanding takes nothing", -500, 20000, 0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := RecoverFrom(tc.outstanding, tc.available); got != tc.want {
				t.Errorf("RecoverFrom(%d, %d) = %d, want %d", tc.outstanding, tc.available, got, tc.want)
			}
		})
	}
}

// Order is policy: borrower first, then guarantor, then the donation pool.
func TestWaterfall(t *testing.T) {
	tests := []struct {
		name           string
		outstanding    int64
		sources        []int64
		wantDeductions []int64
		wantRemaining  int64
	}{
		{
			name:           "borrower covers it alone, guarantor untouched",
			outstanding:    5000,
			sources:        []int64{20000, 50000, 100000},
			wantDeductions: []int64{5000, 0, 0},
			wantRemaining:  0,
		},
		{
			name:           "borrower short, guarantor makes up the rest",
			outstanding:    10000,
			sources:        []int64{4000, 50000, 100000},
			wantDeductions: []int64{4000, 6000, 0},
			wantRemaining:  0,
		},
		{
			name:           "both short, donation pool closes the gap",
			outstanding:    10000,
			sources:        []int64{4000, 3000, 100000},
			wantDeductions: []int64{4000, 3000, 3000},
			wantRemaining:  0,
		},
		{
			name:           "everything drained and still unrecovered",
			outstanding:    10000,
			sources:        []int64{1000, 2000, 3000},
			wantDeductions: []int64{1000, 2000, 3000},
			wantRemaining:  4000,
		},
		{
			name:           "no guarantor on the loan",
			outstanding:    10000,
			sources:        []int64{4000, 0, 100000},
			wantDeductions: []int64{4000, 0, 6000},
			wantRemaining:  0,
		},
		{
			name:           "nothing outstanding touches nobody",
			outstanding:    0,
			sources:        []int64{20000, 50000, 100000},
			wantDeductions: []int64{0, 0, 0},
			wantRemaining:  0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			deductions, remaining := Waterfall(tc.outstanding, tc.sources)

			if len(deductions) != len(tc.sources) {
				t.Fatalf("got %d deductions for %d sources", len(deductions), len(tc.sources))
			}
			for i := range deductions {
				if deductions[i] != tc.wantDeductions[i] {
					t.Errorf("deductions[%d] = %d, want %d", i, deductions[i], tc.wantDeductions[i])
				}
			}
			if remaining != tc.wantRemaining {
				t.Errorf("remaining = %d, want %d", remaining, tc.wantRemaining)
			}

			// Nothing is created or destroyed on the way through.
			var recovered int64
			for _, d := range deductions {
				recovered += d
			}
			if recovered+remaining != tc.outstanding {
				t.Errorf("recovered %d + remaining %d = %d, want %d",
					recovered, remaining, recovered+remaining, tc.outstanding)
			}
			// No source may give more than it had.
			for i, d := range deductions {
				if d > tc.sources[i] {
					t.Errorf("source %d gave %d but only had %d", i, d, tc.sources[i])
				}
			}
		})
	}
}
