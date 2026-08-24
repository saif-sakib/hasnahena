// Package notify builds the text of every member- and staff-facing
// notification. It holds no database handle and no side effects: each builder
// is a pure func returning (title, message), which is what makes the wording
// testable without a database, a transaction, or a mock.
//
// WO-52. The repositories used to build these strings inline at the call site,
// and nothing asserted what any of them said — the integration suites counted
// notification rows without ever reading one. That is how LEDGER-07 survived:
// every amount was rendered with `%.2f` from a `float64`, so a member holding
// ৳50,000 was told "BDT 50000.00", printing two paisa digits in a system that
// has no paisa (CLAUDE.md rule 1) and no thousands separator either.
//
// # The rule this package exists to enforce
//
// Money is BigInt whole taka. It arrives here as an `int64` and is rendered by
// FormatTaka. There is no float64 in this file and there must never be one:
// `%.2f` on an amount is the defect, not the formatting choice.
//
// # Adding a notification
//
// Add the builder here, then add a row to the table in messages_test.go. The
// census test enumerates the exported builders from this file's source and
// fails when one has no test row — the same discipline the balance writers have
// under TestBalanceWritersAreEnumerated, and for the same reason: this is a set
// of near-identical functions where the next one gets added without the test.
package notify

import (
	"fmt"
	"strings"
)

// CurrencyCode prefixes every rendered amount. Kept as a constant so the census
// test can assert the unit is stated — "your loan for 50,000 has been approved"
// is ambiguous in a country that borders two other rupee-and-taka economies.
const CurrencyCode = "BDT"

// FormatTaka renders whole taka with thousands separators: 50000 → "50,000".
//
// The grouping deliberately matches `formatCurrency` in apps/web/lib/utils.ts,
// which the dashboard uses for the same figures the notification list sits
// beside. It is NOT the lakh-crore grouping in lib/documents/format.ts — that
// one is for generated PDFs, and a member seeing "12,34,567" in the app and
// "1,234,567" on screen next to it would reasonably ask which is real.
//
// No decimal point is ever emitted, because there is no sub-taka unit to put
// after one.
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

// DepositPostedForStaff is the worker's own task feed. It carries no amount on
// purpose: the staff feed is a work list, and a member's balance movement is
// not something every worker needs pushed at them.
func DepositPostedForStaff(memberID string) (string, string) {
	return "Daily task update",
		fmt.Sprintf("Deposit recorded for member %s.", strings.ToUpper(memberID))
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

// WithdrawalNoticeSubmitted and WithdrawalNoticeForStaff are gone with the
// member-side notice they announced (ADR-030). A member no longer files a
// notice, so nothing has a maturity date to report.

// WithdrawalRequestReady tells a member an outstanding withdrawal request has
// been cleared for the desk.
//
// It is the one survivor of the FR-08 wording, and it no longer mentions a
// notice period: the request is ready because an admin said so, not because a
// clock ran out.
func WithdrawalRequestReady(amount int64) (string, string) {
	return "Withdrawal ready",
		fmt.Sprintf("%s is ready to be paid. Collect it from your field worker.", Money(amount))
}

// WithdrawalProcessed is sent when the money actually leaves the account.
func WithdrawalProcessed(amount int64) (string, string) {
	return "Withdrawal processed",
		fmt.Sprintf("A withdrawal of %s has been processed from your account.", Money(amount))
}

// WithdrawalPostedForStaff is the worker's task feed; see DepositPostedForStaff
// for why it carries no amount.
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

// LoanToppedUp tells a borrower staff have added to their existing loan.
//
// It names the new instalment as well as the amount added, because that is what
// changes for them: the schedule keeps its original end date and each remaining
// payment goes up (money.TopUpPlan). A member told only "20,000 added" would
// discover the larger instalment at the next collection.
//
// No rate, no markup, no fee — the added amount and the outstanding total are
// the same money (rule 3).
func LoanToppedUp(loanNumber string, addedAmount, outstanding, installmentAmount int64) (string, string) {
	return "Loan increased",
		fmt.Sprintf(
			"%s has been added to your loan %s. You now owe %s, and each remaining instalment is %s.",
			Money(addedAmount), loanNumber, Money(outstanding), Money(installmentAmount))
}

// LoanToppedUpForStaff is the worker's task feed; see DepositPostedForStaff for
// why it carries no amount.
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

// LoanRepaymentRequestApproved answers an approved repayment request. The final
// instalment gets its own wording — "approved" alone would leave a member who
// has just cleared their debt unsure whether they still owe anything.
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

// LoanDefaulted tells the borrower their loan has been marked defaulted and the
// settlement waterfall has run. It states the debt, not the recovery, because
// what was taken from whom is on the loan and in the audit log; a summary line
// that disagreed with either would be worse than none.
func LoanDefaulted(loanNumber string, outstandingAmount int64) (string, string) {
	return "Loan marked defaulted",
		fmt.Sprintf("Your loan %s with %s outstanding has been marked defaulted and settlement has begun.",
			loanNumber, Money(outstandingAmount))
}

// ---------------------------------------------------------------------------
// Requests, registration
// ---------------------------------------------------------------------------

// TransactionRejected answers a rejected deposit, withdrawal or repayment
// request. transactionType is the enum value ("LOAN_REPAYMENT"), rendered into
// prose.
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

// appendReason adds an admin's free-text reason to a message.
//
// The reason is typed by a person into a box, so it arrives with whatever
// punctuation they felt like — usually none. Terminating it here is not
// cosmetic: "Reason: income unverified" reads as a sentence that was cut off,
// which is exactly the impression not to give someone whose loan was just
// refused.
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
