# ADR-037 — A row has a key for machines and an identifier for people, and a view for reading

**Status:** accepted · 2026-08-27.

**Context.** Every table in this schema is keyed on a `cuid()`, and every join is
between two of them. Opening `users` in the Neon console shows a column of
`cmob97efh00003zynz0as5knq`; answering "what did this member deposit last week"
by hand means copying opaque strings between three queries. The reasonable
reaction — and the one that prompted this — is that `users.id` and
`users.accountNo` look like the same fact stored twice.

**They are not the same fact.**

- `accountNo` is **null until an application is approved.** A pending applicant
  already has a row, an address, a nominee and four uploaded documents. A primary
  key cannot be null, so the key cannot be this.
- `accountNo` is a *business* identifier: `ACC-KH-33001`, continuing the
  foundation's paper register, read aloud and written into passbooks
  ([ADR-008](adr-008-member-ids-are-acc-kh-.md), [ADR-023](adr-023-one-member-identifier-usersaccountno.md)).
  Business identifiers get **corrected** — a wrong branch prefix, a duplicate
  found in the paper register. A key that changes has to cascade through every
  foreign key that points at it, and through the Cloudinary folder named after it.
- One column holds two series and a null: `ACC-…` for members, `STF-…` for staff,
  nothing at all for an applicant. That is not a key, it is three things.

So: **the surrogate key is for machines and never shown; the account number is
for people and never joined on.** That is the standard split, and this schema
already had it right.

**Decision.** Keep both, and fix the *ergonomics* instead, which is what was
actually missing. `prisma/migrations/20260827120100_readable_views` adds five
read-only views — `v_people`, `v_transactions`, `v_loans`, `v_audit`,
`v_pending_applications` — each leading with the identifier a human has and
joining the names in. Nothing writes through them, no application code reads them,
and Prisma's `migrate diff` does not model views, so they cost no drift.

**Why a view rather than a change of key.** A view is the only answer here that
is free to be denormalised. It can put the borrower's name, the guarantor's name
and the approver's name on one row of `v_loans` precisely because it stores
nothing and can never disagree with the table it reads. Every other way of making
the database readable — a name column copied onto `transactions`, an account
number copied onto `loans` — is [ADR-023](adr-023-one-member-identifier-usersaccountno.md)
again, and this repository has paid for that shape at least four times.

**Consequences.** `apps/web/test/unit/database-views.test.ts` reads the view
bodies and fails when one names a column `schema.prisma` no longer has — because
a view is checked by neither the compiler nor `pnpm db:migrate:check`, and the
next place it would be noticed is a migration failing at deploy time. A rename
must update the view in the same migration, the way a foreign key must.

The views are a debugging tool, not an API. Nothing in `apps/api` or `apps/web`
may select from one: the moment application code depends on a view, the view
stops being free to change and becomes a second schema.

---

[← all decisions](../decisions.md)
