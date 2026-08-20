# Architecture

## Shape

```
Browser ──┬─→ Next.js (Vercel)  apps/web
          │     ├─ [locale] pages, SSR + client components
          │     └─ /api/v1/*  route handlers → Prisma ─┐
          │                                            ├→ PostgreSQL (Neon)
          └─→ Go API (Render)  apps/api                │
                └─ /v1/*  chi handlers → pgx ──────────┘
                     └─→ Brevo (email), Cloudinary (files)
```

Two backends share one database. That is deliberate but bounded — see [ADR-001](decisions.md).

## Which backend owns what

| Concern | Owner | Why |
|---|---|---|
| Login, logout, password reset/change | **Go** | JWT is minted and blacklisted there |
| All dashboard reads (member/worker/admin) | **Go** | one repository, one SQL layer |
| Deposits, withdrawals, loans, repayments, donations, approvals, reports | **Go** | financial writes must be transactional + audited |
| Support chat (incl. SSE stream) | **Go**, proxied through Next at `/api/v1/dashboard/support/*` | avoids mixed-content/CORS on the stream |
| Public registration submit | **Next** | needs Cloudinary upload + Prisma in one request |
| Content & Media (gallery + public copy + brand images) — **staff, incl. workers** | **Next** | CMS-style publishing, no ledger impact. `PUT /api/v1/settings` gates by *key*: a worker writes `CONTENT_CONFIG_KEYS` and is refused the rest |
| System settings, audit-log viewer, worker CRUD, branches — **admin only** | **Next** | identity, money policy, staff accounts |
| Transaction dispute, loan application, guarantor approval | **Next** | status transitions only, no balance mutation |

Rule of thumb: **if it changes a balance, it belongs in Go.**

That rule was broken twice and both handlers were removed: a worker-process
route that mutated balances *and* wrote a display name into
`transactions.processedBy` — a foreign key to `users.id`, so every call 500'd —
and a member-confirm route carrying a lost update. Neither had a caller. If you
are adding a balance write to Next, the answer is Go.

## Request path from the browser

`apps/web/lib/api.ts` is the only client. `getApiBaseUrl()` returns `NEXT_PUBLIC_API_URL` (default `http://localhost:8081`). Paths starting `/v1/dashboard/support` are rewritten to the same-origin Next proxy; everything else goes cross-origin to the Go API with `Authorization: Bearer <jwt>`. The proxy forwards an allow-list of the six support routes `main.go` mounts and nothing else — a census test holds the two against each other ([ADR-021](decisions.md)).

Response envelope (Go): `{ success, data }` or `{ success: false, error: { message } }`. The client unwraps `data` and throws on `success !== true`. Next route handlers predate this and return bare JSON — see [ADR-005](decisions.md).

## Auth

- Login posts to Go `/v1/auth/login`; on success the JWT is stored in the `hn_access_token` cookie and read client-side by `lib/client-auth.ts`.
- `apps/web/proxy.ts` (named `middleware.ts` before Next 16) guards `/{en,bn}/dashboard/**`: missing or expired token → redirect to `/{locale}/login`, and a role asking for a section it does not own → redirect to the one it does (`MEMBER`→member, `WORKER`→worker, `ADMIN`/`SUPER_ADMIN`→admin or worker, since an admin may cover a round). That second redirect is UX, not authorisation — it stops a worker being handed an admin shell whose every fetch 403s, which became worth preventing once both dashboards started rendering from the same components. It only decodes `exp`; it does **not** verify the signature — that is the server's job. It also issues the per-request CSP nonce and attaches the policy — two policies, one per route tier, because a nonce and a prerendered page cannot coexist ([ADR-024](decisions.md)). Report-only until `CSP_ENFORCE=1`.
- Go verifies HS256 with `JWT_SECRET` and checks the `token_blacklist` table (logout, password change, admin revoke).
- Next route handlers verify the same secret via `lib/server-auth.ts` / `lib/auth.ts`. **Web and API must share one `JWT_SECRET`.**
- **Revocation is platform-wide.** Both surfaces consult `token_blacklist` on every authenticated request — Go directly, Next through `lib/auth-revocation.ts`, which **fails closed**: if the lookup errors, the request is refused. Both truncate `iat` to whole seconds, without which a first-login token is born revoked.
- `security_service.go` handles login lockout via the `rate_limits` table, keyed on `middleware.ClientIP` — the one function that decides a caller's address ([ADR-019](decisions.md)). Never read `X-Forwarded-For` in a handler.
- The **global** limiter (`middleware.RateLimit`, in memory) keys on the **member** when their token verifies and on the address otherwise. `middleware.Identity` does that verification — signature and expiry, no database — before the limiter runs, and `RequestUserID(r)` reads the answer back ([ADR-025](decisions.md)). It attributes a request; it never authorises one.

## Frontend structure

```
app/[locale]/(marketing)   home, about, activities, gallery, faq, contact, donate, privacy, terms
app/[locale]/(auth)        login, register, forgot-password, reset-password
app/[locale]/dashboard/    member/ worker/ admin/   — one folder per role. Every staff route file
                           is a one-line re-export of a screen; there is no page logic under app/
components/ui              shadcn-style primitives (button, card, dialog, table, toast, …)
components/layout          header, footer, dashboard-layout
components/dashboard       screens/  ONE component per staff screen, shared by worker and admin
                           nav.ts    what each dashboard contains — sidebar and action cards
                           role.tsx  useDashboardRole(); presentation only, the API decides
                           money-actions.tsx  the ONE deposit/withdrawal/instalment/loan form
                           profile-editor, loan-application-form, guarantor-requests
lib/                       api client, auth, prisma, validation, receipt PDF, cloudinary, seo
messages/{en,bn}.json      all copy — next-intl, locale prefix always present
```

### Documents

`lib/documents/` generates the member-facing paperwork — account statement, deposit/withdrawal receipt, loan agreement, membership certificate. Documents are **English only** ([ADR-012](decisions.md)).

A builder turns caller data into a renderer-independent `DocumentModel` (a list of blocks: fields, tiles, table, terms, signatures…), and two renderers consume it, so print and download can never drift apart:

```
types → format → theme → builders/*  →  render/html.ts   (preview + print, real text)
                                     →  render/pdf.ts    (download, vector text, paginated)
                         export.ts   →  printDocument / downloadDocumentPDF / downloadDocumentHTML
```

Import from `@/lib/documents`. Add a document as one builder plus one export line; add a *kind of* content as a new `Block` variant handled in both renderers. Amounts print as `BDT 1,25,000` — the `৳` sign cannot be encoded by the PDF's standard fonts.

### UI tokens

Tailwind + CSS variables in `app/globals.css`, light and `.dark`. Brand primary is emerald `hsl(160 84% 39%)` (dark: `45%`), radius `0.625rem`. Use semantic classes (`bg-primary`, `text-muted-foreground`, `border-border`) — never hardcoded hex. Status colours are centralised in `lib/status-styles.ts`; extend that file rather than inlining badge colours.

## Go API structure

```
cmd/server/main.go        config, pool, DI, mountRoutes + mountMiddleware — the routing table
internal/config           env loading (walks up for .env), fails fast if JWT_SECRET < 32 chars
internal/middleware       the global stack, mounted by mountMiddleware: CORS (allow-list from
                          CORS_ORIGINS), caller identity, rate limiting, NUL-byte rejection, request logging, and
                          ClientIP — the ONLY place that decides a caller's address
internal/handlers         auth_handler.go, dashboard_handler.go (HTTP shape only)
internal/services         auth (JWT, bcrypt), security (rate limit, blacklist), email (Brevo)
internal/repositories     all SQL and business calculation, split by domain:
                          repository.go (shared helpers), transaction_ (deposits/withdrawals/
                          donations), loan_, member_, worker_, admin_, auth_, support_, report_
internal/money            pure loan/installment/waterfall arithmetic — no DB. New money maths goes HERE
internal/notify           every member- and staff-facing notification string. Nothing else builds one
internal/utils            response envelope, validation, id + document-number generators
```

`pgx` runs in `QueryExecModeSimpleProtocol` because Neon's pgBouncer pooler conflicts with server-side prepared statements. Keep it.

The Go side touches **no** DDL. It used to create the support-chat tables at boot with `CREATE TABLE IF NOT EXISTS`, alongside the migration that also creates them — two definitions that disagreed ([WO-70](work-orders.md)). Migrations are the only definition now, and `schema_ownership_test.go` fails if a repository issues DDL again.

## Environments

| | Local | Production |
|---|---|---|
| Web | `:3000` | Vercel → hasnahenafoundation.com |
| API | `:8081` | Render → api.hasnahenafoundation.com |
| DB | Docker postgres `:5432` | Neon (pooled URL at runtime, direct URL for migrations and `pg_dump`) |

## Balance writes — the one rule the SQL must follow

Every statement that changes `accounts."savingsBalance"` or `"loanBalance"` must
either write **relatively**:

```sql
SET "savingsBalance" = "savingsBalance" + $1   -- Postgres does the arithmetic
```

or read the row **inside the same transaction with `FOR UPDATE`** before
computing a new total in Go. Reading from the pool and writing back an absolute
figure is a lost update — it has been written twice here and destroyed money both
times ([ADR-015](decisions.md)), and a source census now fails the build when a
new balance writer appears without a concurrency test.

The reason to care is specific to this domain: `Transaction` rows carry
`savingsAfter` / `loanAfter` snapshots so a passbook can be reprinted. When the
balance races, the snapshots and the balance disagree, and the printed passbook
becomes evidence against the account.

## Known structural debt

Tracked in [tasks.md](tasks.md): legacy `PENDING`/`APPROVED` loan statuses kept
beside the spec-aligned ones (and `PENDING` is still the schema default), and
`GET /api/v1/admin/audit-logs`, which has no caller because its viewer UI does
not exist (OBS-08). Everything else that was listed here has been built or
removed.
