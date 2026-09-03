# A column that stores what could be derived

**A stored copy of a computed value is only correct at the instant it is
written, and nothing tells you when it stops being.** `accounts.maxLoanAmount`
was inserted as 0 with the account and never updated by anything — no deposit
touched it, no admin screen set it, no migration backfilled it. Two production
queries selected it, and one of them fed the "Loan Eligibility / Max loan limit"
tile on the member dashboard, the first screen a member sees. So a member with
50,000 taka saved was told they could borrow nothing, while the loans page two
clicks away computed `savings x loan.maxLoanMultiplier` and showed the real
number. Neither screen was wrong about its own inputs; they had different inputs.

**A column nothing reads is a column nothing keeps honest.**
`accounts.isLoanEligible` was written by both creation paths with *opposite*
values — the Next registration route wrote `false`, the Go approval path wrote
`true`, for the same member, minutes apart — and it had been that way for as long
as both paths existed, because no query ever selected it. The disagreement was
not the bug; it was the *evidence* that the column was dead. Look for this shape
whenever two writers of one column have never been reconciled: usually it means
nothing reads it.

The rule that follows: **before adding a column, ask what recomputes it.** If the
answer is "nothing, it is set once", it is only safe when the thing it describes
also never changes. A balance changes. A multiplier in `system_config` changes.

---

[← all traps](../traps.md)
