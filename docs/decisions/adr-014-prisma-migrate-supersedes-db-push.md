# ADR-014 — Prisma migrate supersedes `db push`

**Status:** accepted · 2026-08-16 · supersedes [ADR-004](adr-004-prisma-db-push-no-migration-files.md).

ADR-004 deferred migrations until "a second developer joins or production data cannot be rebuilt". The second condition arrived: the database holds real member savings and loan balances, and no amount of re-running `db push` reconstructs a taka.

Two concrete failures pushed this over the line:

- `db push` is a diff against the live database, so **the schema has no history**. When a `document_sequences` column turned out to have no usable default in production, there was no record of when it changed or what it replaced — the only way to answer was to inspect the running database.
- `db push` will silently drop a column to make the database match the schema. On `transactions` or `accounts` that is unrecoverable member data, and nothing in the workflow asks twice.

The current schema is baselined as `0_init`, generated with `prisma migrate diff --from-empty`, so it is byte-identical to what `db push` had produced. Nothing changed shape at the cutover.

**What did not change:** an `@updatedAt` column still gets **no database default** under migrations either — Prisma applies those in the client. SQL written by hand in the Go API must set both `"createdAt"` and `"updatedAt"` itself. Migrations make that visible in a reviewable file rather than discoverable in production; they do not fix it. See [data-model.md](../data-model.md).

**Consequences**

- Every environment runs `pnpm db:migrate`. Databases predating this ADR need `pnpm db:migrate:baseline` once.
- `pnpm db:push` survives for throwaway local databases. Pointed at production it reintroduces exactly the drift this ADR removes.
- Migrations need a **direct** (non-pooled) connection; `pnpm db:migrate` derives one from the pooled URL and logs that it did. See [deployment.md](../deployment.md#neon).
- CI applies migrations rather than pushing, so the integration suite tests the schema that actually deploys.

---

[← all decisions](../decisions.md)
