package utils

import (
	"fmt"
	"time"
)

// Document number series, spelled out because they are read aloud (ADR-008).
const (
	SeriesDeposit       = "DEP"  // deposit receipt
	SeriesWithdrawal    = "WDR"  // withdrawal receipt
	SeriesLoan          = "LOAN" // loan agreement — the LOAN itself, never a posting
	SeriesLoanRepayment = "REP"  // loan repayment receipt
	SeriesDonation      = "DON"  // donation receipt
	// SeriesDisbursement numbers the posting that pays out or tops up a loan,
	// so neither consumes a loan number.
	SeriesDisbursement = "DSB"
	// SeriesAdjustment: the donation-pool draw that settles a default. Never
	// "FEE" — the platform charges none (rule 3).
	SeriesAdjustment = "ADJ"
)

// NextDocumentNumberQuery atomically allocates the next number for the year;
// rollback releases it, keeping the series gapless. Timestamps are written
// explicitly: Prisma's @updatedAt has no DB default.
const NextDocumentNumberQuery = `
	INSERT INTO document_sequences (series, year, counter, "createdAt", "updatedAt")
	VALUES ($1, $2, 1, NOW(), NOW())
	ON CONFLICT (series, year)
	DO UPDATE SET counter = document_sequences.counter + 1, "updatedAt" = NOW()
	RETURNING counter
`

// CurrentSequenceYear is the year new document numbers are filed under.
func CurrentSequenceYear() int {
	return time.Now().Year()
}

// FormatDocumentNumber renders e.g. "DEP-2026-000123".
func FormatDocumentNumber(series string, year int, counter int64) string {
	return fmt.Sprintf("%s-%d-%06d", series, year, counter)
}
