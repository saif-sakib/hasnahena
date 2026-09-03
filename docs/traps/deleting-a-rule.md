# Deleting a rule

**A rule you remove needs a test that asserts its absence, or nothing stops it
coming back.** [ADR-030](../decisions.md) deleted the withdrawal notice period. Every
test that had covered it was deleted with it — which left a suite where
reintroducing the gate would break nothing, because no assertion said "this must
be paid". Two tests now do exactly that:
`TestWithdrawalWithNoRequestBehindItIsPaid` and `TestAFreshRequestIsPaidImmediately`.

The same shape applies to wording. `WithdrawalRequestReady` replaced a builder
that told the member their "notice period has elapsed", and its test row carries
`mustNotContain: ["notice"]` — because the natural way to write that message is
the way it used to read, and prose has no compiler.

**And check what the deletion strands.** Removing the two config readers left
`getSystemConfigNonNegativeInt64Tx` with no callers, which `golangci-lint`'s
`unused` catches; removing the member-side notice left an empty panel on the
staff member-detail screen, which nothing catches, because a card that says "no
notices outstanding" forever is valid code. Grep for the *concept*, not only for
the identifier.

---

[← all traps](../traps.md)
