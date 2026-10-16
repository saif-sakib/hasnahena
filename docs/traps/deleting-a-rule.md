# Deleting a rule

- **A rule you remove needs a test that asserts its absence, or nothing stops it
  coming back.** [ADR-030](../decisions.md) deleted the withdrawal notice period
  and every test of it, leaving nothing that would fail if the gate returned.
  `TestWithdrawalWithNoRequestBehindItIsPaid` and
  `TestAFreshRequestIsPaidImmediately` now assert payment; the
  `WithdrawalRequestReady` message row carries `mustNotContain: ["notice"]`,
  because prose has no compiler.
- **And check what the deletion strands.** An orphaned config reader is caught by
  `golangci-lint`'s `unused`; an empty "no notices outstanding" panel on the
  staff member-detail screen is valid code and caught by nothing. Grep for the
  *concept*, not only the identifier.

---

[← all traps](../traps.md)
