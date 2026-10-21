# API Reference

Two surfaces; who owns what is in [architecture.md](architecture.md).

## Go API — base `NEXT_PUBLIC_API_URL` (local `http://localhost:8081`)

Auth: `Authorization: Bearer <jwt>` on everything except `/v1/health`, `/v1/ready` and `/v1/auth/*`. Envelope `{ "success": true, "data": {…} }` / `{ "success": false, "error": { "code": "…", "message": "…" } }`. Status: 200 · 400 validation · 401 missing/invalid/revoked token · 403 wrong role · 404 · 409 conflict · 429 rate-limited · 500. Authorization is checked **before** body validation. The authoritative list is `apps/api/cmd/server/main.go`; `routes_integration_test.go` walks it with `chi.Walk` and fails on a route without a contract row.

### Health & auth

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/health` | liveness; `status` + `emailConfigured`, touches nothing |
| GET | `/v1/ready` | readiness; pings the DB (2 s), 503 `DB_UNAVAILABLE` |
| POST | `/v1/auth/login` | `{identifier, password}` — email **or** phone |
| POST | `/v1/auth/logout` | blacklists the presented token |
| POST | `/v1/auth/forgot-password` | **always 200, always the same body** |
| GET·POST | `/v1/auth/reset-password` | validate token · set new password |

**No auth endpoint discloses membership** ([ADR-032](decisions.md)). `forgot-password` gives everyone the same 200 (what happened goes to logs and `audit_logs`); its only other answers are `429` (per identifier and per address) and `503 EMAIL_NOT_CONFIGURED`, decided before any lookup — **never add a branch that depends on the lookup**. `login` answers `401 AUTH_INVALID_CREDENTIALS` identically (same bcrypt cost) for wrong password, unknown identifier and suspended account; `403 AUTH_USER_INACTIVE` only after the password verifies; `429 AUTH_RATE_LIMITED` from two buckets — identifier (flat 30 s per 5 failures) and identifier+address (30 s → 2 m → 10 m → 1 h). `reset-password` spends the link, writes the password, retires the first-login marker and revokes every session in one transaction ([ADR-031](decisions.md)); unknown, expired and reused links all answer `400 AUTH_INVALID_TOKEN`.

### Shared (any signed-in role)

`GET /v1/dashboard/user` · `GET|PATCH /v1/dashboard/notifications` · `PUT /v1/dashboard/password` · `POST /v1/dashboard/password/change/{request-code,verify-code,confirm}` · support: `GET|PUT /v1/dashboard/support/config`, `GET /v1/dashboard/support/threads`, `GET|POST /v1/dashboard/support/messages`, `POST /v1/dashboard/support/threads/processed`, `GET /v1/dashboard/support/stream` (SSE), `POST /v1/dashboard/support/stream/ticket`.

SSE: an `Authorization` header when possible; a browser `EventSource` first fetches a ticket (60 s, single-purpose, not an access token — fetch a fresh one per connect) and passes `?ticket=`. `?access_token=` is never accepted.

### Member

`GET /v1/dashboard/member` · `GET /v1/dashboard/member/{deposits,transactions,loans,profile}` · `POST /v1/dashboard/member/requests/deposit` · `POST /v1/dashboard/member/requests/loan-repayment`. There is **no** member withdrawal request ([ADR-030](decisions.md)); `loan.noticePeriodDays` is served in the public settings tier and enforced by nothing.

### Worker

| Method | Path |
|---|---|
| GET | `/v1/dashboard/worker` · `/worker/{members,requests,loans,transactions,profile}` · `/worker/members/{memberUserId}` |
| POST | `/v1/dashboard/worker/members/{memberUserId}/{deposit,withdrawal,loan,loan-payment}` |
| POST | `/v1/dashboard/worker/members/{memberUserId}/loan-topup` — `{ loanId, amount, notes }` |
| PUT | `/v1/dashboard/worker/profile` |

`withdrawal` needs no request; it settles an outstanding `PENDING` one (rewritten to the amount paid) or writes its own `CONFIRMED` row. `loan-topup` raises principal and remaining together and re-spreads over the remaining instalments (end date holds; no interest or fee). Refusals: `LOAN_NOT_FOUND`, `LOAN_NOT_ACTIVE` (409), `TOPUP_EXCEEDS_LIMIT` (409, message carries the ceiling and figures), `MEMBER_NOT_FOUND`, `MEMBER_NOT_ACTIVE`.

### Staff — `WORKER`, `ADMIN`, `SUPER_ADMIN` (under `/admin/` for historical reasons)

| Method | Path |
|---|---|
| GET | `/v1/dashboard/admin/approvals` — registrations omitted for a worker |
| POST | `/v1/dashboard/admin/approvals/withdrawal` · `/withdrawal/reject` — process a pending posting (FR-07); approving a withdrawal marks it `PROCESSED`, the debit happens when a worker pays |
| GET | `/v1/dashboard/admin/{members,loans,deposits}` |
| GET | `/v1/dashboard/admin/reports/monthly?year=&month=` · `reports/yearly?year=` · `reports/loans` |
| GET·POST | `/v1/dashboard/admin/donations` |

### Admin — `ADMIN`, `SUPER_ADMIN` (deciding, not processing)

| Method | Path |
|---|---|
| GET | `/v1/dashboard/admin` — carries `recentActivity` (audit) |
| GET | `/v1/dashboard/admin/{workers,profile}` · `/admin/loans/detail?id=` |
| POST | `/v1/dashboard/admin/members/status` · `/admin/workers/welcome-email` |
| POST | `/v1/dashboard/admin/approvals/registration` — optional `branchId` (unknown/closed = 400); answers `accountNo`, **never a password** ([ADR-042](decisions.md)) · `/registration/reject` — requires `reasonCode` (`lib/rejection-reasons.ts`) + optional `reasonNote`. Both answer `emailDelivered`/`deliveryError` (committed either way — the admin phones if mail failed) |
| POST | `/v1/dashboard/admin/approvals/loan` · `/loan/reject` |
| POST | `/v1/dashboard/admin/loans/default` — runs the settlement waterfall |
| PUT | `/v1/dashboard/admin/profile` |

## Next.js route handlers — same origin, `/api/v1/*`

Bare JSON, no envelope ([ADR-005](decisions.md)); auth via `lib/server-auth.ts` (shared `JWT_SECRET`, revocation checked). Every route has a caller — grep `/api/v1/...` across `app/`, `components/`, `lib/`, `hooks/`, `e2e/` before changing one. No balance writes here ([ADR-001](decisions.md)).

| Methods | Path | Purpose · notes | Called by |
|---|---|---|---|
| GET·POST | `/api/v1/registrations` | availability check · submit. Throttled: GET 20/10 min (SEC-08), POST 5/15 min per address | register page |
| POST | `/api/v1/auth/login` | legacy login proxy to Go | login page |
| GET·PUT | `/api/v1/settings` | `system_config`. GET needs no token and answers in tiers — public / member / worker (+content keys) / admin. PUT is gated **by key**: admins write any declared key, workers only `CONTENT_CONFIG_KEYS` (403 otherwise, all-or-nothing). Browser reads go through `lib/settings-client.ts` | login, settings screens, member loans, `lib/documents/org-settings.ts` |
| GET·POST·PUT·DELETE | `/api/v1/gallery` | gallery CMS | Content & Media |
| POST·PUT·PATCH·DELETE | `/api/v1/admin/workers` | worker accounts (no `role` field) | admin workers |
| POST | `/api/v1/member/transactions/{id}/dispute` | member disputes a `CONFIRMED` posting (`409 NOT_DISPUTABLE` for any other status, ADR-026; optional whole-taka `correctAmount`) | member transactions |
| GET·POST·PUT | `/api/v1/dashboard/support/[...path]` | proxy to Go support — **allow-list** (`config`, `threads`, `threads/processed`, `messages`, `stream`, `stream/ticket`, per method); mutations 60/min per member address ([ADR-021](decisions.md)) | `lib/api.ts` rewrite |
| POST | `/api/v1/loans/applications` | member loan application | `loan-application-form.tsx` |
| GET | `/api/v1/members/lookup` | **FR-11.** Full account number → name and guarantor eligibility, so an applicant can nominate one. Signed in, exact match only, 10 per 10 min — an id-to-name resolver is an oracle | `loan-application-form.tsx` |
| POST | `/api/v1/loans/{id}/guarantor-approval` | guarantor accepts/declines | `guarantor-requests.tsx` |
| GET·POST·PUT·DELETE | `/api/v1/admin/branches` | branches; DELETE deactivates when anyone is attached | admin branches, approval branch picker |
| GET | `/api/v1/admin/audit-logs` | **FR-24.** Filters `q` (details, action, and ids resolved from account/application/loan/receipt numbers and names), `category`, `severity`, `action`, `from`, `to`, `includeNoise`, `page`, `limit` (≤100, default 20). Numbered pages with a **bounded** count (ceiling 2,000 → `100+`). Resolves subjects and actors per entity type; hides noise unless asked | admin audit screen |
| GET·POST | `/api/v1/admin/retention` | **FR-25, [ADR-038](decisions.md).** POST (admins): `{ userId }` erases one refused application's photos; `{}` sweeps all and expires audit rows. GET: the nightly Vercel Cron, `CRON_SECRET` only — no signed-in role. Deletes by folder prefix | approvals screen; Vercel Cron |
| POST | `/api/v1/admin/members/{id}/refile-documents` | **[ADR-040](decisions.md).** Move an admitted member's documents into `people/<accountNo>`; idempotent, 409 if not approved | approvals screen; the nightly sweep |
| POST | `/api/v1/admin/members/{id}/reset-password` | **[ADR-036](decisions.md).** Staff-assisted reset for members (no email path); account number echoed back; revokes every session in the same transaction; password shown once | member detail screen |
| POST | `/api/v1/admin/members/{id}/erase` | **FR-23, [ADR-033](decisions.md).** Anonymise (any posting) or delete (none) — counted, not chosen; 409 with an unsettled loan or guarantee; 400 unless the `accountNo` is echoed; revoke-all in the same transaction; deletes the Cloudinary assets | member detail screen |

## Adding an endpoint

Changes a balance → Go (route in `main.go`, handler in `dashboard_handler.go`, SQL in the matching repository, one transaction with an `audit_logs` row). Otherwise a Next route handler. Document it here in the same commit.

## Smoke test

```bash
curl -s localhost:8081/v1/health
curl -s -X POST localhost:8081/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@hasnahena.local","password":"<admin-password>"}'
```
