# API Reference

Two surfaces. Routing ownership and the reason for the split are in [architecture.md](architecture.md).

## Go API — base `NEXT_PUBLIC_API_URL` (local `http://localhost:8081`)

Auth: `Authorization: Bearer <jwt>` on everything except `/v1/health` and `/v1/auth/*`.

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
| GET | `/v1/health` | returns `status` and `emailConfigured` |
| POST | `/v1/auth/login` | `{identifier, password}` — identifier is email **or** phone |
| POST | `/v1/auth/logout` | blacklists the presented token |
| POST | `/v1/auth/forgot-password` | emails a reset link |
| GET·POST | `/v1/auth/reset-password` | validate token · set new password |

### Shared (any signed-in role)

`GET /v1/dashboard/user` · `GET|PATCH /v1/dashboard/notifications` · `PUT /v1/dashboard/password`
Password change with email code: `POST /v1/dashboard/password/change/{request-code,verify-code,confirm}`
Support chat: `GET|PUT /v1/dashboard/support/config` · `GET /v1/dashboard/support/threads` · `GET|POST /v1/dashboard/support/messages` · `POST /v1/dashboard/support/threads/processed` · `GET /v1/dashboard/support/stream` (SSE)

### Member

| Method | Path |
|---|---|
| GET | `/v1/dashboard/member` |
| GET | `/v1/dashboard/member/{deposits,transactions,loans,profile}` |
| POST | `/v1/dashboard/member/requests/deposit` |
| POST | `/v1/dashboard/member/requests/loan-repayment` |

### Worker

| Method | Path |
|---|---|
| GET | `/v1/dashboard/worker` |
| GET | `/v1/dashboard/worker/{members,requests,loans,transactions,profile}` |
| GET | `/v1/dashboard/worker/members/{memberId}` |
| POST | `/v1/dashboard/worker/members/{memberId}/{deposit,withdrawal,loan,loan-payment}` |
| POST | `/v1/dashboard/worker/{deposit,withdrawal}` |
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

| Methods | Path | Purpose |
|---|---|---|
| GET·POST | `/api/v1/registrations` | public registration submit + admin listing |
| POST | `/api/v1/auth/login` | legacy login path, kept for older clients |
| POST | `/api/v1/admin/approvals/registration` | approve a pending registration |
| GET | `/api/v1/admin/audit-logs` | audit viewer feed |
| POST·PUT·PATCH·DELETE | `/api/v1/admin/workers` | worker account CRUD |
| GET·PUT | `/api/v1/settings` | `system_config` read / upsert (admin) |
| GET·POST·PUT·DELETE | `/api/v1/gallery` | gallery CMS |
| POST | `/api/v1/loans/applications` | member loan application |
| POST | `/api/v1/loans/{id}/guarantor-approval` | guarantor accepts/rejects |
| POST | `/api/v1/transactions/deposit-requests` | member deposit request |
| POST | `/api/v1/transactions/withdrawal-requests` | member withdrawal request |
| POST | `/api/v1/worker/transactions/{id}/process` | worker marks processed |
| POST | `/api/v1/member/transactions/{id}/confirm` | member confirms |
| POST | `/api/v1/member/transactions/{id}/dispute` | member disputes amount |
| GET·POST·PUT | `/api/v1/dashboard/support/[...path]` | proxy to the Go support endpoints |

## Adding an endpoint

Changes a balance → Go: route in `main.go`, HTTP shape in `dashboard_handler.go`, SQL + rules in `user_repository.go`, wrapped in a transaction, with an `audit_logs` append. Otherwise a Next route handler is fine. Either way, document it here in the same commit.

## Smoke test

```bash
curl -s localhost:8081/v1/health
curl -s -X POST localhost:8081/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@hasnahena.local","password":"<admin-password>"}'
```
