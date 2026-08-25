# API Reference

Two surfaces. Routing ownership and the reason for the split are in [architecture.md](architecture.md).

## Go API — base `NEXT_PUBLIC_API_URL` (local `http://localhost:8081`)

Auth: `Authorization: Bearer <jwt>` on everything except `/v1/health`, `/v1/ready` and `/v1/auth/*`.

Envelope:

```jsonc
{ "success": true,  "data": { … } }
{ "success": false, "error": { "message": "…" } }
```

Status codes: 200 ok · 400 validation · 401 missing/invalid/blacklisted token ·
403 wrong role · 404 · 409 conflict · 429 rate-limited · 500.

Authorization is checked **before** body validation everywhere, so a caller with
the wrong role gets a 403 rather than a 400 listing the fields it wanted.

The authoritative list is `apps/api/cmd/server/main.go` — one file, read it when
in doubt. It is also enumerated: `routes_integration_test.go` walks the router
with `chi.Walk` and fails the build on any route with no contract row, or any row
with no route.

### Health & auth

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/health` | liveness. Returns `status` and `emailConfigured`, touches nothing else |
| GET | `/v1/ready` | readiness. Pings the database (2 s budget); 503 `DB_UNAVAILABLE` if unreachable |
| POST | `/v1/auth/login` | `{identifier, password}` — identifier is email **or** phone |
| POST | `/v1/auth/logout` | blacklists the presented token |
| POST | `/v1/auth/forgot-password` | **always 200, always the same body** |
| GET·POST | `/v1/auth/reset-password` | validate token · set new password |

`forgot-password` does not tell an unauthenticated caller who is a member
([ADR-032](decisions.md)). A member, a suspended member, a member with no email
address and a phone number nobody here has all get the same `200` and the same
message; what actually happened is in the logs and in `audit_logs`. The only
other answers are `429` (throttled per identifier and per address) and `503
EMAIL_NOT_CONFIGURED`, which is decided before any lookup and is therefore true
of every caller alike. **Do not add a branch here that depends on what the lookup
found.**

`POST /v1/auth/reset-password` spends the link, writes the password, retires the
first-login marker and **revokes every session the account has open**, in one
transaction ([ADR-031](decisions.md)). A link is single-use: a second submission
answers `400 AUTH_INVALID_TOKEN`, which is also the answer for unknown and
expired, because which of the three it was is a fact about the account.

`login` answers `401 AUTH_INVALID_CREDENTIALS` identically for a wrong password,
an unknown identifier and a suspended member's wrong password — and pays the same
bcrypt cost for all three. `403 AUTH_USER_INACTIVE` is reached only *after* the
password verifies. `429 AUTH_RATE_LIMITED` comes from two buckets: the identifier
alone (flat 30 s per 5 failures) and the identifier+address pair (30 s → 2 m →
10 m → 1 h).

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

`POST /requests/withdrawal` **no longer exists** ([ADR-030](decisions.md)). It
was the member's notice of withdrawal: it filed a `PENDING` withdrawal, answered
with the date it became payable, and neither payout path could move money before
then. A member asks a field worker now, and staff post the withdrawal from
`POST /worker/members/{memberUserId}/withdrawal`.

`loan.noticePeriodDays` is how much warning the foundation asks for. It is served
in the public settings tier and rendered by the member's savings screen and the
FAQ; no endpoint enforces it.

### Worker

| Method | Path |
|---|---|
| GET | `/v1/dashboard/worker` |
| GET | `/v1/dashboard/worker/{members,requests,loans,transactions,profile}` |
| GET | `/v1/dashboard/worker/members/{memberUserId}` |
| POST | `/v1/dashboard/worker/members/{memberUserId}/{deposit,withdrawal,loan,loan-payment}` |
| POST | `/v1/dashboard/worker/members/{memberUserId}/loan-topup` — adds principal to a **running** loan |
| PUT | `/v1/dashboard/worker/profile` |

`loan-topup` takes `{ loanId, amount, notes }`. It raises the loan's principal
and remaining amount together and re-spreads the balance over the instalments
that are **left**, so the end date holds and each remaining payment goes up
([ADR-030](decisions.md)). Zero interest, zero fees — the amount added and the
amount owed are the same money.

Its refusals are sentinels, so each has its own code: `LOAN_NOT_FOUND`,
`LOAN_NOT_ACTIVE` (409 — a completed or defaulted loan needs a new application),
`TOPUP_EXCEEDS_LIMIT` (409, and the message carries the ceiling, the savings it
derives from, and what the member would owe), plus `MEMBER_NOT_FOUND` and
`MEMBER_NOT_ACTIVE`.

`withdrawal` needs no request behind it and waits out no notice period. It
settles an outstanding `PENDING` withdrawal when the member has one — rewriting
its amount to what was actually paid — and writes its own `CONFIRMED` row when
they do not.

### Staff — `WORKER`, `ADMIN`, `SUPER_ADMIN`

Under `/admin/` for historical URL reasons; a field worker's daily work. The
worker and admin dashboards render the *same* screens, so these are the reads and
the processing actions both of them make.

| Method | Path |
|---|---|
| GET | `/v1/dashboard/admin/approvals` — registrations omitted for a `WORKER` |
| POST | `/v1/dashboard/admin/approvals/withdrawal` · `/withdrawal/reject` — processes any pending posting (FR-07). Approving a withdrawal marks it `PROCESSED` and moves no money; the debit happens when a worker pays it |
| GET | `/v1/dashboard/admin/{members,loans,deposits}` |
| GET | `/v1/dashboard/admin/reports/monthly?year=&month=` · `reports/yearly?year=` · `reports/loans` |
| GET · POST | `/v1/dashboard/admin/donations` |

### Admin — `ADMIN`, `SUPER_ADMIN`

Deciding, rather than processing: approving a registration or a loan, starting a
settlement, administering staff, reading the audit trail.

| Method | Path |
|---|---|
| GET | `/v1/dashboard/admin` — carries `recentActivity`, the audit trail |
| GET | `/v1/dashboard/admin/{workers,profile}` |
| POST | `/v1/dashboard/admin/members/status` |
| POST | `/v1/dashboard/admin/workers/welcome-email` |
| POST | `/v1/dashboard/admin/approvals/registration` · `/registration/reject` |
| POST | `/v1/dashboard/admin/approvals/loan` · `/loan/reject` |
| GET | `/v1/dashboard/admin/loans/detail?id=` |
| POST | `/v1/dashboard/admin/loans/default` — triggers the settlement waterfall |
| PUT | `/v1/dashboard/admin/profile` |

## Next.js route handlers — same origin, `/api/v1/*`

Legacy shape: bare JSON, no `success` envelope ([ADR-005](decisions.md)). Auth via `lib/server-auth.ts` using the shared `JWT_SECRET`.

Thirteen handlers, 26 exported methods. The "called by" column is the audited
answer, not an intention — grep every `/api/v1/...` literal in `app/`,
`components/`, `lib/`, `hooks/` and `e2e/` if you change it. Only
`admin/audit-logs` has no caller, and it is OBS-08's backend waiting on its
viewer UI. An uncalled route is not automatically dead, but it is never
exercised, so treat it as untested.

| Methods | Path | Purpose | Called by |
|---|---|---|---|
| GET·POST | `/api/v1/registrations` | public registration submit + admin listing | register page |
| POST | `/api/v1/auth/login` | legacy login path, kept for older clients | login page |
| GET·PUT | `/api/v1/settings` | `system_config` read / upsert | login, member loans, admin settings/members, `lib/documents/org-settings.ts`. **GET takes no token and answers anyway, in four tiers** — public / member / worker (+`CONTENT_CONFIG_KEYS`) / admin ([ADR-024 is the CSP one; see ADR-021's neighbours and `lib/system-config.ts`](decisions.md)). **PUT is gated by key, not only by role**: an admin writes anything declared, a worker writes `CONTENT_CONFIG_KEYS` and is refused 403 for anything else, all-or-nothing per request. The browser must call GET through `lib/settings-client.ts`, which attaches the token; a bare `fetch` silently gets the public subset |
| GET·POST·PUT·DELETE | `/api/v1/gallery` | gallery CMS | admin gallery + settings |
| POST·PUT·PATCH·DELETE | `/api/v1/admin/workers` | worker account CRUD | admin workers |
| POST | `/api/v1/member/transactions/{id}/dispute` | member disputes amount | member transactions |
| GET·POST·PUT | `/api/v1/dashboard/support/[...path]` | proxy to the Go support endpoints — an **allow-list** of `config`, `threads`, `threads/processed`, `messages`, `stream`, `stream/ticket`, method by method; anything else is 404 here and never reaches Go. Mutations are limited to 60/min per member address, because the Go limiter sees Vercel's ([ADR-021](decisions.md)) | `lib/api.ts` rewrite |
| POST | `/api/v1/loans/applications` | member loan application | `components/dashboard/loan-application-form.tsx` |
| POST | `/api/v1/loans/{id}/guarantor-approval` | guarantor accepts/rejects | `components/dashboard/guarantor-requests.tsx` |
| GET·POST·PUT·DELETE | `/api/v1/admin/branches` | branch CRUD — offices staff are assigned to. `DELETE` **deactivates** rather than deletes when staff are assigned, because `assignedBranch` is `SetNull` and deleting would silently unassign them ([WO-72](changelog.md)) | admin branches page, worker branch picker |
| GET | `/api/v1/admin/audit-logs` | audit viewer feed | **nothing** — OBS-08's missing UI |
| POST | `/api/v1/admin/members/{id}/erase` | **FR-23 / [ADR-033](decisions.md).** Erase a member: **anonymise** if they have any posting (identity columns cleared, contact tombstoned, documents / addresses / nominee and their Cloudinary assets deleted — `accountNo`, the account and every `Transaction` and `Loan` untouched), **delete** outright if they have none. The route counts references and decides; the caller does not choose. Refuses **409** while a loan or a guarantee is unsettled, **400** unless the caller echoes the member's own `accountNo`. Writes the revoke-all marker in the same transaction, and an audit row naming the account number, the counts and the admin's reason — never what it erased. Here rather than in Go because it must delete the Cloudinary assets; the *rejected-applicant* half of FR-23 is a Go background sweep instead | admin member detail screen |

**Five handlers were removed** once it was clear none had a caller: two that
mutated balances from Next (against [ADR-001](decisions.md)), one of which also
wrote a display name into `processedBy` — a foreign key to `users.id`, so every
call 500'd — and three superseded by the Go routes of the same name. If you are
about to add a balance write here, the answer is Go.

## Adding an endpoint

Changes a balance → Go: route in `main.go`, HTTP shape in `dashboard_handler.go`, SQL + rules in the matching `internal/repositories/*_repository.go`, wrapped in a transaction, with an `audit_logs` append. Otherwise a Next route handler is fine. Either way, document it here in the same commit.

## Smoke test

```bash
curl -s localhost:8081/v1/health
curl -s -X POST localhost:8081/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@hasnahena.local","password":"<admin-password>"}'
```
