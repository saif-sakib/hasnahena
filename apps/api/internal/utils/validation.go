package utils

// Validation constants for financial operations
// Amounts are in paisa (smallest unit, 100 paisa = 1 BDT)

const (
	// MaxDepositAmount - Maximum single deposit (10 crore BDT = 100 million BDT)
	MaxDepositAmount int64 = 10_00_00_00_000 // 10 crore in paisa

	// MaxWithdrawalAmount - Maximum single withdrawal (10 crore BDT)
	MaxWithdrawalAmount int64 = 10_00_00_00_000

	// MaxLoanAmount - Maximum loan amount (1 crore BDT)
	MaxLoanAmount int64 = 1_00_00_00_000

	// MaxDonationAmount - Maximum single donation (10 crore BDT)
	MaxDonationAmount int64 = 10_00_00_00_000

	// MaxLoanPaymentAmount - Maximum single loan payment (1 crore BDT)
	MaxLoanPaymentAmount int64 = 1_00_00_00_000

	// MinPasswordLength - Minimum password length
	MinPasswordLength = 8

	// MaxPurposeLength - Maximum loan purpose length
	MaxPurposeLength = 500

	// MaxNotesLength - Maximum transaction notes length
	MaxNotesLength = 1000

	// MaxRequestBodySize - Maximum request body size (1 MB)
	MaxRequestBodySize int64 = 1 * 1024 * 1024
)

// ValidateAmount checks if amount is within acceptable range
func ValidateAmount(amount int64, maxAmount int64) bool {
	return amount > 0 && amount <= maxAmount
}

// ValidateStringLength checks if string is within acceptable length
func ValidateStringLength(s string, maxLen int) bool {
	return len(s) <= maxLen
}

// BDT phone number regex pattern
const PhonePattern = `^01[3-9]\d{8}$`
