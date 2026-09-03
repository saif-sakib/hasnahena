# ADR-013 — Document numbers are sequential and named

**Status:** accepted · 2026-08-15.

Receipts, withdrawals, loans and repayments were numbered
`RCP-20260815-A3F2B1` — a cryptic prefix plus six random hex characters. That is
hard to read aloud at the counter or copy into a paper passbook, carries no
ordering, and offered no uniqueness guarantee for `loans.loanNumber`, which is
`@unique`: a collision would have failed a money-moving transaction.

Numbers are now `SERIES-YYYY-NNNNNN` with a spelled-out series —
`DEP-2026-000123`, `WDR-2026-000045`, `LOAN-2026-000012`, `REP-2026-000234` —
matching the readability rationale of the `ACC-KH-#####` member IDs (ADR-008).

The counter comes from the `document_sequences` table, one row per series per
year, incremented by an atomic upsert. The Go API allocates inside the same
transaction as the posting, so concurrent postings can never share a number and
a rolled-back posting releases its number instead of leaving a gap. Next.js
route handlers that create request-stage records (loan applications, deposit and
withdrawal requests) allocate from the same table, so a document type has one
series regardless of which backend created the record.

Existing records keep their old numbers; both formats are readable and the
document layer treats a value that already looks like a reference as-is.

---

[← all decisions](../decisions.md)
