package utils

// Upper bounds for financial operations, in whole taka (ADR-002).
const (
	// MaxDepositAmount - Maximum single deposit (10 crore BDT)
	MaxDepositAmount int64 = 10_00_00_000

	// MaxWithdrawalAmount - Maximum single withdrawal (10 crore BDT)
	MaxWithdrawalAmount int64 = 10_00_00_000

	// MaxLoanAmount - Maximum loan amount (1 crore BDT)
	MaxLoanAmount int64 = 1_00_00_000

	// MaxDonationAmount - Maximum single donation (10 crore BDT)
	MaxDonationAmount int64 = 10_00_00_000

	// MaxLoanPaymentAmount - Maximum single loan payment (1 crore BDT)
	MaxLoanPaymentAmount int64 = 1_00_00_000

	// MaxPurposeLength - Maximum loan purpose length
	MaxPurposeLength = 500

	// MaxRequestBodySize (1 MB), enforced inside utils.ParseJSON.
	MaxRequestBodySize int64 = 1 * 1024 * 1024
)
