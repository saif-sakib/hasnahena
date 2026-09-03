# ADR-004 — `prisma db push`, no migration files

**Status:** superseded by [ADR-014](adr-014-prisma-migrate-supersedes-db-push.md) · 2026-08-16.

With one developer and a Neon branch per environment, `db push` was faster and
avoided drift-repair ceremony, at the cost of no schema history and no safe
rollback. To be revisited "when a second developer joins or production data
cannot be rebuilt" — the second condition arrived first.

---

[← all decisions](../decisions.md)
