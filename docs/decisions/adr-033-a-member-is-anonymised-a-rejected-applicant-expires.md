# ADR-033 — A member is anonymised; a rejected applicant expires

**Status:** accepted · owner decision 2026-08-25 · WO-93 · implements FR-23.

Workers could be deleted. Members could not — there was no endpoint, no screen
and no repository method — and a rejected applicant's row was kept forever with
their address, both parents' names, their NID number and their photo URL, under a
tombstoned email and phone. Keeping the *decision* is defensible; keeping the
identity documents of somebody the foundation refused, permanently and with
nothing that could ever remove them, is a different question, and it was the
owner's to answer.

Three rules came out of it, and each one exists because the obvious alternative
is wrong in a specific way.

**1. A member with postings is anonymised, never deleted.** The ledger is summed
hourly and compared to the stored balances ([ADR-027](adr-027-the-reconciliation-job-reports-and-never-repairs.md)).
A posting whose owner has vanished does not make the sum *smaller*; it makes it
permanently wrong, and it makes every past `audit_logs` row point at nobody. So
erasure strips the person and keeps the money: the identity columns are cleared,
contact is tombstoned, and `accountNo`, the `Account`, every `Transaction` and
every `Loan` are untouched. A member with no postings is deleted outright and
the cascade takes the rest.

Which of the two happens is decided by counting references, not by asking. The
database would refuse the delete regardless — `transactions.userId` and
`loans.borrowerId` are `ON DELETE RESTRICT`, because neither declares a cascade —
so without the count the answer to "delete this member" is a 500 with a foreign
key in it. The count is what turns a constraint into an answer, which is the same
shape as [rule 2b](../../CLAUDE.md).

**2. Erasure ends the session in the same transaction.** The revoke-all marker is
written beside the anonymisation, for the reason
[ADR-031](adr-031-a-password-reset-is-one-transaction-and-the-table-behind-it-holds-no-secrets.md)
gives about the password: a member whose identity has been removed but whose
token still works is a live session belonging to an account that no longer
describes anybody.

**3. The audit row names the account number, never what was erased.**
`audit_logs` is append-only (FR-19, DATA-08). An erasure that recorded its
`oldValue` the way `WORKER_UPDATED` does would copy the NID number, the parents'
names and the address into a table nothing can delete from — erasure that
preserves what it erases. The row carries the account number, the approving
admin, the reason and the counts; the worker handler's `oldValue` pattern is
deliberately *not* followed here, and that is the one place WO-93's "follow the
worker handler exactly" had to be disobeyed.

**Where each half runs.** The erasure endpoint is a Next route, not a Go one.
This is not a balance change, so [ADR-001](adr-001-go-api-owns-money-nextjs-owns-content.md)
does not send it to Go — and the deciding factor is Cloudinary: the photograph is
the second most sensitive item after the NID number, `deleteImage` exists only in
`apps/web/lib/cloudinary.ts`, and an erasure that cleared `avatarUrl` while
leaving the image served from a public CDN would be theatre. The retention sweep
for rejected applications runs in the Go API instead, on the same ticker pattern
as reconciliation, because it needs an always-on process and it needs no
Cloudinary at all: `avatarUrl` is only ever written by a signed-in member on
their own profile page, and a rejected applicant has never signed in. The sweep
logs an error rather than silently clearing the column if it ever meets one, so
the assumption fails loudly instead of leaking.

**One year, not ninety days and not immediately.** A rejection can be
re-examined — an applicant re-applies, a family disputes what was submitted — and
the window is what makes that possible. It is a `system_config` key
(`security.rejectedRetentionDays`) rather than a constant, so shortening it is an
admin decision rather than a deploy.

---

[← all decisions](../decisions.md)
