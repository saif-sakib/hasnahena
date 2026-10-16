# Architecture

```
Browser ──┬─→ Next.js (Vercel)  apps/web
          │     ├─ [locale] pages, SSR + client components
          │     └─ /api/v1/*  route handlers → Prisma ─┐
          │                                            ├→ PostgreSQL (Neon)
          └─→ Go API (Render)  apps/api                │
                └─ /v1/*  chi handlers → pgx ──────────┘
                     └─→ Brevo (email); Cloudinary is reached from Next only
```

Two backends share one database, deliberately and boundedly ([ADR-001](decisions.md)).

## Which backend owns what

| Concern | Owner | Why |
|---|---|---|
| Login, logout, password reset/change | **Go** | JWTs are minted and revoked there |
| All dashboard reads | **Go** | one SQL layer |
| Deposits, withdrawals, loans, repayments, donations, approvals, reports | **Go** | transactional and audited |
| Support chat (incl. SSE) | **Go**, proxied by Next at `/api/v1/dashboard/support/*` | same-origin stream |
| Public registration | **Next** | Cloudinary upload + Prisma in one request |
| Content & Media (gallery, public copy, brand images) — staff incl. workers | **Next** | no ledger impact; `PUT /api/v1/settings` gates by key |
| Settings, audit viewer, worker CRUD, branches, erasure, staff-assisted reset, retention — admin | **Next** | policy, staff, Cloudinary deletes |
| Dispute, loan application, guarantor approval | **Next** | status transitions only |

**If it changes a balance, it belongs in Go** (two Next handlers that broke this were removed).

## Request path

`apps/web/lib/api.ts` is the only browser client: `NEXT_PUBLIC_API_URL` (default `http://localhost:8081`) with `Authorization: Bearer <jwt>`, except `/v1/dashboard/support*`, rewritten to the same-origin Next proxy, which forwards an allow-list matching `main.go` (census-tested, [ADR-021](decisions.md)). Go answers `{ success, data }` / `{ success: false, error }`; the client unwraps `data`. Next handlers return bare JSON ([ADR-005](decisions.md)).

## Auth

- Login posts to Go; the JWT goes in the `hn_access_token` cookie and localStorage (`lib/client-auth.ts`).
- `apps/web/proxy.ts` gates `/dashboard/**` and `/bn/dashboard/**` (English unprefixed, [ADR-034](decisions.md)): missing/expired token → that locale's `/login`; a role asking for another's section → its own (admin may open worker). UX, not authorisation — it decodes `exp` only. It also mints the per-request CSP nonce and attaches one of two policies by route tier ([ADR-024](decisions.md)), report-only until `CSP_ENFORCE=1`.
- Go verifies HS256 with `JWT_SECRET`; Next verifies the same secret (`lib/server-auth.ts`, `lib/auth.ts`) — **one shared `JWT_SECRET`**.
- **Revocation is platform-wide**: both check `token_blacklist` on every request (Next via `lib/auth-revocation.ts`, failing closed), comparing `iat` in whole seconds (or first login is born revoked).
- **Every ending revokes every session**, inside the transaction that causes it: password change and forgot-password reset (the marker is written by `UserRepository` for that reason, [ADR-031](decisions.md)), worker deactivation/archive/delete and member erasure (WO-91 — `status` is read only at login). The Next writer matches `revokeAllUserTokensSQL` row for row (`revocation-contract.test.ts`); the marker TTL derives from `JWT_EXPIRY_SECONDS`.
- Login lockout lives in `rate_limits` (`security_service.go`), keyed on `middleware.ClientIP` — the only source of a caller's address ([ADR-019](decisions.md)); two buckets, escalating only on identifier+address ([ADR-032](decisions.md)). Every throttled action is a declared constant with a policy.
- The global in-memory limiter keys on the **member** when `middleware.Identity` verified their token (signature + expiry, no DB), else the address; `RequestUserID(r)` attributes, never authorises ([ADR-025](decisions.md)).
- **Background loops on `runCtx`** (`wiring_test.go` enforces it): token/rate-limit cleanup, ledger reconciliation (daily, reports only, [ADR-027](decisions.md)), and the rejected-application retention sweep (daily, [ADR-033](decisions.md)). None writes a balance.

## Frontend structure

```
app/[locale]/(marketing)   home, about, activities, gallery, faq, contact, donate, privacy, terms
app/[locale]/(auth)        login, register, forgot-password, reset-password
app/[locale]/dashboard/    member/ worker/ admin/ — staff route files are one-line re-exports
components/ui              shadcn-style primitives
components/layout          header, footer, dashboard-layout, legal-document
components/dashboard       screens/ (one component per staff screen, both dashboards) · nav.ts ·
                           role.tsx (useDashboardRole, presentation only) · money-actions.tsx (THE money form)
lib/                       api client, auth, prisma, validation, documents, cloudinary, seo, csp
messages/{en,bn}.json      all copy (next-intl). `/faq` English, `/bn/faq` Bengali; `/en/*` 301s;
                           every internal URL via lib/locale-path.ts
```

**Documents** (`lib/documents/`, English only, [ADR-012](decisions.md)): statement, receipt, loan agreement, certificate. A builder produces a renderer-independent `DocumentModel`; `render/html.ts` (preview/print) and `render/pdf.ts` (vector download) both consume it. Import from `@/lib/documents`; amounts print `BDT 1,25,000`.

**UI tokens**: CSS variables in `app/globals.css` (light and `.dark`), primary emerald `hsl(160 84% 39%)` / `45%` dark, radius `0.625rem`; semantic classes only; status colours in `lib/status-styles.ts`.

## Go API structure

```
cmd/server/main.go        config, pool, DI, mountMiddleware + mountRoutes — the routing table
internal/config           env loading (walks up for .env); refuses JWT_SECRET < 32 chars
internal/middleware       CORS, ClientIP, Identity, rate limiting, NUL-byte rejection, logging, metrics
internal/handlers         auth_handler.go, dashboard_handler.go (HTTP shape only)
internal/models           auth request/response and User types
internal/services         auth (JWT, bcrypt), security (lockout, blacklist), email (Brevo)
internal/repositories     all SQL and business rules, split by domain (see CLAUDE.md Map)
internal/money            pure loan/instalment/waterfall/schedule arithmetic — new money maths here
internal/notify           every notification string
internal/metrics          Prometheus exposition (/metrics), business gauges
internal/observability    Sentry (slog bridge, recoverer)
internal/utils            response envelope, validation, id and document-number generators
```

`pgx` runs in `QueryExecModeSimpleProtocol` (Neon's PgBouncer conflicts with server-side prepared statements) — keep it. The Go side issues **no DDL**; migrations are the only schema definition (`schema_ownership_test.go`). Sessions pin `timezone=UTC`.

## Balance writes

Every statement changing `accounts."savingsBalance"`/`"loanBalance"` writes **relatively** (`SET "savingsBalance" = "savingsBalance" + $1`) or reads the row `FOR UPDATE` in the same transaction ([ADR-015](decisions.md)); a census fails the build when a new writer lacks a concurrency test. A race makes the `savingsAfter`/`loanAfter` snapshots — the reprintable passbook — disagree with the balance.

## Environments

| | Local | Production |
|---|---|---|
| Web | `:3000` | Vercel → hasnahenafoundation.com |
| API | `:8081` | Render → api.hasnahenafoundation.com |
| DB | Docker postgres `:5432` | Neon (pooled at runtime, direct for migrations and `pg_dump`) |
