package money

// Schedule arithmetic: how far behind a borrower is, and whether that is far
// enough to call the loan defaulted.
//
// Kept here with the rest of the loan maths and away from the SQL, so the
// question "is this loan in default?" has one answer that can be tested against
// a calendar rather than against a database.

import "time"

// InstallmentsDue counts the instalments that should have been paid by `now`.
//
// The first instalment falls due one month AFTER the schedule starts, not on
// the start date: a borrower who receives money on the 1st has until the 1st of
// the following month to make the first payment. Counting from day zero would
// put every loan one instalment behind on the day it was disbursed.
//
// Months rather than 30-day blocks, so a schedule that starts on the 31st stays
// aligned to month ends instead of drifting a day earlier every other month.
//
// The count never exceeds totalInstallments — once the schedule has run out
// there is nothing further to fall due, and a loan that ended two years ago is
// not twenty-four instalments more overdue than one that ended last month.
func InstallmentsDue(installmentStart, now time.Time, totalInstallments int) int {
	if totalInstallments < 1 || installmentStart.IsZero() || now.Before(installmentStart) {
		return 0
	}

	due := 0
	for due < totalInstallments {
		next := installmentStart.AddDate(0, due+1, 0)
		if now.Before(next) {
			break
		}
		due++
	}
	return due
}

// MissedInstallments is how many due instalments remain unpaid.
//
// Payments are not matched to particular instalments anywhere in this system —
// `paidInstallments` is a count — so "missed" is due minus paid. A borrower who
// paid ahead is not in arrears, hence the floor at zero.
func MissedInstallments(installmentStart, now time.Time, totalInstallments, paidInstallments int) int {
	if paidInstallments < 0 {
		paidInstallments = 0
	}
	missed := InstallmentsDue(installmentStart, now, totalInstallments) - paidInstallments
	if missed < 0 {
		return 0
	}
	return missed
}

// IsDefaultable reports whether a loan has missed enough instalments to be
// marked defaulted under `loan.missedPaymentsForDefault`.
//
// A threshold below 1 would let a loan be defaulted the day it was disbursed,
// which is not a policy anyone means to set, so it is treated as unset and the
// caller's default applies before this is reached.
func IsDefaultable(missedInstallments, missedPaymentsForDefault int) bool {
	if missedPaymentsForDefault < 1 {
		return false
	}
	return missedInstallments >= missedPaymentsForDefault
}

// NextDueDate is when the next unpaid instalment falls due.
//
// It is `paidInstallments + 1` months after the schedule starts, for the same
// reason InstallmentsDue counts from one month after the start: the first
// payment is not due on the day the money is handed over.
//
// `ok` is false when there is no next instalment — no schedule, no start date,
// or every instalment already paid. A caller must not substitute a zero time
// for that: every screen treats a due date in the past as arrears, and
// `0001-01-01` is very much in the past.
//
// This exists because three queries each answered "next due date" with a
// different column. `/worker/loans` returned `installmentStartDate`, which is
// behind every active loan by construction, so the worker's loan list showed
// every borrower overdue; `/admin/loans` returned no such field at all, so the
// admin's showed none overdue; and the member's own dashboard was handed
// `expectedEndDate`, the day the *last* instalment is due. Same loans, three
// answers, and the two staff screens are now literally the same component
// rendering them side by side.
func NextDueDate(installmentStart time.Time, totalInstallments, paidInstallments int) (time.Time, bool) {
	if totalInstallments < 1 || installmentStart.IsZero() {
		return time.Time{}, false
	}
	if paidInstallments < 0 {
		paidInstallments = 0
	}
	if paidInstallments >= totalInstallments {
		return time.Time{}, false
	}
	return installmentStart.AddDate(0, paidInstallments+1, 0), true
}
