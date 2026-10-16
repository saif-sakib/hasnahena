package utils

import (
	"strings"
	"testing"
)

// Document numbers are printed on receipts and read aloud at the counter, so
// the shape is part of the product, not an internal detail (ADR-013).
func TestFormatDocumentNumber(t *testing.T) {
	tests := []struct {
		name    string
		series  string
		year    int
		counter int64
		want    string
	}{
		{"first deposit of the year", SeriesDeposit, 2026, 1, "DEP-2026-000001"},
		{"withdrawal", SeriesWithdrawal, 2026, 123, "WDR-2026-000123"},
		{"loan agreement", SeriesLoan, 2026, 12, "LOAN-2026-000012"},
		{"repayment", SeriesLoanRepayment, 2026, 4567, "REP-2026-004567"},
		{"counter fills the six digits", SeriesDeposit, 2026, 999999, "DEP-2026-999999"},
		{"counter beyond six digits is not truncated", SeriesDeposit, 2026, 1000000, "DEP-2026-1000000"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := FormatDocumentNumber(tc.series, tc.year, tc.counter); got != tc.want {
				t.Errorf("FormatDocumentNumber(%q, %d, %d) = %q, want %q",
					tc.series, tc.year, tc.counter, got, tc.want)
			}
		})
	}
}

// Two documents in the same series and year must never render identically —
// that is what makes the number usable as a reference.
func TestFormatDocumentNumberIsUniquePerCounter(t *testing.T) {
	seen := make(map[string]int64)
	for counter := int64(1); counter <= 2000; counter++ {
		number := FormatDocumentNumber(SeriesDeposit, 2026, counter)
		if previous, clash := seen[number]; clash {
			t.Fatalf("counters %d and %d both render as %q", previous, counter, number)
		}
		seen[number] = counter
	}
}

// The series constants are spelled out rather than abbreviated to initials, and
// nothing downstream should be parsing them case-insensitively.
func TestDocumentSeriesAreDistinctAndUppercase(t *testing.T) {
	series := []string{SeriesDeposit, SeriesWithdrawal, SeriesLoan, SeriesLoanRepayment}

	seen := make(map[string]bool, len(series))
	for _, s := range series {
		if s == "" {
			t.Error("a series constant is empty")
		}
		if s != strings.ToUpper(s) {
			t.Errorf("series %q is not uppercase", s)
		}
		if seen[s] {
			t.Errorf("series %q is duplicated", s)
		}
		seen[s] = true
	}
}

func TestCurrentSequenceYearIsPlausible(t *testing.T) {
	// Guards against a zero or obviously wrong year sneaking into a document
	// number, which would be permanent once printed.
	if year := CurrentSequenceYear(); year < 2024 || year > 2200 {
		t.Errorf("CurrentSequenceYear() = %d, which is not a plausible year", year)
	}
}

// The query writes its own timestamps; Prisma's @updatedAt has no DB default.
func TestNextDocumentNumberQueryWritesItsOwnTimestamps(t *testing.T) {
	insertColumns := NextDocumentNumberQuery[:strings.Index(NextDocumentNumberQuery, "VALUES")]

	for _, column := range []string{`"createdAt"`, `"updatedAt"`} {
		if !strings.Contains(insertColumns, column) {
			t.Errorf("NextDocumentNumberQuery must insert %s explicitly, not rely on a database default", column)
		}
	}

	if !strings.Contains(NextDocumentNumberQuery, `DO UPDATE SET counter = document_sequences.counter + 1`) {
		t.Error("NextDocumentNumberQuery must increment the counter on conflict")
	}
	if !strings.Contains(NextDocumentNumberQuery, `RETURNING counter`) {
		t.Error("NextDocumentNumberQuery must return the allocated counter")
	}
}
