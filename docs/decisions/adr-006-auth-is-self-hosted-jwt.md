# ADR-006 — Auth is self-hosted JWT

**Status:** accepted · supersedes Clerk / Auth.js / Keycloak.

Clerk was specified but never wired, and its pricing plus a Bengali-first, phone-based membership flow made it a poor fit. Auth is HS256 JWT minted by the Go API, bcrypt password hashes, revocation through the `token_blacklist` table, and lockout through `rate_limits`.

Consequence: web and API **must** share one `JWT_SECRET`. The Next middleware only checks token expiry for redirects; signature verification always happens server-side.

---

[← all decisions](../decisions.md)
