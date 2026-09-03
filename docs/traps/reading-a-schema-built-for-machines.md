# Reading a schema built for machines

Every table here is keyed on a `cuid()` and every join is between two of them, so
reading the database by hand means copying opaque strings between queries. The
reasonable-looking fix — make the account number the primary key, or copy the
member's name onto `transactions` — is wrong in both directions:
`users.accountNo` is **null until an application is approved** and a key cannot
be null, and a copied name is [ADR-023](../decisions.md) again.

The answer is a **view**, which is the one construct free to be denormalised
because it stores nothing. See [ADR-037](../decisions.md) and the `v_*` views. The
trap specific to them: Prisma's `migrate diff` does not model views, so
`pnpm db:migrate:check` reports "No difference detected" whether they are healthy
or reference three columns that no longer exist. The first thing that notices is
a migration failing at deploy time. `apps/web/test/unit/database-views.test.ts`
is what moves that to `pnpm test:unit`.

---

[← all traps](../traps.md)
