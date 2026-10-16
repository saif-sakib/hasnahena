# Reading a schema built for machines

- **Make the database readable with a view, not by denormalising a table.**
  Copying a member's name onto `transactions` is [ADR-023](../decisions.md)
  again; a view stores nothing, so it is the one construct free to join for
  humans ([ADR-037](../decisions.md), the `v_*` views).
- **`prisma migrate diff` does not model views.** `pnpm db:migrate:check` reports
  "No difference detected" whether a view is healthy or names three dropped
  columns; the first to notice would be a migration failing at deploy.
  `test/unit/database-views.test.ts` moves that to `pnpm test:unit`.

---

[← all traps](../traps.md)
