package utils

import (
	"fmt"
	"time"
)

// Document number series. These strings are printed on receipts, passbooks and
// PDFs, so they are spelled out rather than abbreviated to initials — a member
// reading "LOAN-2026-000012" aloud at the counter needs no decoding, which is
// the same reasoning that gave member IDs their ACC-KH-##### shape (ADR-008).
const (
	SeriesDeposit       = "DEP"  // deposit receipt
	SeriesWithdrawal    = "WDR"  // withdrawal receipt
	SeriesLoan          = "LOAN" // loan agreement — the LOAN itself, never a posting
	SeriesLoanRepayment = "REP"  // loan repayment receipt
	SeriesDonation      = "DON"  // donation receipt
	// SeriesDisbursement numbers the POSTING that pays a loan out, and the one
	// that tops it up. Both used to allocate from SeriesLoan: the disbursement
	// carried the loan's own number, so one string named two different
	// documents, and a top-up consumed a fresh loan number for a transaction —
	// a gap in the register of loans, punched by something that is not a loan.
	SeriesDisbursement = "DSB"
	// SeriesAdjustment numbers a posting the foundation makes against itself
	// rather than for a member: today, the draw on the donation pool that
	// settles a defaulted loan. Deliberately not "FEE", whatever the enum label
	// says — this platform charges none (rule 3) and a document numbered
	// FEE-2026-000001 would be the wrong thing to hand anybody.
	SeriesAdjustment = "ADJ"
)

// NextDocumentNumberQuery allocates the next number in a series for the current
// year. The upsert is atomic: concurrent callers serialise on the row, so two
// transactions can never be handed the same number. Rolling back a failed
// transaction also rolls back the allocation, which keeps the series gapless.
//
// "createdAt" and "updatedAt" are written explicitly and must stay that way.
// Prisma models them with @default(now()) and @updatedAt — and @updatedAt is
// applied by the Prisma client, not by the database, so `prisma db push`
// actively *strips* any DEFAULT from that column. Relying on the default meant
// the first allocation of a series failed a NOT NULL check the moment anyone
// ran a db push, taking every deposit, withdrawal, loan and repayment with it,
// since all four allocate a number inside their transaction.
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

// FormatDocumentNumber renders a series, year and counter as, e.g.,
// "DEP-2026-000123".
func FormatDocumentNumber(series string, year int, counter int64) string {
	return fmt.Sprintf("%s-%d-%06d", series, year, counter)
}
