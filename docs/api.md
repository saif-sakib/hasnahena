# API Reference

Two surfaces. Routing ownership and the reason for the split are in [architecture.md](architecture.md).

## Go API — base `NEXT_PUBLIC_API_URL` (local `http://localhost:8081`)

Auth: `Authorization: Bearer <jwt>` on everything except `/v1/health`, `/v1/ready` and `/v1/auth/*`.

Envelope:

```jsonc
{ "success": true,  "data": { … } }
{ "success": false, "error": { "message": "…" } }
```

Status codes: 200 ok · 400 validation · 401 missing/invalid/blacklisted token · 403 wrong role · 404 · 429 rate-limited · 500.

The authoritative list is `apps/api/cmd/server/main.go` — one file, read it when in doubt.

### Health & auth

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/health` | liveness. Returns `status` and `emailConfigured`, touches nothing else |
| GET | `/v1/ready` | readiness. Pings the database (2 s budget); 503 `DB_UNAVAILABLE` if unreachable |
| POST | `/v1/auth/login` | `{identifier, password}` — identifier is email **or** phone |
| POST | `/v1/auth/logout` | blacklists the presented token |
| POST | `/v1/auth/forgot-password` | emails a reset link |
| GET·POST | `/v1/auth/reset-password` | validate token · set new password |

### Shared (any signed-in role)

`GET /v1/dashboard/user` · `GET|PATCH /v1/dashboard/notifications` · `PUT /v1/dashboard/password`
Password change with email code: `POST /v1/dashboard/password/change/{request-code,verify-code,confirm}`
Support chat: `GET|PUT /v1/dashboard/support/config` · `GET /v1/dashboard/support/threads` · `GET|POST /v1/dashboard/support/messages` · `POST /v1/dashboard/support/threads/processed` · `GET /v1/dashboard/support/stream` (SSE) · `POST /v1/dashboard/support/stream/ticket`

The SSE stream takes an `Authorization` header when the caller can set one. A browser `EventSource` cannot, so it first calls the ticket endpoint (authenticated normally) and passes the returned value as `?ticket=`. Tickets last 60 s, are good only for this stream, and are not access tokens — fetch a fresh one before every connect, including reconnects. `?access_token=` is **not** accepted anywhere.

### Member

| Method | Path |
|---|---|
| GET | `/v1/dashboard/member` |
| GET | `/v1/dashboard/member/{deposits,transactions,loans,profile}` |
| POST | `/v1/dashboard/member/requests/deposit` |
| POST | `/v1/dashboard/member/requests/loan-repayment` |
| POST | `/v1/dashboard/member/requests/withdrawal` |

`POST /requests/withdrawal` is the member's **notice of withdrawal** (FR-08). It
moves no money: it files a `PENDING` withdrawal and answers with the date it
becomes payable.

```jsonc
// → { "amount": 5000, "notes": "school fees" }
// ← { "requestId": "…", "amount": 5000,
//     "noticePeriodMonths": 3, "eligibleFrom": "2026-11-18T…Z" }
```

Refusals name the reason: `INSUFFICIENT_BALANCE` (which counts outstanding
notices, not just the balance), `ACTIVE_LOAN`, `GUARANTOR_LOCK`.
`eligibleFrom` is the server's, not the client's — the notice period is policy
the API owns, and a date the screen worked out for itself would drift the moment
an admin changed it.

### Worker

| Method | Path |
|---|---|
| GET | `/v1/dashboard/worker` |
| GET | `/v1/dashboard/worker/{members,requests,loans,transactions,profile}` |
| GET | `/v1/dashboard/worker/members/{memberId}` |
| POST | `/v1/dashboard/worker/members/{memberId}/{deposit,withdrawal,loan,loan-payment}` |
| PUT | `/v1/dashboard/worker/profile` |

### Admin

| Method | Path |
|---|---|
| GET | `/v1/dashboard/admin` |
| GET | `/v1/dashboard/admin/{members,workers,deposits,loans,donations,approvals,profile}` |
| POST | `/v1/dashboard/admin/members/status` |
| POST | `/v1/dashboard/admin/workers/welcome-email` |
| POST | `/v1/dashboard/admin/approvals/registration` · `/registration/reject` |
| POST | `/v1/dashboard/admin/approvals/loan` · `/loan/reject` |
| POST | `/v1/dashboard/admin/approvals/withdrawal` · `/withdrawal/reject` |
| GET | `/v1/dashboard/admin/loans/detail?id=` |
| POST | `/v1/dashboard/admin/loans/default` — triggers the settlement waterfall |
| POST | `/v1/dashboard/admin/donations` |
| GET | `/v1/dashboard/admin/reports/monthly?year=&month=` · `reports/yearly?year=` · `reports/loans` |
| PUT | `/v1/dashboard/admin/profile` |

## Next.js route handlers — same origin, `/api/v1/*`

Legacy shape: bare JSON, no `success` envelope ([ADR-005](decisions.md)). Auth via `lib/server-auth.ts` using the shared `JWT_SECRET`.

Eleven handlers. Only `admin/audit-logs` has no caller, and it is OBS-08'''s
backend waiting on its viewer UI.
The "called by" column is the audited answer, not an intention — verified
2026-08-17 by grepping every `/api/v1/...` literal in `app/`, `components/`,
`lib/`, `hooks/` and `e2e/`. An uncalled route is not automatically dead (some
are a built feature's missing half), but it is never exercised, so treat it as
untested.

| Methods | Path | Purpose | Called by |
|---|---|---|---|
| GET·POST | `/api/v1/registrations` | public registration submit + admin listing | register page |
| POST | `/api/v1/auth/login` | legacy login path, kept for older clients | login page |
| GET·PUT | `/api/v1/settings` | `system_config` read / upsert | login, member loans, admin settings/members, `lib/documents/org-settings.ts`. **GET is unauthenticated** — SEC-12 |
| GET·POST·PUT·DELETE | `/api/v1/gallery` | gallery CMS | admin gallery + settings |
| POST·PUT·PATCH·DELETE | `/api/v1/admin/workers` | worker account CRUD | admin workers |
| POST | `/api/v1/member/transactions/{id}/dispute` | member disputes amount | member transactions |
| GET·POST·PUT | `/api/v1/dashboard/support/[...path]` | proxy to the Go support endpoints | `lib/api.ts` rewrite |
| POST | `/api/v1/loans/applications` | member loan application | **nothing** — FR-10's missing UI ([WO-45](work-orders.md)) |
| POST | `/api/v1/loans/{id}/guarantor-approval` | guarantor accepts/rejects | **nothing** — FR-11's missing UI ([WO-45](work-orders.md)) |
| GET | `/api/v1/admin/audit-logs` | audit viewer feed | **nothing** — OBS-08's missing UI |

**Removed 2026-08-17 ([WO-44](work-orders.md))** — five handlers, none with a
caller anywhere in the app:

| Route | Why |
|---|---|
| `POST /api/v1/worker/transactions/{id}/process` | Mutated balances from Next ([ADR-001](decisions.md) forbids it) **and 500'd on every call** — it wrote a display name into `processedBy`, a foreign key to `users.id` |
| `POST /api/v1/member/transactions/{id}/confirm` | Mutated balances from Next, carrying LEDGER-01's lost update |
| `POST /api/v1/transactions/deposit-requests` | Superseded by Go `/v1/dashboard/member/requests/deposit` |
| `POST /api/v1/transactions/withdrawal-requests` | No caller; a withdrawal-request path belongs in Go beside the deposit twin |
| `POST /api/v1/admin/approvals/registration` | The approvals page calls the Go route of the same name |

## Adding an endpoint

Changes a balance → Go: route in `main.go`, HTTP shape in `dashboard_handler.go`, SQL + rules in the matching `internal/repositories/*_repository.go`, wrapped in a transaction, with an `audit_logs` append. Otherwise a Next route handler is fine. Either way, document it here in the same commit.

## Smoke test

```bash
curl -s localhost:8081/v1/health
curl -s -X POST localhost:8081/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@hasnahena.local","password":"<admin-password>"}'
```
