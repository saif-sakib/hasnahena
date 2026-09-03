# ADR-044 — Every row is keyed by what it is already called

**Status:** accepted

**Status.** accepted · 2026-09-01

**Context.** [ADR-043](adr-043-a-persons-row-id-is-the-number-they-are-known-by.md)
made `users.id` the account number and stopped there, for reasons that were
sound at the time and are recorded above. What it left behind was the same
defect in six more tables: a `cuid()` sitting beside the identifier the row
actually has, or beside the column that already identified it uniquely.

Two of those surrogate keys were being **printed**. `audit_logs.entityId` holds
a loan's key on `LOAN_DISBURSED` and an account's key on `WITHDRAWAL_POSTED`, so
an admin reading the trail saw `cmob97efh00003zynz0as5knq` for a loan whose
agreement, whose notification and whose repayment receipt all called it
`LOAN-2026-000012`. That is the owner's report — *"audit logs also showing
gibberish ids"* — and it is a reading of the same fact ADR-043 acted on.

**Decision.** Every key is the thing's own identifier, or the identity of what it
belongs to.

| table | key | reads |
|---|---|---|
| `accounts` | `userId` | `ACC-KH-33001` |
| `nominees` | `userId` | `ACC-KH-33001` |
| `addresses` | (`userId`, `type`) | `ACC-KH-33001` / `PERMANENT` |
| `documents` | (`userId`, `type`) | `ACC-KH-33001` / `nid_front` |
| `transactions` | the receipt number | `DEP-2026-000001` |
| `loans` | the loan number | `LOAN-2026-000012` |
| `audit_logs`, `notifications`, `gallery_items` | a sequence | `#1`, `#2`, `#3` |

Three columns holding a second copy of a fact are gone with them:
`transactions."receiptNumber"`, `loans."loanNumber"`, and the `accountId` on
both — which was NOT NULL, always equal to the `userId` in the next column, and
the column an insert in `loan_repository.go` had already once forgotten, writing
a default recovery that failed silently while the debt was written down anyway.

**What this cost, and why it is the right price.**

*Every posting now carries a number.* `receiptNumber` was nullable, and the four
inserts that wrote none were a disbursement, a recovery from the borrower's
savings, a recovery from the guarantor's, and a draw on the donation pool. Those
are not obscure rows: a recovery takes money out of somebody's account, and it
was the posting they were least able to ask about, because there was nothing to
quote. They get `DSB-`, `WDR-` and `ADJ-` numbers now. The disbursement's series
is deliberately **not** `LOAN-`: it used to take the loan's own number, so one
string named two different documents, and a *top-up* consumed a fresh loan number
for something that is not a loan — a permanent gap in the register of loans,
punched by a posting.

*`ADJ`, not `FEE`.* The enum label on a donation-pool recovery is `FEE`, because
that is the `TransactionType` this schema has. The document must not agree with
it. This foundation charges no fee of any kind (rule 3), and handing somebody a
receipt headed `FEE-2026-000001` is a written statement that it does.
`TestNoDocumentSeriesIsNamedFee` pins that.

*A member's bKash reference got its own column.* `receiptNumber` was holding two
unrelated facts, told apart by nothing but the row's status: a number the
foundation issues, and the **bKash TrxID a member typed into a request**.
Searching the ledger by receipt therefore matched member references too, and a
request that was later confirmed had its reference overwritten by the receipt —
losing the only link back to the payment. It is `externalReference` now, and the
migration moves anything not shaped like one of this foundation's document
numbers into it.

*One reconciliation check became unrepresentable.* `transaction_owner` compared
a posting's `userId` against the owner of the `accountId` beside it. With one
column there is nothing to disagree with, so the check is deleted rather than
left to pass for ever. An invariant the schema makes impossible beats one a job
re-checks every hour.

**The audit trail, and the trigger.** `audit_logs` is append-only at the database
level (DATA-08) and its trigger refuses UPDATE unconditionally. ADR-043 declined
to rewrite it and built `user_id_history` instead. This migration **does** rewrite
it, once, with the trigger suspended for the length of one statement block inside
a single transaction, on the owner's explicit instruction (2026-09-01) — and the
migration appends a `SCHEMA_IDS_MIGRATED` row saying so.

That is a real cost and it was weighed. What paid for it: the rows are few; the
mechanism that made the rewrite avoidable is itself the redundancy being removed;
and a trail whose subject column reads as an opaque string is not serving the
purpose the trigger protects. **No permanent escape hatch was added.**
`SET LOCAL hasnahena.allow_audit_purge` still covers DELETE only, and the trigger
was verified enabled and refusing writes on the migrated database before this was
written.

Going forward there is nothing to rewrite. A person's id still moves once, at
admission, and the value the older rows hold is `APP-2026-000001` — the
applicant's own form number, which `users.formNumber` still stores. The audit
reader resolves through that column, in the same query, with no mapping table.
`renameUser` no longer writes one.

**Why it is safe on live data.** The migration refuses rather than guesses. It
raises if a posting's `accountId` names an account belonging to somebody else, if
two postings share a receipt number, if one `addresses` row is somebody's
permanent *and* present address (which the old pair of nullable keys allowed and
which would silently lose one), or if a person has two documents of one type.
Each of those is a fact about the foundation's data that a person has to look at.

It was rehearsed before it was written: a database was migrated to the state
*before* this change, populated with a row of every shape — a printed receipt, a
bKash reference in the receipt column, a posting with no number, a disbursement
carrying the loan's number, an audit row per entity type, a retired user id, a
notification carrying both `loanId` and `loanNumber` — and then migrated. Every
id came out readable, balances were untouched, `document_sequences` advanced past
everything it had issued, the views rebuilt, `prisma migrate diff` reported no
drift, and the trigger refused the next UPDATE.

**Consequences.** `transactions.id` and `loans.id` have no default, so the
compiler names any writer that forgets one — but not one that *supplies* an
opaque one, which is what every call site did before. `TestPostingsAndLoansAreNumbered`
reads the repository source and fails on a `gen_random_uuid()` in either insert.
The first version of that test passed against a deliberately planted defect
because its regex stopped at the column list; it now reads to the end of the SQL
literal, which is where the id actually comes from.

`transactions."externalReference"` is the only place a member's own reference may
live. A withdrawal that settles an outstanding request keeps the request's
number rather than allocating a second — the allocation moved inside the branch
that needs it, because issuing a number no document bears is a gap in a series
whose only value is that it has none.

---

[← all decisions](../decisions.md)
