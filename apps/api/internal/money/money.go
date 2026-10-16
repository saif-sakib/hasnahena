// Package money is the pure arithmetic behind loans, instalments and default
// recovery: int64 whole taka in and out (ADR-002). Under Qard al-Hasan a
// schedule must never sum to more than the principal.
package money

// InstallmentPlan splits a principal into equal installments with the rounding
// remainder in the final one, so that
//
//	perInstallment*(installments-1) + finalInstallment == principal
//
// Mirrors lib/documents/builders/loan-agreement.ts. Bad input yields zeros.
func InstallmentPlan(principal int64, installments int) (perInstallment int64, finalInstallment int64) {
	if principal <= 0 || installments < 1 {
		return 0, 0
	}

	perInstallment = principal / int64(installments)
	finalInstallment = principal - perInstallment*int64(installments-1)
	return perInstallment, finalInstallment
}

// InstallmentPlanIsExact reports whether a plan repays the principal precisely.
func InstallmentPlanIsExact(principal int64, installments int, perInstallment, finalInstallment int64) bool {
	if installments < 1 {
		return false
	}
	return perInstallment*int64(installments-1)+finalInstallment == principal
}

// RemainingInstallments never returns less than 1: callers divide by it, and
// paidInstallments can run past the total.
func RemainingInstallments(totalInstallments, paidInstallments int) int {
	if paidInstallments < 0 {
		paidInstallments = 0
	}
	remaining := totalInstallments - paidInstallments
	if remaining < 1 {
		return 1
	}
	return remaining
}

// TopUpPlan re-spreads the outstanding balance over the remaining payments;
// the end date does not move. No rate or fee (rule 3):
//
//	perInstallment*(remaining-1) + finalInstallment == outstanding
func TopUpPlan(outstanding int64, totalInstallments, paidInstallments int) (perInstallment, finalInstallment int64) {
	return InstallmentPlan(outstanding, RemainingInstallments(totalInstallments, paidInstallments))
}

// MaxLoanAmount is savings × multiplier; non-positive inputs yield 0.
func MaxLoanAmount(savingsBalance int64, multiplier int64) int64 {
	if savingsBalance <= 0 || multiplier <= 0 {
		return 0
	}
	return savingsBalance * multiplier
}

// Eligibility is the answer to "may this member borrow, and how much".
type Eligibility struct {
	Eligible      bool
	MaxLoanAmount int64
	// Reason is empty when Eligible is true.
	Reason string
}

// Reasons a member cannot borrow, surfaced to the UI.
const (
	ReasonInsufficientDeposit = "Insufficient deposit balance"
	ReasonActiveLoan          = "Already has an active loan"
)

// EvaluateEligibility: minimum savings (checked first — actionable), then one
// loan at a time.
func EvaluateEligibility(savingsBalance, minDepositRequired, multiplier int64, hasActiveLoan bool) Eligibility {
	max := MaxLoanAmount(savingsBalance, multiplier)

	switch {
	case savingsBalance < minDepositRequired:
		return Eligibility{Eligible: false, MaxLoanAmount: max, Reason: ReasonInsufficientDeposit}
	case hasActiveLoan:
		return Eligibility{Eligible: false, MaxLoanAmount: max, Reason: ReasonActiveLoan}
	default:
		return Eligibility{Eligible: true, MaxLoanAmount: max}
	}
}

// RecoverFrom is one waterfall step: min(owed, available), never negative.
func RecoverFrom(outstanding, available int64) int64 {
	if outstanding <= 0 || available <= 0 {
		return 0
	}
	if available < outstanding {
		return available
	}
	return outstanding
}

// Waterfall applies RecoverFrom in policy order — borrower, guarantor,
// donation pool. deductions has the same length as sources.
func Waterfall(outstanding int64, sources []int64) (deductions []int64, remaining int64) {
	deductions = make([]int64, len(sources))
	remaining = outstanding
	if remaining < 0 {
		remaining = 0
	}

	for i, available := range sources {
		taken := RecoverFrom(remaining, available)
		deductions[i] = taken
		remaining -= taken
	}

	return deductions, remaining
}
