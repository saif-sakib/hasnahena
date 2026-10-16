package money

// Schedule arithmetic: arrears and defaultability, testable against a calendar.

import "time"

// InstallmentsDue counts instalments due by now. The first falls due one
// calendar month after the start; capped at totalInstallments.
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

// MissedInstallments is due minus paid, floored at zero.
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

// IsDefaultable: missed >= loan.missedPaymentsForDefault (threshold < 1 = unset).
func IsDefaultable(missedInstallments, missedPaymentsForDefault int) bool {
	if missedPaymentsForDefault < 1 {
		return false
	}
	return missedInstallments >= missedPaymentsForDefault
}

// NextDueDate is paidInstallments+1 months after the start. ok is false when
// there is none — never substitute a zero time (it reads as arrears). The
// only answer to "next due date" for every screen.
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
