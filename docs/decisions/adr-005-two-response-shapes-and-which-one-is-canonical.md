# ADR-005 — Two response shapes, and which one is canonical

**Status:** accepted, with a known inconsistency.

The Go API returns `{success, data}` / `{success, error}` and `lib/api.ts` depends on that envelope. Older Next route handlers return bare JSON or `{ok, error}`. Normalising them all is not worth a breaking sweep right now.

Canonical for anything new: the Go envelope. Do not add new Next handlers with a third shape.

---

[← all decisions](../decisions.md)
