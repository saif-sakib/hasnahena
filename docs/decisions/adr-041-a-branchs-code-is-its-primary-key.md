# ADR-041 — A branch's code is its primary key

**Status:** accepted

**Status.** accepted · 2026-08-27

**Context.** `branches` carried a `cuid()` id *and* a unique, required `code`.
Two columns, each uniquely identifying a branch, one of them typed in by an admin
and printed beside the office name, the other never used for anything except
being the target of one foreign key. `users.assignedBranchId` therefore read
`cmob97efh00003zynz0as5knq` in a console, which is the complaint that started the
schema audit.

**Decision.** The code **is** the key. `branches.id = 'KH'`, and the `code`
column is dropped. The request body of the admin API still calls it `code`,
because that is the word for the thing a person types; the row calls it `id`,
because that is what it is.

**Why this is safe here and is not safe for `users`.** A branch has exactly one
inbound foreign key, a handful of rows, and its id has never been written into an
audit row, a document, a Cloudinary folder or a token. A member's id has all
four. That asymmetry is the whole decision: `users.id` stays a cuid and the `v_*`
views exist instead
([ADR-037](adr-037-a-row-has-a-key-for-machines-and-an-identifier-for-people-and-a-view-for-reading.md)).

**Consequences.** The foreign key is `ON UPDATE CASCADE`, so correcting a typo in
an office code rewrites every member and worker attached to it in the same
statement — a capability the surrogate key did not have, because the code could
be changed freely and then named a row nobody could find by it.

`v_people` selected `b.code`, and a view depends on the columns it names, so the
migration replaces the view in the same file. That dependency is invisible to
`pnpm db:migrate:check` — Prisma's `migrate diff` does not model views — and it
was invisible to `test/unit/database-views.test.ts` too, which checked only
*quoted* identifiers on the argument that a bare lowercase column would break
every other query as well. `branches.code` disproved it: nothing else selected
it, so dropping it broke exactly one thing, at `prisma migrate deploy`, during a
deployment. That test now checks the unquoted half, and reads the **latest**
definition of each view rather than the migration that first created them.

---

[← all decisions](../decisions.md)
