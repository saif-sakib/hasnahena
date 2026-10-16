# A column that stores what could be derived

- **A stored copy of a computed value is only correct at the instant it is
  written, and nothing tells you when it stops being.** `accounts.maxLoanAmount`
  was inserted as 0 and never updated, and fed the member dashboard's "Max loan
  limit" tile — a member with ৳50,000 saved was told they could borrow nothing
  while the loans page computed the real figure. Before adding a column, ask
  what recomputes it; "nothing, it is set once" is safe only if what it
  describes never changes.
- **A column nothing reads is a column nothing keeps honest.**
  `accounts.isLoanEligible` was written `false` by the Next registration route
  and `true` by the Go approval path, for the same member, for as long as both
  existed — because no query selected it. Two unreconciled writers usually mean
  no reader.

---

[← all traps](../traps.md)
