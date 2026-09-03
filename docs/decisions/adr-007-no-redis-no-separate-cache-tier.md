# ADR-007 — No Redis, no separate cache tier

**Status:** accepted.

Redis/Valkey appeared in the stack table for caching and background jobs; neither is in use. PostgreSQL carries rate limiting, the token blacklist, and support-chat retention. Support chat streams over SSE straight from the Go API rather than through a broker.

Revisit only when a real background-job need appears (installment reminders, timeout sweeps).

---

[← all decisions](../decisions.md)
