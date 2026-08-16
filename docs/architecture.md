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
| Gallery, system settings, audit-log viewer, worker CRUD | **Next** | CMS-style admin, no ledger impact |
| Transaction dispute, loan application, guarantor approval | **Next** | status transitions only, no balance mutation |

Rule of thumb: **if it changes a balance, it belongs in Go.**

That rule was broken twice and both handlers were removed on 2026-08-17: a
worker-process route that mutated balances *and* wrote a display name into
`transactions.processedBy` — a foreign key to `users.id`, so every call 500'd —
and a member-confirm route that carried the same lost-update bug as
[LEDGER-01](production-readiness.md). Neither had a caller. If you are adding a
balance write to Next, the answer is Go; see [WO-44](work-orders.md).

## Request path from the browser

`apps/web/lib/api.ts` is the only client. `getApiBaseUrl()` returns `NEXT_PUBLIC_API_URL` (default `http://localhost:8081`). Paths starting `/v1/dashboard/support` are rewritten to the same-origin Next proxy; everything else goes cross-origin to the Go API with `Authorization: Bearer <jwt>`.

Response envelope (Go): `{ success, data }` or `{ success: false, error: { message } }`. The client unwraps `data` and throws on `success !== true`. Next route handlers predate this and return bare JSON — see [ADR-005](decisions.md).

## Auth

- Login posts to Go `/v1/auth/login`; on success the JWT is stored in the `hn_access_token` cookie and read client-side by `lib/client-auth.ts`.
- `apps/web/proxy.ts` (named `middleware.ts` before Next 16) guards `/{en,bn}/dashboard/**`: missing or expired token → redirect to `/{locale}/login`. It only decodes `exp`; it does **not** verify the signature — that is the server's job.
- Go verifies HS256 with `JWT_SECRET` and checks the `token_blacklist` table (logout, password change, admin revoke).
- Next route handlers verify the same secret via `lib/server-auth.ts` / `lib/auth.ts`. **Web and API must share one `JWT_SECRET`.**
- **Revocation is Go-only.** The Next handlers check signature and `exp` and never consult `token_blacklist`, so a logged-out token still works against the settings, gallery, worker-CRUD and registration routes — [SEC-11](production-readiness.md). Do not describe revocation as platform-wide until that is fixed.
- `security_service.go` handles rate limiting and lockout via the `rate_limits` table.

## Frontend structure

```
app/[locale]/(marketing)   home, about, activities, gallery, faq, contact, donate, privacy, terms
app/[locale]/(auth)        login, register, forgot-password, reset-password
app/[locale]/dashboard/    member/ worker/ admin/   — one folder per role, mirrored subpages
components/ui              shadcn-style primitives (button, card, dialog, table, toast, …)
components/layout          header, footer, dashboard-layout
components/dashboard       profile-editor
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
cmd/server/main.go        config, pool, DI, and every route — the routing table
internal/config           env loading (walks up for .env), fails fast if JWT_SECRET < 32 chars
internal/middleware       CORS (allow-list from CORS_ORIGINS), request logging
internal/handlers         auth_handler.go, dashboard_handler.go (HTTP shape only)
internal/services         auth (JWT, bcrypt), security (rate limit, blacklist), email (Brevo)
internal/repositories     all SQL and business calculation, split by domain (WO-38):
                          repository.go (shared helpers), transaction_ (deposits/withdrawals/
                          donations), loan_, member_, worker_, admin_, auth_, support_, report_
internal/utils            response envelope, validation, member-ID + receipt generators
```

`pgx` runs in `QueryExecModeSimpleProtocol` because Neon's pgBouncer pooler conflicts with server-side prepared statements. Keep it.

`EnsureSupportSchema` creates support-chat tables at boot — the one place the Go side touches DDL.

## Environments

| | Local | Production |
|---|---|---|
| Web | `:3000` | Vercel → hasnahenafoundation.com |
| API | `:8081` | Render → api.hasnahenafoundation.com |
| DB | Docker postgres `:5432` | Neon (pooled URL at runtime, direct URL for `db push`) |

## Balance writes — the one rule the SQL must follow

Every statement that changes `accounts."savingsBalance"` or `"loanBalance"` must
either write **relatively**:

```sql
SET "savingsBalance" = "savingsBalance" + $1   -- Postgres does the arithmetic
```

or read the row **inside the same transaction with `FOR UPDATE`** before
computing a new total in Go. Reading from the pool and writing back an absolute
figure is a lost update, and it is a live defect today
([LEDGER-01](production-readiness.md)) — `loan_repository.go` is the file to copy
from, not `transaction_repository.go`.

The reason to care is specific to this domain: `Transaction` rows carry
`savingsAfter` / `loanAfter` snapshots so a passbook can be reprinted. When the
balance races, the snapshots and the balance disagree, and the printed passbook
becomes evidence against the account.

## Known structural debt

Tracked in [tasks.md](tasks.md): legacy `PENDING`/`APPROVED` loan statuses kept
beside the spec-aligned ones (and `PENDING` is still the schema default), four
Next route handlers with no caller ([WO-44](work-orders.md)), and FR-10/FR-11
endpoints that no UI reaches ([WO-45](work-orders.md)).

Fixed since this section was written: the empty stub folders under `app/api` are
gone, and the UUID-regex-vs-cuid check in the guarantor-approval route was
corrected by WO-29.
