# ADR-023 — One member identifier: `users.accountNo`

**Status:** accepted · 2026-08-18.

Reported by the owner: the statement prints "Member ID" and
"Account No" as two labelled rows holding the same string.

It was not a rendering mistake. `accounts.accountNumber` was **assigned the
owner's identifier** in both places an account could be created — `const
accountNumber = memberId` in the registration route, and the same parameter in
`ApproveRegistration`, which additionally re-synced it on every approval. Two
columns, one value, kept equal by hand.

**One of the two survives**, and the codebase had already half decided which:

- It is the **member's** identity, not an account's, and it exists before any
  account does — a `PENDING` registration has one.
- It has a format members read aloud, a sequence allocator behind an advisory
  lock, and a parser, in both languages ([ADR-008](../decisions.md)).
- The **receipt and the loan agreement already used it alone.** Only the
  statement and the membership certificate printed the account number, which is
  what made the duplication visible on exactly two documents out of four.

Nothing ever read `accountNumber` to find a member's account — every lookup is
`WHERE "userId" = $1` — so outside those two documents and one chip on the
profile page, the column was write-only.

**`accounts.userId` is now unique.** That is not tidying: it is required by the
removal. The donation pool was the one row whose account number meant something
(`HN-ACC-DONATION`), and it is now found by its owner, the fixed id
`system_donation_fund` that `pnpm db:seed` assigns. `RecordDonation` takes
`FOR UPDATE` on that row, on a money path, so the predicate has to name exactly
one — a unique constraint is what makes that true rather than merely likely. It
also states the invariant every query already assumed, and the Prisma relation
becomes `User.account Account?` instead of a list nothing ever put two things in.

**No information is lost.** For a member account the value is still in
`users.accountNo` (called `users.memberId` when this was written — see
[ADR-029](adr-029-the-identifier-is-called-an-account-number.md)); for the pool,
the literal is replaced by the owner id.

**What this does not do:** it does not rule out a future where one member holds
several accounts (a separate zakat fund, say — FR-15/16 contemplates per-fund
accounting). If that arrives, the unique constraint is the thing to reconsider,
and an account would then need an identifier **of its own** rather than a second
copy of its owner's.

---

[← all decisions](../decisions.md)
