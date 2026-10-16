package money

import (
	"math"
	"math/rand"
	"testing"
)

// TEST-21 — the Shariah invariant as a seeded property sweep:
//
//	perInstallment*(installments-1) + finalInstallment == principal
//
// One taka over is riba; one under is a loan that never closes.
const seed = 20260817

func TestInstallmentPlanIsExactForEveryPlanTheSystemCanIssue(t *testing.T) {
	rng := rand.New(rand.NewSource(seed))

	// The bounds the application actually enforces: a loan is at most one crore
	// (utils.MaxLoanAmount) over at most 600 installments.
	const maxPrincipal = 1_00_00_000
	const maxInstallments = 600

	for i := 0; i < 200_000; i++ {
		principal := rng.Int63n(maxPrincipal) + 1
		count := rng.Intn(maxInstallments) + 1

		per, final := InstallmentPlan(principal, count)
		total := per*int64(count-1) + final

		if total != principal {
			t.Fatalf("principal=%d installments=%d -> per=%d final=%d sums to %d, a difference of %d",
				principal, count, per, final, total, total-principal)
		}
		if per < 0 || final < 0 {
			t.Fatalf("principal=%d installments=%d produced a negative installment (per=%d final=%d)",
				principal, count, per, final)
		}
		// The remainder lands in the last payment, so no intermediate
		// installment is ever larger than the one a member was quoted.
		if final < per {
			t.Fatalf("principal=%d installments=%d: final %d is smaller than the regular %d",
				principal, count, final, per)
		}
		// The adjustment is `principal mod installments`, bounded by the count.
		// On very long schedules the final payment concentrates (105,136/567 →
		// final 426 vs 185); left as a design decision — at 12 instalments it
		// differs by at most 11 taka.
		if final-per > int64(count-1) {
			t.Fatalf("principal=%d installments=%d: the adjustment %d exceeds the largest possible remainder %d",
				principal, count, final-per, count-1)
		}
	}
}

// TestInstallmentPlanAtTheEdges covers what a random sweep will not reach.
func TestInstallmentPlanAtTheEdges(t *testing.T) {
	cases := []struct {
		principal    int64
		installments int
	}{
		{1, 1},
		{1, 2},   // one taka over two months: someone pays 0, someone pays 1
		{1, 600}, // and over six hundred
		{2, 3},
		{math.MaxInt64, 1},
		{math.MaxInt64, 2},
		{math.MaxInt64, 600},
		{1_00_00_000, 600},
	}

	for _, tc := range cases {
		per, final := InstallmentPlan(tc.principal, tc.installments)
		total := per*int64(tc.installments-1) + final
		if total != tc.principal {
			t.Errorf("principal=%d installments=%d sums to %d", tc.principal, tc.installments, total)
		}
	}
}

func TestInstallmentPlanRefusesNonsense(t *testing.T) {
	// Callers reject these before reaching here, but a divide-by-zero in the
	// money package would be a panic inside a database transaction.
	cases := []struct {
		principal    int64
		installments int
	}{
		{0, 12}, {-1, 12}, {math.MinInt64, 12},
		{1000, 0}, {1000, -1}, {1000, math.MinInt32},
	}
	for _, tc := range cases {
		per, final := InstallmentPlan(tc.principal, tc.installments)
		if per != 0 || final != 0 {
			t.Errorf("principal=%d installments=%d returned (%d, %d), want (0, 0)",
				tc.principal, tc.installments, per, final)
		}
	}
}

// TestWaterfallNeverOverRecovers: min(owed, available), never more of either.
func TestWaterfallNeverOverRecovers(t *testing.T) {
	rng := rand.New(rand.NewSource(seed))

	for i := 0; i < 100_000; i++ {
		outstanding := rng.Int63n(1_00_00_000)
		sources := make([]int64, rng.Intn(4))
		for j := range sources {
			sources[j] = rng.Int63n(1_00_00_000)
		}

		deductions, remaining := Waterfall(outstanding, sources)

		if len(deductions) != len(sources) {
			t.Fatalf("got %d deductions for %d sources", len(deductions), len(sources))
		}

		var taken int64
		for j, d := range deductions {
			if d < 0 {
				t.Fatalf("negative deduction %d from source %d", d, j)
			}
			// Never takes more than a source holds: a balance driven negative
			// is money the cooperative does not have.
			if d > sources[j] {
				t.Fatalf("took %d from a source holding %d", d, sources[j])
			}
			taken += d
		}

		// Never takes more than is owed: that would be an overcharge, which is
		// the same violation as interest arriving by another name.
		if taken > outstanding {
			t.Fatalf("recovered %d against a debt of %d — %d too much",
				taken, outstanding, taken-outstanding)
		}
		if remaining < 0 {
			t.Fatalf("remaining went negative: %d", remaining)
		}
		if taken+remaining != outstanding {
			t.Fatalf("recovered %d + remaining %d != outstanding %d", taken, remaining, outstanding)
		}
		// Earlier sources are exhausted before later ones are touched.
		for j := 1; j < len(deductions); j++ {
			if deductions[j] > 0 && deductions[j-1] < sources[j-1] {
				t.Fatalf("took %d from source %d while source %d still held %d of %d",
					deductions[j], j, j-1, sources[j-1]-deductions[j-1], sources[j-1])
			}
		}
	}
}

// TestEligibilityNeverGrantsMoreThanTheMultiplierAllows sweeps the cap.
func TestEligibilityNeverGrantsMoreThanTheMultiplierAllows(t *testing.T) {
	rng := rand.New(rand.NewSource(seed))

	for i := 0; i < 100_000; i++ {
		savings := rng.Int63n(1_00_00_000)
		minDeposit := rng.Int63n(100_000)
		multiplier := rng.Int63n(10)

		result := EvaluateEligibility(savings, minDeposit, multiplier, rng.Intn(2) == 0)

		if result.MaxLoanAmount < 0 {
			t.Fatalf("negative cap %d for savings=%d multiplier=%d", result.MaxLoanAmount, savings, multiplier)
		}
		if multiplier > 0 && savings > 0 && result.MaxLoanAmount != savings*multiplier {
			t.Fatalf("cap %d != savings %d x multiplier %d", result.MaxLoanAmount, savings, multiplier)
		}
		if multiplier <= 0 || savings <= 0 {
			if result.MaxLoanAmount != 0 {
				t.Fatalf("cap should be 0 for savings=%d multiplier=%d, got %d",
					savings, multiplier, result.MaxLoanAmount)
			}
		}
		if result.Eligible && result.Reason != "" {
			t.Fatalf("eligible but carrying a reason: %q", result.Reason)
		}
		if !result.Eligible && result.Reason == "" {
			t.Fatalf("ineligible with no reason, for savings=%d min=%d", savings, minDeposit)
		}
	}
}
