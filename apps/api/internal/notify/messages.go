// Package notify builds the text of every member- and staff-facing
// notification as pure (title, message) builders. Money is int64 whole taka,
// rendered by FormatTaka — never float64 (rule 1). A new builder needs a row
// in messages_test.go; the census fails otherwise.
package notify

import (
	"fmt"
	"strings"
)

// CurrencyCode prefixes every rendered amount.
const CurrencyCode = "BDT"

// FormatTaka renders whole taka with thousands separators (50000 → "50,000"),
// matching formatCurrency in apps/web/lib/utils.ts — not the lakh grouping of
// the PDFs. Never a decimal point.
func FormatTaka(amount int64) string {
	negative := amount < 0
	digits := fmt.Sprintf("%d", amount)
	if negative {
		digits = digits[1:]
	}

	var b strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}

	if negative {
		return "-" + b.String()
	}
	return b.String()
}

// Money renders an amount with its unit: 50000 → "BDT 50,000".
func Money(amount int64) string {
	return CurrencyCode + " " + FormatTaka(amount)
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

// DepositRequestSubmitted confirms to the member that their request was filed.
func DepositRequestSubmitted(amount int64) (string, string) {
	return "Deposit request submitted",
		fmt.Sprintf("Your deposit request for %s has been submitted and is awaiting review.", Money(amount))
}

// DepositRequestForStaff tells admins and workers a request is waiting.
func DepositRequestForStaff(memberName string, amount int64, bkashReference string) (string, string) {
	return "New deposit request",
		fmt.Sprintf("%s submitted a deposit request for %s (bKash ref: %s).",
			memberName, Money(amount), bkashReference)
}

// DepositRequestApproved is sent when an admin approves a pending deposit.
func DepositRequestApproved(amount int64) (string, string) {
	return "Deposit request approved",
		fmt.Sprintf("Your deposit request for %s has been approved.", Money(amount))
}

// DepositConfirmed is sent when a worker posts a deposit directly.
func DepositConfirmed(amount int64) (string, string) {
	return "Deposit confirmed",
		fmt.Sprintf("A deposit of %s has been confirmed in your account.", Money(amount))
}

// DepositPostedForStaff is the worker's task feed; staff feeds carry no amount.
func DepositPostedForStaff(memberID string) (string, string) {
	return "Daily task update",
		fmt.Sprintf("Deposit recorded for member %s.", strings.ToUpper(memberID))
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

// WithdrawalRequestReady tells a member an outstanding withdrawal request is
// cleared for the desk (no notice period — ADR-030).
func WithdrawalRequestReady(amount int64) (string, string) {
	return "Withdrawal ready",
		fmt.Sprintf("%s is ready to be paid. Collect it from your field worker.", Money(amount))
}

// WithdrawalProcessed is sent when the money actually leaves the account.
func WithdrawalProcessed(amount int64) (string, string) {
	return "Withdrawal processed",
		fmt.Sprintf("A withdrawal of %s has been processed from your account.", Money(amount))
}

// WithdrawalPostedForStaff is the worker's task feed (no amount).
func WithdrawalPostedForStaff(memberID string) (string, string) {
	return "Daily task update",
		fmt.Sprintf("Withdrawal processed for member %s.", strings.ToUpper(memberID))
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------

// LoanApproved is sent when an admin approves a loan request.
func LoanApproved(loanNumber string, principalAmount int64) (string, string) {
	return "Loan approved",
		fmt.Sprintf("Your loan request %s for %s has been approved.", loanNumber, Money(principalAmount))
}

// LoanRejected carries the admin's reason when one was given.
func LoanRejected(loanNumber, reason string) (string, string) {
	message := fmt.Sprintf("Your loan request %s has been rejected.", loanNumber)
	return "Loan request rejected", appendReason(message, reason)
}

// LoanDisbursed is sent when a worker hands the money over.
func LoanDisbursed(loanNumber string, amount int64) (string, string) {
	return "Loan disbursed",
		fmt.Sprintf("Your loan %s for %s has been disbursed.", loanNumber, Money(amount))
}

// LoanDisbursedForStaff is the worker's task feed.
func LoanDisbursedForStaff(loanNumber, memberID string) (string, string) {
	return "Daily task update",
		fmt.Sprintf("Loan %s disbursed for member %s.", loanNumber, strings.ToUpper(memberID))
}

// LoanToppedUp names the new instalment too, since the end date stays and each
// remaining payment rises (money.TopUpPlan). No rate or fee (rule 3).
func LoanToppedUp(loanNumber string, addedAmount, outstanding, installmentAmount int64) (string, string) {
	return "Loan increased",
		fmt.Sprintf(
			"%s has been added to your loan %s. You now owe %s, and each remaining instalment is %s.",
			Money(addedAmount), loanNumber, Money(outstanding), Money(installmentAmount))
}

// LoanToppedUpForStaff is the worker's task feed (no amount).
func LoanToppedUpForStaff(loanNumber, memberID string) (string, string) {
	return "Daily task update",
		fmt.Sprintf("Loan %s increased for member %s.", loanNumber, strings.ToUpper(memberID))
}

// LoanRepaymentRequestSubmitted confirms a member's repayment request.
func LoanRepaymentRequestSubmitted(amount int64) (string, string) {
	return "Loan repayment request submitted",
		fmt.Sprintf("Your loan repayment request for %s has been submitted and is awaiting review.", Money(amount))
}

// LoanRepaymentRequestForStaff tells admins and workers a repayment is waiting.
func LoanRepaymentRequestForStaff(memberName, loanNumber, bkashReference string, amount int64) (string, string) {
	return "New loan repayment request",
		fmt.Sprintf("%s submitted a loan repayment request for %s (Loan %s, bKash ref: %s).",
			memberName, Money(amount), loanNumber, bkashReference)
}

// LoanRepaymentRequestApproved; the final instalment gets its own wording.
func LoanRepaymentRequestApproved(amount int64, loanCompleted bool) (string, string) {
	if loanCompleted {
		return "Loan completed",
			fmt.Sprintf("Your final repayment request for %s has been approved and the loan is now completed.", Money(amount))
	}
	return "Loan repayment approved",
		fmt.Sprintf("Your loan repayment request for %s has been approved.", Money(amount))
}

// LoanRepaymentRecorded is sent when a worker posts a repayment directly.
func LoanRepaymentRecorded(amount int64, loanCompleted bool) (string, string) {
	if loanCompleted {
		return "Loan completed",
			fmt.Sprintf("Your loan has been completed with a final repayment of %s.", Money(amount))
	}
	return "Loan repayment received",
		fmt.Sprintf("A loan repayment of %s has been recorded.", Money(amount))
}

// LoanRepaymentRecordedForStaff is the worker's task feed.
func LoanRepaymentRecordedForStaff(memberID string, amount int64) (string, string) {
	return "Daily task update",
		fmt.Sprintf("Loan repayment recorded for member %s (%s).", strings.ToUpper(memberID), Money(amount))
}

// LoanDefaulted states the debt, not the recovery (that is on the loan and
// in the audit log).
func LoanDefaulted(loanNumber string, outstandingAmount int64) (string, string) {
	return "Loan marked defaulted",
		fmt.Sprintf("Your loan %s with %s outstanding has been marked defaulted and settlement has begun.",
			loanNumber, Money(outstandingAmount))
}

// ---------------------------------------------------------------------------
// Requests, registration
// ---------------------------------------------------------------------------

// TransactionRejected answers a rejected request; transactionType is the enum value.
func TransactionRejected(transactionType, reason string) (string, string) {
	label := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(transactionType), "_", " "))
	message := "Your payment request was rejected."
	if label != "" {
		message = fmt.Sprintf("Your %s request was rejected.", label)
	}
	return "Request rejected", appendReason(message, reason)
}

// RegistrationApproved welcomes a new member.
func RegistrationApproved() (string, string) {
	return "Account Approved",
		"Your membership has been approved. Please log in and change your password."
}

// RegistrationApprovedForStaff is the worker's task feed.
func RegistrationApprovedForStaff() (string, string) {
	return "Daily task update",
		"A member registration has been approved and is now active."
}

// appendReason adds an admin's free-text reason, terminated as a sentence.
func appendReason(message, reason string) string {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return message
	}
	if !strings.HasSuffix(reason, ".") && !strings.HasSuffix(reason, "!") && !strings.HasSuffix(reason, "?") {
		reason += "."
	}
	return fmt.Sprintf("%s Reason: %s", message, reason)
}
