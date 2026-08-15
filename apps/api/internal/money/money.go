// Package money holds the arithmetic behind loans, installments and default
// recovery, separated from the SQL that reads and writes it.
//
// It exists so this arithmetic can be tested without a database. Everything
// here is a pure function over whole taka (ADR-002) — no paisa, no float, no
// ×100. int64 in, int64 out.
//
// The rules these functions encode are Shariah constraints, not preferences:
// under Qard al-Hasan the borrower repays the principal and not one taka more.
// A schedule that sums to more than the principal is riba, however small the
// rounding that produced it.
package money

// InstallmentPlan splits a principal into equal installments, putting the
// rounding remainder in the final one.
//
// Integer division alone loses the remainder: 10,000 over 3 months gives 3,333
// a month, and 3 × 3,333 = 9,999 — the member would underpay by 1 taka and the
// loan would never close. Rounding up instead makes the schedule sum to more
// than the principal, which is riba. So the first n-1 installments are equal
// and the last absorbs the difference.
//
// The invariant callers can rely on:
//
//	perInstallment*(installments-1) + finalInstallment == principal
//
// This mirrors the loan agreement PDF (`lib/documents/builders/loan-agreement.ts`),
// which prints the adjusted final installment. The two must stay in step or the
// contract a member signs will not match the schedule they are billed.
//
// A principal of 0 or fewer, or fewer than one installment, yields zeros —
// callers reject those before reaching here, but this must not divide by zero.
func InstallmentPlan(principal int64, installments int) (perInstallment int64, finalInstallment int64) {
	if principal <= 0 || installments < 1 {
		return 0, 0
	}

	perInstallment = principal / int64(installments)
	finalInstallment = principal - perInstallment*int64(installments-1)
	return perInstallment, finalInstallment
}

// InstallmentPlanIsExact reports whether a plan repays the principal precisely.
// It is the invariant above, written out so tests and callers can assert it
// rather than restate the arithmetic.
func InstallmentPlanIsExact(principal int64, installments int, perInstallment, finalInstallment int64) bool {
	if installments < 1 {
		return false
	}
	return perInstallment*int64(installments-1)+finalInstallment == principal
}

// MaxLoanAmount is the ceiling a member may borrow: a multiple of what they
// have saved. A non-positive multiplier or savings yields 0 — borrowing against
// nothing is not a loan, it is a gift from the pool.
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

// Reasons a member cannot borrow. Callers surface these to the UI, so they are
// constants rather than inline strings.
const (
	ReasonInsufficientDeposit = "Insufficient deposit balance"
	ReasonActiveLoan          = "Already has an active loan"
)

// EvaluateEligibility applies the two standing conditions: a member must have
// saved at least the configured minimum, and may hold only one loan at a time.
//
// The order matters for the message a member sees. Deposit is checked first
// because it is the condition they can act on.
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

// RecoverFrom is one step of the default waterfall: take what is owed, or all
// that is there, whichever is less.
//
// Never takes more than is owed (which would overcharge) and never takes more
// than exists (which would drive a balance negative). A non-positive source
// contributes nothing.
func RecoverFrom(outstanding, available int64) int64 {
	if outstanding <= 0 || available <= 0 {
		return 0
	}
	if available < outstanding {
		return available
	}
	return outstanding
}

// Waterfall applies RecoverFrom down an ordered list of sources and reports
// what each gave up and what is still unrecovered.
//
// The order is the policy: borrower's own savings first, then the guarantor's,
// then the donation pool. A member's guarantor is never touched for money the
// member could have covered themselves.
//
// deductions is always the same length as sources, so a caller can pair them up
// positionally without bounds checks.
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
