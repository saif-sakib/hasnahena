# ADR-043 — A person's row id is the number they are known by

**Status:** accepted, extended by [ADR-044](adr-044-every-row-is-keyed-by-what-it-is-already-called.md)

**Status.** accepted · 2026-08-27

**Context.** `users.id` was a `cuid()`, and every foreign key in the schema
points at it — so `transactions.userId` read `cmob97efh00003zynz0as5knq` in the
column an operator reading the ledger by hand looks at most, beside a
`receiptNumber` and an `accountNo` that are both perfectly readable. The owner
raised it three times. Twice it was refused, and the refusals were right about
the reasons they gave and wrong about the conclusion.

**What the refusals actually said.** That an account number cannot be a key
because it is null until approval; that renumbering a live row orphans a
Cloudinary folder; that a surrogate key is what lets a business identifier be
corrected. All three are about *changing an id after it has been handed out*.
None of them is about the id being unreadable, which was the complaint.

**Decision.** The id holds the number the person already has:

| | |
|---|---|
| staff | `STF-0001`, allocated when the account is created |
| an applicant | `APP-2026-000001`, allocated when the form is submitted |
| a member | `ACC-KH-33001`, allocated when they are admitted |
| the donation pool | `system_donation_fund`, which it already was |

So `users.id = users.accountNo` for everybody who has been admitted, and the
two-columns-for-one-fact that started the schema audit is gone. There is **no
`@default`**: every writer names the id, and one that forgets fails on a NOT NULL
primary key rather than quietly inventing an opaque one. The TypeScript compiler
enumerates the writers for free, which is why this needed no census test.

**Why it is safe, checked rather than assumed.** All sixteen foreign keys
referencing `users.id` are `ON UPDATE CASCADE`, verified against the live
catalogue. Four columns hold a user id *without* a foreign key. Two —
`token_blacklist.userId` and `notifications.data->>'userId'` — are rewritten, by
the migration and again by `renameUser` in the Go approval.

The other two are `audit_logs.entityId` and `audit_logs.performedBy`, and they
are **not touched**. The first version of this migration rewrote them and the
database refused it on live data: `audit_logs` carries an append-only trigger
(DATA-08) whose comment says UPDATE is never allowed *under any circumstances*,
and whose escape hatch covers DELETE only. That refusal is correct, and weakening
it to make a rename tidy would have spent the guarantee the table exists for on
cosmetics. An audit row saying who the subject was called **at the time** is the
better record anyway.

So the reader resolves instead. `user_id_history` records that one id became
another — one hop by construction, because a rename re-points any mapping that
already pointed at the retired id — and the audit endpoint consults it for any
`entityId` that resolves to nobody. Searching an account number also reaches the
rows written before admission, which is exactly the period somebody investigating
a registration wants to read.

The id changes **once**, at approval, and that moment is the whole argument: an
applicant's password hash is a sentinel bcrypt can never match, so they have
never signed in. There is no token carrying the old value, no session to break,
no third party holding it. After admission it is fixed for ever, which is what
keeps the earlier refusals' reasoning intact — a member is never renumbered, and
their Cloudinary folder is never orphaned.

**Consequences.** Anything holding a user id *across* the rename must re-read it.
There is exactly one such caller — the approvals screen, which files the new
member's documents immediately afterwards — and it answered 404 until it used
the account number the approval returns. `e2e/entry-path.spec.ts` walks the
rename and asserts the cascade: the member is addressable by their account
number, their `Account` followed, the application reference survived, and the old
id addresses nobody.

`transactions.id` was considered for the same treatment and refused:
`receiptNumber` is nullable and not unique, and four inserts in
`loan_repository.go` write none. Making it a key would mean issuing receipt
numbers for the default-recovery legs, which is a change to what a receipt
*means* rather than to how a row is named. `loans.loanNumber` would work and was
left alone as out of scope.

**Superseded on both counts by [ADR-044](adr-044-every-row-is-keyed-by-what-it-is-already-called.md)**,
which made exactly that change to what a receipt means — and was right to: a
default recovery takes money out of a member's savings, and it was the one
posting a member could be shown with no number to quote. `user_id_history` is
gone with it; the reader now resolves an older row through `users.formNumber`,
which held the same string all along.

The seeded admin now gets a staff number too. It had none — nothing failed,
because the column is nullable, but it meant the foundation's first account was
the one account with no number, and only the cutover purge noticed.

---

[← all decisions](../decisions.md)
