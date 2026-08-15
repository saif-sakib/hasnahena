package utils

// Upper bounds for financial operations, in whole Taka (ADR-002).
//
// Handlers enforce these inline alongside a `<= 0` lower-bound check, e.g.
//
//	if req.Amount <= 0 { ... }
//	if req.Amount > utils.MaxDepositAmount { ... }
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

	// MaxRequestBodySize - Maximum request body size (1 MB).
	//
	// Enforced inside utils.ParseJSON, which wraps r.Body in an io.LimitReader,
	// so every JSON handler is bounded without changing its call site.
	MaxRequestBodySize int64 = 1 * 1024 * 1024
)
