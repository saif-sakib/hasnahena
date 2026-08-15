# Work Orders

Execution specs. [production-readiness.md](production-readiness.md) says *why* a
task exists; this file says *exactly what to change*, so a future session can act
without re-exploring the codebase.

## How to use this

Prompt with just the ID:

> `do WO-01`  ·  `do WO-01 and WO-02`  ·  `do batch A`

Each order below is self-contained — files, anchors, the change, the
verification command, and the done-when test. **No exploration should be needed**
for anything with a ✅ *Researched* line. If a file has moved, say so and I will
re-locate it rather than guessing.

Line numbers are anchors, not guarantees — they were correct on 2026-08-15. Match
on the quoted code, not the number.

## Batches

| Batch | Orders | Theme | Session size |
|---|---|---|---|
| **A** | WO-01 → WO-05 | Security defects — do first, ship together | ~1 session |
| **B** | WO-06 → WO-09 | Runtime hardening | ~1 session |
| **C** | WO-10 → WO-13 | Test harness + CI | ~2 sessions |
| **D** | WO-14 → WO-16 | Backups, migrations, seed | ~1 session |
| **E** | WO-17 → WO-19 | Observability | ~1 session |
| **F** | WO-20 → WO-22 | Containerise | ~1 session |
| Later | see [production-readiness.md](production-readiness.md) | Code health, ops, host move | — |

### Standing rules for every order

- `pnpm typecheck` must end with only the 2 known `e2e/admin-dashboard.spec.ts` errors (until WO-10 removes them).
- `go build ./...` **cannot run on this machine** — no Go toolchain. Every Go order ends with "run `go build ./...` yourself".
- Money changes stay in the Go API, one transaction, with an `audit_logs` row (CLAUDE.md rules 1, 2, 6).
- Update `docs/tasks.md` and tick the order here in the same commit.

---

# Batch A — Security defects

Ship these together. They are the four things that are wrong *right now*.

## WO-01 · Enforce token revocation `[ ]`

**Why:** SEC-01. Logout and password-change revoke nothing; the `token_blacklist`
table is written and never read. A leaked token lives its full 24 hours.

✅ *Researched.* `authFromRequest` is the **single choke point** — `requireAuthenticated`,
`requireRoles` and `userIDFromRequest` all route through it. This is a one-line
behavioural change.

**Files**
- `apps/api/internal/handlers/dashboard_handler.go:476`
- `apps/api/internal/services/auth_service.go:196` (`ValidateToken`)

**Change**
1. In `authFromRequest`, replace
   `claims, err := h.authService.ParseAccessToken(tokenString)`
   with `claims, err := h.authService.ValidateToken(r.Context(), tokenString)`.
2. In `ValidateToken`, fail closed on the revocation check — it currently reads
   `if err == nil && revoked`, which treats a DB error as "not revoked". Make the
   error a rejection.
3. Leave `auth_handler.go:90` on `ParseAccessToken` — that is the logout path
   blacklisting the token itself; checking the blacklist there would be circular.
4. Delete the "NOT WIRED UP" comment block above `ValidateToken` once it is wired.

**Watch:** adds one DB round-trip per authenticated request. Acceptable at this
scale; if it shows up in latency, cache the `all:<userID>` marker lookup, not the
per-token one.

**Verify:** log in → copy the token → log out → reuse the token → expect 401.
Then `go build ./...`.

## WO-02 · Add the missing role checks `[ ]`

**Why:** SEC-02. Any member's token can default any loan (which moves money via
guarantor recovery) and read foundation-wide financials.

✅ *Researched.* Exactly four handlers. `AdminLoans` / `AdminLoanDetail` nearby
are already correct — copy their shape.

**File:** `apps/api/internal/handlers/dashboard_handler.go`

| Handler | Anchor | Add |
|---|---|---|
| `MarkLoanDefaulted` | :950 | `requireRoles(w, r, "ADMIN", "SUPER_ADMIN")` — keep `userID` for the audit row |
| `MonthlyReport` | :1025 | same |
| `YearlyReport` | :1055 | same |
| `LoanPerformanceReport` | :1078 | same |

**Then close the trap** (this is the real fix): in
`apps/api/cmd/server/main.go`, wrap the admin route group in a middleware that
requires ADMIN/SUPER_ADMIN, so a new handler is protected by *where it is
mounted*, not by the author remembering. Keep the per-handler checks as
defence-in-depth.

**Verify:** call each of the four with a MEMBER token → expect 403. Then `go build ./...`.

## WO-03 · Lock down the gallery write endpoints `[ ]`

**Why:** SEC-03. `POST`/`PUT`/`DELETE` have no auth at all under
`Access-Control-Allow-Origin: *`. Anyone on the internet can rewrite the public
gallery of a charity's site.

**File:** `apps/web/app/api/v1/gallery/route.ts`

**Change**
1. `requireAuth(req)` + ADMIN/SUPER_ADMIN check on `POST`, `PUT`, `DELETE`.
   Use `app/api/v1/admin/workers/route.ts:35-39` as the pattern.
2. `GET` stays public and unauthenticated.
3. Replace the wildcard `corsHeaders` with the configured origin.
4. Same pass: fix SEC-04 in `app/api/v1/settings/route.ts` (also wildcard) and
   put the shared CORS helper in `apps/web/lib/`.

**Verify:** `curl -X DELETE .../api/v1/gallery?id=x` with no token → 401.
`pnpm typecheck && npx next build`.

## WO-04 · Bound request bodies `[ ]`

**Why:** SEC-07. `utils.MaxRequestBodySize` is defined and never applied.

✅ *Researched.* There are **27 `utils.ParseJSON` call sites**, so do **not**
change the signature to take `http.ResponseWriter`. Wrap inside instead:

**File:** `apps/api/internal/utils/response.go:56`

```go
func ParseJSON(r *http.Request, v interface{}) error {
	return json.NewDecoder(io.LimitReader(r.Body, MaxRequestBodySize)).Decode(v)
}
```

Add the `io` import. Update the "NOT YET ENFORCED" comment in `validation.go`.

**Verify:** POST a >1 MB body → decode error, not OOM. `go build ./...`.

## WO-05 · Stop accepting tokens in the query string `[ ]`

**Why:** SEC-05. Query strings leak into proxy logs, CDN logs and `Referer`.

**File:** `apps/api/internal/handlers/dashboard_handler.go:467`

**Change:** issue a short-lived (~60 s) single-purpose SSE ticket for
`/v1/dashboard/support/stream` and accept only that in the query string — never
the full access token. Store tickets in the existing `rate_limits`-style table or
a small `sse_tickets` table.

**Lower-effort alternative** if you want this closed today: keep the query-string
path but reject any token whose remaining lifetime exceeds 5 minutes. Say which
you want; default is the ticket.

**Verify:** SSE still streams; a full access token in `?access_token=` is rejected.

---

# Batch B — Runtime hardening

## WO-06 · Server timeouts and graceful shutdown `[ ]`

**Why:** RUN-01 + RUN-02. `http.ListenAndServe` has no timeouts (slowloris) and
no signal handling — **a deploy can kill the API mid money-moving transaction.**

**File:** `apps/api/cmd/server/main.go:184`

**Change:** build an `http.Server` with `ReadHeaderTimeout`, `ReadTimeout`,
`WriteTimeout`, `IdleTimeout`; catch `SIGTERM`/`SIGINT`; `Shutdown(ctx)` with a
~30 s drain; then close the pool. Note the SSE endpoint needs a longer or zero
`WriteTimeout` — mount it on a separate server or use `http.ResponseController`.

**Verify:** `SIGTERM` during an in-flight request lets it finish. `go build ./...`.

## WO-07 · Real health and readiness endpoints `[ ]`

**Why:** RUN-03. `/v1/health` returns `ok` without touching the database.

**File:** `apps/api/cmd/server/main.go:87`

**Change:** keep `/v1/health` cheap (liveness). Add `/v1/ready` that runs
`dbPool.Ping(ctx)` with a ~2 s timeout and returns 503 on failure. Keep
`emailConfigured` on `/v1/health` — the release checklist in deployment.md uses it.

**Verify:** stop Postgres → `/v1/ready` 503, `/v1/health` 200. Update
[deployment.md](deployment.md) release checklist.

## WO-08 · Schedule the cleanup jobs `[ ]`

**Why:** RUN-06. `CleanupExpiredTokens` and `CleanupExpiredRateLimits` are never
called; both tables grow forever.

**File:** `apps/api/cmd/server/main.go`

**Change:** a `time.Ticker` goroutine (hourly is plenty) calling both, with the
shutdown context from WO-06 so it stops cleanly. Log rows deleted. Remove the
"NEVER CALLED" comments in `security_service.go`.

**Verify:** insert an expired row, wait a tick, confirm it is gone. `go build ./...`.

## WO-09 · Structured logging + PII scrub `[ ]`

**Why:** RUN-04 + RUN-05. `log.Printf` is unqueryable, `middleware.RequestID` is
installed but never logged, and handlers log member **email addresses**.

**Files:** `apps/api/internal/middleware/logging.go`, `dashboard_handler.go`
(lines 454, 673, 1262 log emails)

**Change:** move to `log/slog` with JSON output; log request ID, method, path,
status, duration, and user ID where known. Replace logged email addresses with
user IDs. Add a response-writer wrapper to capture status.

**Verify:** logs parse as JSON; no email addresses in output. `go build ./...`.

---

# Batch C — Tests and CI

## WO-10 · Decide the e2e story `[ ]`

**Why:** CI-01. The orphan spec is the *only* reason `pnpm typecheck` reports
errors.

**File:** `apps/web/e2e/admin-dashboard.spec.ts`

**Change:** either add `@playwright/test` + `playwright.config.ts` + a `test:e2e`
script, or delete the spec. **Ask me which if unsure — default is wire it up**,
because scenario 1 below needs it.

**Verify:** `pnpm typecheck` exits clean with **zero** errors. Update the CLAUDE.md
note that currently says 2 errors are expected.

## WO-11 · Go unit tests on money maths `[ ]`

**Why:** CI-02. Table-driven, no DB.

**Cover:** `FormatDocumentNumber` / sequence allocation, loan cap enforcement,
default waterfall proportions, installment rounding (the `finalInstallment`
adjustment in `lib/documents/builders/loan-agreement.ts` has a Go counterpart),
balance arithmetic.

**Verify:** `go test ./...` passes.

## WO-12 · Integration tests against real Postgres `[ ]`

**Why:** CI-03. `docker-compose.yml` already provides the database.

**Cover the five priority scenarios** in [tasks.md](tasks.md#priority-test-scenarios-when-testing-starts),
in that order. Scenario 1 (wrong amount → dispute → correction → audit trail)
first — it exercises the whole lifecycle.

**Verify:** `go test ./... -tags=integration` green against a fresh container.

## WO-13 · GitHub Actions pipeline `[ ]`

**Why:** CI-05 → CI-09. No CI exists at all.

**Create:** `.github/workflows/ci.yml` — on PR and push to `main`:
`pnpm typecheck`, `pnpm lint`, `go vet ./...`, `go build ./...`, `go test ./...`,
web tests. Postgres service container for WO-12.

**Also:** `gitleaks` step (CI-08), Dependabot config (CI-07), and branch
protection on `main` (CI-09 — I cannot set this, it is a GitHub settings change
you make).

**Note:** `go vet` would have caught the unused `ValidateToken` and
`MaxRequestBodySize` that hid SEC-01 and SEC-07.

**Verify:** open a PR, all checks green.

---

# Batch D — Data safety

## WO-14 · Automated backups `[ ]`

**Why:** DATA-01. **Highest-value item in this file.** Neon branches die with the
account; nothing is scheduled today.

**Change:** nightly `pg_dump` to off-provider storage (S3/B2) with a lifecycle
policy. GitHub Actions cron is the zero-infrastructure option — needs a repo
secret for the direct (non-pooled) Neon URL.

**Verify:** a dump lands; restore it into a scratch DB and diff row counts (that
is WO-15).

## WO-15 · Restore drill + RPO/RTO `[ ]`

**Why:** DATA-02 + DATA-03. An untested backup is a rumour.

**Change:** a documented, repeatable restore procedure in
[deployment.md](deployment.md); run it once; record the actual RTO achieved and
the accepted RPO. For member savings, "24 h data loss" must be a stated decision.

## WO-16 · Prisma migrations + seed `[ ]`

**Why:** DATA-04 + DATA-05. `db push` has no history and no rollback; there is no
way to create the first admin except by hand.

**Change:** baseline the current schema as an initial migration, switch the
workflow to `prisma migrate`, supersede [ADR-004](decisions.md) with a new ADR
explaining what changed. Add `apps/web/scripts/seed.mjs` creating a SUPER_ADMIN
from env vars, plus `system_config` defaults.

**Watch:** baselining against a live production database needs
`prisma migrate resolve --applied`. Do it on a Neon branch first.

**Verify:** fresh database + `pnpm db:migrate && pnpm db:seed` → working admin login.

---

# Batch E — Observability

| ID | Task | Spec |
|---|---|---|
| WO-17 `[ ]` | Metrics (OBS-01/02) | `prometheus/client_golang` on `/metrics`: request rate, latency histogram, error rate, DB pool saturation. Plus business gauges — unconfirmed transactions >48 h, open disputes |
| WO-18 `[ ]` | Error tracking + uptime (OBS-03/04) | Sentry free tier both apps with release tags; UptimeRobot on `/v1/ready` (needs WO-07) |
| WO-19 `[ ]` | Alerts (OBS-06) | API down 5 min, error rate >5%, DB pool exhausted, unconfirmed-transaction threshold. Route to email/Telegram |

---

# Batch F — Containerise

Do this **before** you need to move hosts, not during. It is the prerequisite for
any VPS/AWS work and the thing that makes a migration boring.

| ID | Task | Spec |
|---|---|---|
| WO-20 `[ ]` | Go Dockerfile (PKG-01) | Multi-stage, `CGO_ENABLED=0`, distroless/alpine final, non-root, `HEALTHCHECK` → `/v1/ready`. Target <20 MB |
| WO-21 `[ ]` | Next Dockerfile (PKG-02) | Multi-stage with `output: 'standalone'` in `next.config.js`. Prisma engine binaries need a matching base image — this is the fiddly one |
| WO-22 `[ ]` | Full-stack compose (PKG-03/04/05) | Extend `docker-compose.yml` beyond Postgres so `docker compose up` gives a working platform. Doubles as onboarding and as the WO-12 test environment. Add `.dockerignore`, pin base images by digest |

---

# Recommended order

1. **Batch A** — the live defects. Nothing else is worth doing first.
2. **WO-10** — makes `pnpm typecheck` a clean signal, which every later order relies on.
3. **WO-14 + WO-15** — backups. Cheap, and the only protection against the unrecoverable failure.
4. **Batch B** — hardening.
5. **WO-11 → WO-13** — tests and CI, so regressions stop being silent.
6. **WO-16** — migrations, before a second environment exists.
7. **Batch E**, then **Batch F**.
8. Host move — [production-readiness.md](production-readiness.md#phase-6--vps-or-aws), only after all of the above.

If you only ever do part of this list: **A, WO-14, WO-15**. That is the
difference between "it works" and "it works, and if it breaks the members' money
is still there."
