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
| ~~**A**~~ | WO-01 → WO-05 | Security defects — **done** | — |
| ~~**B**~~ | WO-06 → WO-09 | Runtime hardening — **done** | — |
| ~~**C**~~ | WO-10 → WO-13 | Test harness + CI — **done** | — |
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

# Batch A — Security defects `[x]`

**Done.** All five shipped together. Outcomes and anything that changed from the
spec below are recorded per-order; the *why* is in
[production-readiness.md](production-readiness.md) under SEC-01 → SEC-05, SEC-07.

Two notes for whoever picks up Batch B:

- **`pnpm db:push` is needed before the next deploy** — WO-05 adds an
  `sse_tickets` table. The Go API also creates it on boot in
  `EnsureSupportSchema`, so a missed push is not fatal.
- Password change now signs the user out of the tab that made the change, since
  revocation is finally enforced. The web UI does not yet handle that — it will
  start 401ing rather than redirecting to login. Worth a follow-up.

## WO-01 · Enforce token revocation `[x]`

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

**Done, with one extra.** `BlacklistAllUserTokens` inserted its `all:<userID>`
marker with no `ON CONFLICT`, so a second password change inside 24 h hit the
unique index on `tokenHash` and revoked nothing — it now upserts the marker
forward. The redundant `userIDFromRequest` + `requireRoles` double-auth in
`AdminLoans`/`AdminLoanDetail` was also collapsed to one call, since each
authentication is now a DB round-trip.

## WO-02 · Add the missing role checks `[x]`

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

**Done.** The trap is closed with `dashboard.Route("/admin", …)` +
`dashboardHandler.RequireRoles(…)`. One deliberate exception, commented in
`main.go`: `/admin/donations` (GET and POST) is recorded by field workers too, so
it sits in a second `admin.Group` gated ADMIN/SUPER_ADMIN/WORKER. It keeps the
`/admin` path only for URL compatibility — do not move it into the admin-only
group without changing the worker donation flow.

## WO-03 · Lock down the gallery write endpoints `[x]`

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

**Done.** The shared helper is [lib/cors.ts](../apps/web/lib/cors.ts): it reads
the same `CORS_ORIGINS` list the Go API reads, echoes the request `Origin` only
when allow-listed, and sends `Vary: Origin`. Nothing in the app used the gallery
write routes — the admin gallery UI goes through server actions — so locking
them broke no flow.

## WO-04 · Bound request bodies `[x]`

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

**Done** exactly as specified. `io.LimitReader` rather than
`http.MaxBytesReader` because the latter needs the `ResponseWriter` that
`ParseJSON` deliberately does not take.

## WO-05 · Stop accepting tokens in the query string `[x]`

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

**Done — the ticket, per the stated default.** `POST /v1/dashboard/support/stream/ticket`
issues 32 random bytes, stored SHA-256-hashed in a new `sse_tickets` table
(created in `EnsureSupportSchema` and declared in `schema.prisma`), valid 60 s
and scoped to `purpose = 'support_stream'`. `SupportStream` takes an
`Authorization` header when present, otherwise `?ticket=`. The `?access_token=`
fallback is deleted from `authFromRequest` entirely.

Two decisions worth knowing: a ticket is **not** consumed on use, because
`EventSource` reconnects re-send the same URL and the 60 s TTL already bounds
replay; and expired rows are swept on the issue path, so this needs no scheduled
job from WO-08.

**Not done, and it is the loose end:** nothing in the web app opens an
`EventSource` yet — the support UI polls. Whoever writes that client must fetch a
ticket before every connect.

---

# Batch B — Runtime hardening `[x]`

**Done.** Outcomes and deviations are recorded per-order below; the *why* is in
[production-readiness.md](production-readiness.md) under RUN-01 → RUN-06.

Two notes for whoever picks up Batch C:

- **The host's stop grace period must be longer than `SERVER_SHUTDOWN_TIMEOUT`**
  (default 30 s), or the platform `SIGKILL`s during the drain and the graceful
  shutdown buys nothing. Render's default grace is also 30 s — lower ours to
  ~25 s there. Recorded in deployment.md.
- `go build ./...` **was** run for this batch. The toolchain is not installed on
  this machine, but a pinned Go 1.22 tarball unpacked into the session scratchpad
  builds the module fine — `go build`, `go vet` and `go test` all work that way
  if you need them before CI exists.

## WO-06 · Server timeouts and graceful shutdown `[x]`

**Why:** RUN-01 + RUN-02. `http.ListenAndServe` has no timeouts (slowloris) and
no signal handling — **a deploy can kill the API mid money-moving transaction.**

**File:** `apps/api/cmd/server/main.go:184`

**Change:** build an `http.Server` with `ReadHeaderTimeout`, `ReadTimeout`,
`WriteTimeout`, `IdleTimeout`; catch `SIGTERM`/`SIGINT`; `Shutdown(ctx)` with a
~30 s drain; then close the pool. Note the SSE endpoint needs a longer or zero
`WriteTimeout` — mount it on a separate server or use `http.ResponseController`.

**Verify:** `SIGTERM` during an in-flight request lets it finish. `go build ./...`.

**Done.** Timeouts come from `SERVER_*` env vars rather than constants, matching
the existing `DB_*` pattern. The SSE problem was solved with
`http.ResponseController.SetWriteDeadline` (not a second server) — which is why
the WO-09 access-log wrapper has to implement `Unwrap` and `Flush`. There is a
test for exactly that in `internal/middleware/logging_test.go`, because losing
either one would break SSE silently.

Shutdown ends SSE streams first via `DashboardHandler.BeginShutdown`. Without
that, `Shutdown` would wait out the full 30 s on connections that never go idle
while a real deposit posting is what the window is for.

**Only verified by build and unit test, not by running the process** — the sole
`DATABASE_URL` on this machine points at production Neon, and booting the API
runs `EnsureSupportSchema` DDL. Someone with a local Postgres should still do the
`SIGTERM`-during-request check by hand.

## WO-07 · Real health and readiness endpoints `[x]`

**Why:** RUN-03. `/v1/health` returns `ok` without touching the database.

**File:** `apps/api/cmd/server/main.go:87`

**Change:** keep `/v1/health` cheap (liveness). Add `/v1/ready` that runs
`dbPool.Ping(ctx)` with a ~2 s timeout and returns 503 on failure. Keep
`emailConfigured` on `/v1/health` — the release checklist in deployment.md uses it.

**Verify:** stop Postgres → `/v1/ready` 503, `/v1/health` 200. Update
[deployment.md](deployment.md) release checklist.

**Done** as specified. deployment.md now has both checks in the release
checklist plus a line telling the operator to point liveness at `/v1/health` and
the load balancer at `/v1/ready`. Not run against a live database here — see
WO-06.

## WO-08 · Schedule the cleanup jobs `[x]`

**Why:** RUN-06. `CleanupExpiredTokens` and `CleanupExpiredRateLimits` are never
called; both tables grow forever.

**File:** `apps/api/cmd/server/main.go`

**Change:** a `time.Ticker` goroutine (hourly is plenty) calling both, with the
shutdown context from WO-06 so it stops cleanly. Log rows deleted. Remove the
"NEVER CALLED" comments in `security_service.go`.

**Verify:** insert an expired row, wait a tick, confirm it is gone. `go build ./...`.

**Done.** `startCleanupLoop` sweeps once at boot as well as on the ticker — a
process that restarts more often than the interval would otherwise never sweep.
Interval is `CLEANUP_INTERVAL` (default 1h, `0` disables). Each sweep is bounded
at 1 minute so a stuck delete cannot stack up. `sse_tickets` is deliberately not
in this loop; it sweeps itself on the ticket-issue path.

## WO-09 · Structured logging + PII scrub `[x]`

**Why:** RUN-04 + RUN-05. `log.Printf` is unqueryable, `middleware.RequestID` is
installed but never logged, and handlers log member **email addresses**.

**Files:** `apps/api/internal/middleware/logging.go`, `dashboard_handler.go`
(lines 454, 673, 1262 log emails)

**Change:** move to `log/slog` with JSON output; log request ID, method, path,
status, duration, and user ID where known. Replace logged email addresses with
user IDs. Add a response-writer wrapper to capture status.

**Verify:** logs parse as JSON; no email addresses in output. `go build ./...`.

**Done, and slightly wider than the spec.** All seven `log.Printf` calls in the
handlers became `slog`, not just the three that logged emails, and `config.go`'s
two `log.Fatal`s became `slog.Error` + `os.Exit` so a boot failure is structured
too. `slog.SetDefault` routes the standard `log` package through the same JSON
handler, so anything left over still comes out parseable.

"User ID where known" needed plumbing: the middleware runs before the handler
knows who is calling, so `Logging` puts a small mutable holder in the request
context and `verifyActiveRole` fills it. That is one line in the single auth
choke point rather than a change per handler.

`Logging` is now registered **before** `Recoverer` so it is the outer wrapper —
otherwise a panic produces no access log line at all.

**Left alone:** chi's `Recoverer` still prints its panic trace as plain text to
stderr. That is RUN-08's job, not this one.

---

# Batch C — Tests and CI

## WO-10 · Decide the e2e story `[x]`

**Why:** CI-01. The orphan spec is the *only* reason `pnpm typecheck` reports
errors.

**File:** `apps/web/e2e/admin-dashboard.spec.ts`

**Change:** either add `@playwright/test` + `playwright.config.ts` + a `test:e2e`
script, or delete the spec. **Ask me which if unsure — default is wire it up**,
because scenario 1 below needs it.

**Verify:** `pnpm typecheck` exits clean with **zero** errors. Update the CLAUDE.md
note that currently says 2 errors are expected.

**Done — wired up, per the stated default.** `@playwright/test` added as a web
devDependency, `apps/web/playwright.config.ts` created, `pnpm test:e2e` added at
both the root and web package. `pnpm typecheck` now exits **clean with zero
errors** and CLAUDE.md says so.

Two changes to the spec itself. It took `http://localhost:3000` and a hardcoded
password; it now uses `baseURL` from the config and reads
`E2E_ADMIN_IDENTIFIER` / `E2E_ADMIN_PASSWORD` from the environment — a real
password does not belong in the repo. And it **skips** rather than fails when
those are unset, so a developer without a local seed does not see a red suite
they cannot fix.

`workers: 1` in the config is deliberate: the specs share one database and one
set of seeded accounts, so parallel runs would fight over the same balances.

**Not run here** — needs a seeded local database, and the only `DATABASE_URL` on
this machine is production. Browsers also need `playwright install chromium`
once.

## WO-11 · Go unit tests on money maths `[x]`

**Why:** CI-02. Table-driven, no DB.

**Cover:** `FormatDocumentNumber` / sequence allocation, loan cap enforcement,
default waterfall proportions, installment rounding (the `finalInstallment`
adjustment in `lib/documents/builders/loan-agreement.ts` has a Go counterpart),
balance arithmetic.

**Verify:** `go test ./...` passes.

**Done.** The arithmetic was inline in `user_repository.go` and duplicated, so
testing it meant extracting it first: **[apps/api/internal/money](../apps/api/internal/money)**
is a new package of pure `int64`-taka functions — `InstallmentPlan`,
`MaxLoanAmount`, `EvaluateEligibility`, `RecoverFrom`, `Waterfall`. The
repository now calls them at all six sites, so the tests guard production code
rather than a parallel copy. Behaviour is unchanged.

Coverage: `internal/money` (table-driven, including a property test asserting
every schedule repays the principal **exactly** — over-collecting is riba,
under-collecting means the loan never closes), `FormatDocumentNumber` and the
series constants, `FormatMemberID`/`ParseMemberSequence` round trips and
malformed input, and token-revocation timing.

Sequence *allocation* is not covered — it is a SQL upsert and belongs to WO-12.

**Found and fixed while writing these:** `installmentAmount := amount / int64(installments)`
silently dropped the remainder, so a 10,000 taka loan over 3 months recorded
3,333 × 3 = 9,999. The PDF already compensated with an adjusted final
installment; the Go side did not, so the stored schedule and the signed contract
disagreed. `money.InstallmentPlan` now returns both figures and the invariant is
a test.

## WO-12 · Integration tests against real Postgres `[x]`

**Why:** CI-03. `docker-compose.yml` already provides the database.

**Cover the five priority scenarios** in [tasks.md](tasks.md#priority-test-scenarios-when-testing-starts),
in that order. Scenario 1 (wrong amount → dispute → correction → audit trail)
first — it exercises the whole lifecycle.

**Verify:** `go test ./... -tags=integration` green against a fresh container.

**Done.** 17 tests in `internal/repositories/integration_test.go`, behind the
`integration` build tag so `go test ./...` stays fast and DB-free. Run with
`pnpm test:integration`; with `TEST_DATABASE_URL` unset the suite exits cleanly
rather than failing.

The schema under test comes from `prisma db push`, deliberately — that is what
makes these tests catch defects the unit tests structurally cannot.

Scenario coverage against the five in tasks.md:

| # | Scenario | State |
|---|---|---|
| 1 | wrong amount → dispute → correction → audit trail | **Covered**, and it required fixing the code first: **none of the four money methods wrote an `audit_logs` row**, in plain violation of CLAUDE.md rule 2. They now write one inside the posting transaction. The dispute step (a Next route) wrote none either; it does now |
| 2 | loan cap enforcement + recalculation after a deposit | Covered — at the cap, one taka over, below minimum deposit, one-loan-at-a-time, and the cap moving after a deposit |
| 3 | default waterfall | Covered — borrower first, fall-through to guarantor, donation pool, residual debt, no balance driven negative, **and pool depletion** |
| 4 | withdrawal blocking | Covered for active loan, active guarantee, insufficient balance, and the `allowActiveLoanWithdrawal` policy branch. **The notice period is not covered because it is not implemented** (FR-08) |
| 5 | audit immutability | Covered behaviourally: a correction appends and the original row is byte-identical afterwards. **Not enforced at the database level** — no trigger or grant stops an UPDATE, so this proves the code appends, not that the table cannot be rewritten |

**Two live defects found by writing these**, both in the donation-pool leg of the
waterfall, both silent:

1. The `INSERT` recording the draw omitted `"accountId"` and `"userId"`, which
   are NOT NULL — so it always failed. Its error was discarded while the loan was
   still written down, so **debt vanished with no ledger row behind it**.
2. The pool balance summed `DONATION` rows only and never subtracted prior
   draws, so **the same donation could settle an unlimited number of defaults**.

Both fixed, both now pinned by tests. The swallowed `tx.Exec` errors in the
borrower and guarantor steps are checked now too.

## WO-13 · GitHub Actions pipeline `[x]`

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

**Done.** [.github/workflows/ci.yml](../.github/workflows/ci.yml) with four jobs
on PR and push to `main`:

| Job | Does |
|---|---|
| `web` | `pnpm typecheck`, `pnpm lint` |
| `go` | `gofmt` check, `go vet`, `go build`, `go test` |
| `integration` | Postgres 16 service container → `prisma db push` → `go test -tags=integration` |
| `secrets` | `gitleaks` over full history (CI-08) |

Plus [dependabot.yml](../.github/dependabot.yml) (CI-07), grouped and monthly:
a daily stream of individual PRs gets ignored by a solo maintainer, and an
ignored update stream hides the security ones in noise. Next/React/Prisma majors
are excluded because those are migrations, not updates.

The `gofmt` step excludes three files that were already unformatted before this
pipeline existed, so nobody has to reformat them as a drive-by in an unrelated
PR.

I ran the `integration` job's exact sequence locally against a fresh database
and it passes. The workflow itself has not run on GitHub — that needs a push.

**CI-09 (branch protection on `main`) is yours** — it is a GitHub settings
change I cannot make.

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

1. ~~**Batch A** — the live defects.~~ Done.
2. ~~**Batch B** — hardening.~~ Done (taken early; it was one session and it stops deploys landing mid-transaction).
3. **WO-10** — makes `pnpm typecheck` a clean signal, which every later order relies on.
4. **WO-14 + WO-15** — backups. Cheap, and the only protection against the unrecoverable failure.
5. **WO-11 → WO-13** — tests and CI, so regressions stop being silent.
6. **WO-16** — migrations, before a second environment exists.
7. **Batch E**, then **Batch F**.
8. Host move — [production-readiness.md](production-readiness.md#phase-6--vps-or-aws), only after all of the above.

If you only ever do part of this list: **A, B, WO-14, WO-15**. That is the
difference between "it works" and "it works, and if it breaks the members' money
is still there."
