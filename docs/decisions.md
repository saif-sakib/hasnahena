# Decisions

Why the code looks the way it does. Each entry resolves a conflict that used to exist between documents, or between documents and reality. Append new entries; do not rewrite old ones.

---

### ADR-001 — Go API owns money; Next.js owns content

**Status:** accepted · supersedes the "Go gateway + Java Spring Boot ledger" design.

A separate Java ledger service was specified and never built, and it is not justified for this scale. Instead: the Go API is the single writer for anything that moves a balance, and Next.js route handlers keep the CMS-style surfaces (registration intake, gallery, settings, worker CRUD, audit viewer) plus pure status transitions.

The split is real duplication and the cost is accepted for now. The rule that keeps it safe: **if it changes a balance, it belongs in Go.** New financial endpoints must not be added to Next.

---

### ADR-002 — Money is stored as whole taka in `BigInt`

**Status:** accepted · migrated in commits `8a402f0` and `93191ff`.

Balances were originally minor units (paisa) with ×100 conversions scattered across the frontend, backend, and PDF generation. Bangladeshi cooperative practice does not transact in paisa, and the conversions were a recurring source of 100× display bugs.

All amounts are now whole taka in `BigInt` columns. Never reintroduce a ×100 or ÷100, never use `float` for money, never store paisa.

---

### ADR-003 — Email only, no SMS

**Status:** accepted · supersedes the "SMS primary via SSL Wireless" requirement.

SMS gateways in Bangladesh need a paid contract and sender registration. Brevo transactional email is free at this volume and already integrated in the Go API (`internal/services/email_service.go`). Notifications for approval, rejection, credentials, and password reset go by email; in-app `Notification` rows cover the rest.

SMS remains a Phase 2 option. Until then no code should reference an SMS provider, and `FEATURE_SMS_NOTIFICATIONS` style flags should not exist.

---

### ADR-004 — `prisma db push`, no migration files

**Status:** accepted · revisit before multi-developer work.

`apps/web/prisma/migrations/` is deliberately empty. With one developer and a Neon branch per environment, `db push` is faster and avoids drift-repair ceremony. The trade-off is no schema history and no safe rollback.

Adopt `prisma migrate` when a second developer joins or when production data cannot be rebuilt.

---

### ADR-005 — Two response shapes, and which one is canonical

**Status:** accepted, with a known inconsistency.

The Go API returns `{success, data}` / `{success, error}` and `lib/api.ts` depends on that envelope. Older Next route handlers return bare JSON or `{ok, error}`. Normalising them all is not worth a breaking sweep right now.

Canonical for anything new: the Go envelope. Do not add new Next handlers with a third shape.

---

### ADR-006 — Auth is self-hosted JWT

**Status:** accepted · supersedes Clerk / Auth.js / Keycloak.

Clerk was specified but never wired, and its pricing plus a Bengali-first, phone-based membership flow made it a poor fit. Auth is HS256 JWT minted by the Go API, bcrypt password hashes, revocation through the `token_blacklist` table, and lockout through `rate_limits`.

Consequence: web and API **must** share one `JWT_SECRET`. The Next middleware only checks token expiry for redirects; signature verification always happens server-side.

---

### ADR-007 — No Redis, no separate cache tier

**Status:** accepted.

Redis/Valkey appeared in the stack table for caching and background jobs; neither is in use. PostgreSQL carries rate limiting, the token blacklist, and support-chat retention. Support chat streams over SSE straight from the Go API rather than through a broker.

Revisit only when a real background-job need appears (installment reminders, timeout sweeps).

---

### ADR-008 — Member IDs are `ACC-KH-#####`

**Status:** accepted · commit `5db86b7`, backfill in `scripts/migrate-member-ids.sql`.

Account and member identifiers are human-readable and branch-prefixed (`ACC-KH-33001`) because they are read aloud and written into paper passbooks. Generation lives in `apps/api/internal/utils/member_id.go`. Primary keys remain `cuid()` — the member ID is a display identifier, never a foreign key.

---

### ADR-009 — Formal specification PDFs retired

**Status:** accepted · 2026-08-14.

Nine LaTeX/PDF specification documents (BRD, SRS, FRD, API contract, DB schema, architecture, use cases, test plan, roadmap) described a system that was never built and contradicted the code on stack, currency, auth, and notifications. Their durable content — business rules, roles, FR-01…FR-22, use cases, test priorities, quality bars — is compressed into [product.md](product.md), [architecture.md](architecture.md), [data-model.md](data-model.md), and [tasks.md](tasks.md).

The originals remain in git history at commit `a8f7517` if a formal deliverable is ever needed again.
