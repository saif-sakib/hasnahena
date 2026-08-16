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
| ~~**D**~~ | ~~WO-14 → WO-16~~ | ~~Backups, migrations, seed~~ | **Done** |
| ~~**E**~~ | ~~WO-17 → WO-19~~ | ~~Observability~~ | **Done** |
| ~~**F**~~ | ~~WO-20 → WO-22~~ | ~~Containerise~~ — done 2026-08-16 | ~1 session |
| **G** | WO-23 → WO-26 | Stack modernisation (security) | ~2–3 sessions |
| Later | see [production-readiness.md](production-readiness.md) | Code health, ops, host move | — |

### Standing rules for every order

- `pnpm typecheck` must exit clean, zero errors. WO-10 removed the two known `e2e/admin-dashboard.spec.ts` errors.
- No Go toolchain is installed system-wide. Unpack a pinned Go 1.25 tarball into the session scratchpad and put it on `PATH`; `go build`, `go vet` and `go test` then all work, so Go orders can be verified here rather than handed back.
- Money changes stay in the Go API, one transaction, with an `audit_logs` row (CLAUDE.md rules 1, 2, 6).
- Update `docs/tasks.md` and tick the order here in the same commit.

---

# Batch A — Security defects `[x]`

**Done.** All five shipped together. Outcomes and anything that changed from the
spec below are recorded per-order; the *why* is in
[production-readiness.md](production-readiness.md) under SEC-01 → SEC-05, SEC-07.

Two notes for whoever picks up Batch B:

- **`pnpm db:migrate` is needed before the next deploy** — WO-05 adds an
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

# Batch D — Data safety `[x]`

**Done.** All three shipped together. The backup and the restore are one
pipeline: `scripts/backup.sh` and `scripts/restore-check.sh`, both run by CI on
every push so neither can rot unnoticed.

## WO-14 · Automated backups `[x]`

**Why:** DATA-01. **Highest-value item in this file.** Neon branches die with the
account; nothing is scheduled today.

**Change:** nightly `pg_dump` to off-provider storage (S3/B2) with a lifecycle
policy. GitHub Actions cron is the zero-infrastructure option — needs a repo
secret for the direct (non-pooled) Neon URL.

**Verify:** a dump lands; restore it into a scratch DB and diff row counts (that
is WO-15).

**Done, and encrypted.** `.github/workflows/backup.yml` runs at 19:00 UTC
(01:00 Dhaka) nightly plus monthly, calling `scripts/backup.sh`: `pg_dump -Fc`
→ AES256 → GitHub artifact, 30-day retention nightly and 90-day monthly, with an
optional S3/B2/R2 copy when `BACKUP_S3_BUCKET` is set.

Encryption was not in the spec and is not optional. The dump carries every
member's name, phone, NID number and bcrypt hash; an unencrypted copy sitting in
an artifact store is a breach waiting for someone to notice. `backup.sh` refuses
to run without `BACKUP_PASSPHRASE` rather than falling back to plaintext.

Three other guards, each of which turns a silently-useless backup into a failed
job: the workflow fails fast if either secret is missing; `backup.sh` rejects a
`-pooler` host (PgBouncer drops the session state `pg_dump` needs); and it fails
if the dump comes out implausibly small.

**Two ways this stops running quietly** — GitHub disables scheduled workflows
after 60 days without a commit, and artifacts expire on their retention window.
Both are in [deployment.md](deployment.md#backups).

## WO-15 · Restore drill + RPO/RTO `[x]`

**Why:** DATA-02 + DATA-03. An untested backup is a rumour.

**Change:** a documented, repeatable restore procedure in
[deployment.md](deployment.md); run it once; record the actual RTO achieved and
the accepted RPO. For member savings, "24 h data loss" must be a stated decision.

**Done, as a script rather than a procedure.** A restore written down as prose
is verified once and then decays. `scripts/restore-check.sh` performs it —
decrypt, drop and recreate `public`, `pg_restore`, print every table's row
count, then assert what a silently-corrupt restore would break: required tables
present, no negative savings or loan balance, no transaction pointing at a
missing account, no loan pointing at a missing borrower. It prints total savings
and total loan balance, which are the numbers to compare against what the
application last reported.

**CI runs the full drill on every push** — migrate, seed, dump, restore, verify.
That is the part that keeps it true.

Drilled here on 2026-08-16 against a 58 MB database (20,041 users, 200,008
transactions — well beyond the real member count): **dump 1 s, restore and
verify 2 s** on local disk; network transfer to Neon dominates in practice.
**RPO 24 h, RTO under 1 h**, with the reasoning — and the fact that a 24 h RPO
means a member's deposit can be lost, which is only acceptable because the paper
passbook can reconstruct it — in [deployment.md](deployment.md#rpo-and-rto).

It refuses to restore onto a `neon.tech` host without `ALLOW_NEON_TARGET=yes`,
so a copy-pasted command cannot overwrite production.

**Not covered:** Cloudinary assets (NID and member photos). The database dump
does not include them — that is DATA-06, still open.

## WO-16 · Prisma migrations + seed `[x]`

**Why:** DATA-04 + DATA-05. `db push` has no history and no rollback; there is no
way to create the first admin except by hand.

**Change:** baseline the current schema as an initial migration, switch the
workflow to `prisma migrate`, supersede [ADR-004](decisions.md) with a new ADR
explaining what changed. Add `apps/web/scripts/seed.mjs` creating a SUPER_ADMIN
from env vars, plus `system_config` defaults.

**Watch:** baselining against a live production database needs
`prisma migrate resolve --applied`. Do it on a Neon branch first.

**Verify:** fresh database + `pnpm db:migrate && pnpm db:seed` → working admin login.

**Done, verified both ways.** `0_init` is generated with
`migrate diff --from-empty --to-schema-datamodel`, so it is byte-identical to
what `db push` produced — nothing changed shape at the cutover.
[ADR-014](decisions.md) supersedes ADR-004; CI now applies migrations instead of
pushing.

Verified on a fresh database: `pnpm db:migrate` → `pnpm db:seed` → real login
against the Go API returning a `SUPER_ADMIN` token. And separately on a database
built by `db push` (production's exact situation): `db:migrate:status` reported
the migration unapplied, `pnpm db:migrate:baseline` recorded it without
executing it, and status went to "up to date".

**One thing migrations do not fix.** The generated `0_init` emits
`"updatedAt" TIMESTAMP(3) NOT NULL` with **no default**, exactly like `db push`
— Prisma applies `@updatedAt` client-side either way. Hand-written SQL in the Go
API must still set both timestamps itself. Migrations make that reviewable in a
file instead of discoverable in production; they do not remove the trap.

**Watch out:** `prisma migrate` needs a direct (non-pooled) connection —
PgBouncer cannot hold the session advisory lock, and the failure looks like a
hang, not a wrong-host error. `pnpm db:migrate` derives the direct host from a
Neon URL and logs that it did.

---

# Batch E — Observability `[x]`

| ID | Task | Spec |
|---|---|---|
| WO-17 `[x]` | Metrics (OBS-01/02) | `prometheus/client_golang` on `/metrics`: request rate, latency histogram, error rate, DB pool saturation. Plus business gauges — unconfirmed transactions >48 h, open disputes |
| WO-18 `[x]` | Error tracking + uptime (OBS-03/04) | Sentry free tier both apps with release tags; UptimeRobot on `/v1/ready` (needs WO-07) |
| WO-19 `[x]` | Alerts (OBS-06) | API down 5 min, error rate >5%, DB pool exhausted, unconfirmed-transaction threshold. Route to email/Telegram |

**Done.** Operational detail is in
[deployment.md](deployment.md#observability); what is worth knowing here is what
was decided differently from the spec, and one bug the work uncovered.

**`/metrics` is authenticated.** The spec did not ask for this. The exposition
carries how many members are waiting on postings, how many disputes are open and
how many loans are outstanding — for a village cooperative that is commercially
and personally sensitive, and it would otherwise be readable by anyone who
guessed the URL. It is gated on `METRICS_TOKEN` and returns **404** when no token
is configured, so probing it reveals nothing.

**Route labels are chi route templates, never resolved paths.** A label per
member ID would be both a cardinality explosion and a slow privacy leak into a
metrics endpoint. Verified: no member ID appears in any label.

**Business gauges refresh on a ticker, not per scrape.** They are aggregate
queries over `transactions` and `loans`. Computing them per scrape ties database
load to whatever interval a stranger configures in their scraper, which is how a
monitoring system becomes the outage. `hasnahena_business_metrics_last_refresh_timestamp_seconds`
is exported alongside them because a frozen gauge otherwise looks exactly like a
calm system.

**Alerting is split three ways, and the split is a cost decision.** A private
repository gets 2,000 GitHub Actions minutes a month, billed per whole minute. A
5-minute uptime check is 8,640 runs — four times the entire free allowance, to do
worse what UptimeRobot does free at one-minute intervals. So uptime goes to
UptimeRobot, error rate to Sentry's own alert rules, and only the business
thresholds — the ones nothing else can see — run in Actions, twice daily, at
about 60 minutes a month. Alerts open a GitHub issue rather than emailing
directly: GitHub notifies the owner for free, and reusing one issue means a
week-long backlog is one thread instead of fourteen emails.

**Sentry is the current major (v10), not an older one pinned to Next 14.**
`@sentry/nextjs@10` declares peer support for Next 13 through 16, so it survives
the Batch G migration untouched. Session Replay is explicitly disabled — it would
record a member's dashboard, balances and name and send them to a third party.

## A latent bug this uncovered

`main.go` had a bare `ctx` that was a **10-second startup timeout**, used for the
database pool. Handing that context to any long-lived background loop makes the
loop run exactly once and return — silently, with no error anywhere.

The business-gauge refresher hit this immediately: gauges populated at boot and
then froze forever, which is indistinguishable from a system where nothing is
happening. `startCleanupLoop` was already correct (it takes `runCtx`), so nothing
shipped was broken — but the trap was one careless call away for anything added
later. The context is now named `startupCtx` and carries a comment saying exactly
this.

---

# Batch F — Containerise

Do this **before** you need to move hosts, not during. It is the prerequisite for
any VPS/AWS work and the thing that makes a migration boring.

| ID | Task | Spec |
|---|---|---|
| WO-20 `[x]` | Go Dockerfile (PKG-01) | Multi-stage, `CGO_ENABLED=0`, distroless/alpine final, non-root, `HEALTHCHECK` → `/v1/ready`. Target <20 MB |
| WO-21 `[x]` | Next Dockerfile (PKG-02) | Multi-stage with `output: 'standalone'` in `next.config.js`. Prisma engine binaries need a matching base image — this is the fiddly one |
| WO-22 `[x]` | Full-stack compose (PKG-03/04/05) | Extend `docker-compose.yml` beyond Postgres so `docker compose up` gives a working platform. Doubles as onboarding and as the WO-12 test environment. Add `.dockerignore`, pin base images by digest |

**Done 2026-08-16.** `apps/api/Dockerfile` (~17 MB: 15 MB static binary on a
2 MB distroless base), `apps/web/Dockerfile`, `.dockerignore`, and a
`docker-compose.yml` extended to Postgres → migrate → api → web.

Four things that were not obvious going in:

**The runtime image has no shell, so `HEALTHCHECK` had nothing to call.**
Distroless carries no curl, no wget, no busybox — which is the point of using
it. Rather than downgrade the base image or ship a second binary, the server
probes itself: `/server -healthcheck` handled as the first statement in `main`,
before `cfg.Load`, because `cfg.Load` exits on a missing `DATABASE_URL` and a
liveness probe that reports unhealthy over unset configuration is reporting on
the wrong thing. Costs nothing — `net/http` is already linked in.

**`.dockerignore` turned out to be a secret control.** Next's file tracer copied
`.env.local` and the `apps/web/.env` symlink into `.next/standalone/` — verified
by building it. Without the env rules in `.dockerignore` those go into an image
layer, where a later `RM` does not remove them. This is the single most
important part of the batch and the least interesting-looking.

**`output: 'standalone'` is gated behind `DOCKER_BUILD=1`.** Vercel ignores the
setting, but two Vercel builds were already broken this month by build-config
changes, and there was no reason to make a third possible. Verified both ways: a
normal `pnpm build` emits no `standalone/` directory at all.

**Alpine was rejected for the web image.** Prisma resolves its query engine
against the runtime libc. The traced output contains
`libquery_engine-debian-openssl-3.0.x.so.node`, which matches bookworm and not
musl. Alpine would need a `binaryTargets` change in `schema.prisma`, and the
failure mode is a container that starts cleanly and dies on the first query —
the kind of bug that reaches production because the health check is green.

Verified without a Docker daemon (the daemon on this machine refuses the current
user, see below): the static binary builds and is confirmed
`statically linked, stripped`; all four `-healthcheck` paths behave (no listener
→ 1, 200 → 0, 503 → 1, and no config fatal without `DATABASE_URL`); the
standalone tree was assembled by hand exactly as the Dockerfile's three `COPY`
lines do it and booted — `/en` and `/bn` both 200, hashed JS and CSS 200,
`/images/logo/logo.png` 200, and the Prisma engine loaded and reached Postgres.
**Not verified: `docker build` itself.** Nobody has run these through a daemon.

---

---

# Batch G — Stack modernisation

**Why this is a batch and not a chore.** On 2026-08-16 `pnpm audit` reported 41
vulnerabilities. Pinning patched versions of the transitive dependencies in
`pnpm.overrides` cleared 18 of them, including 12 rated high. The remaining 23
are **all** Next.js and next-intl, and none of them can be fixed on Next 14 —
every advisory is patched in 15.5+ only.

So this is a security backlog wearing a version number. It includes SSRF in
rewrites and in Server Actions, a Middleware/Proxy bypass, and several DoS
paths. For a platform holding members' savings, the Middleware bypass is the one
to care about: authentication redirects run there.

**Why it was not done in one pass with Batches A–D.** Next 14 → 16 is two
majors, drags React 18 → 19 with it, and makes `cookies()`, `headers()`,
`params` and `searchParams` async — which touches nearly every route handler and
page in `app/[locale]/`. Done carelessly it produces an application that builds
and then misbehaves at runtime in ways a typecheck cannot see. Half-migrated is
worse than outdated.

Do these **in order** and deploy between each. They are separated precisely so
that a failure tells you which one caused it.

| ID | Task | Notes |
|---|---|---|
| WO-23 `[ ]` | Next 14 → 15, React 18 → 19 | `npx @next/codemod@latest upgrade` does the mechanical part. The async request APIs are the real work. Verify every dashboard route by hand, not just `pnpm build` |
| WO-24 `[ ]` | Next 15 → 16, `eslint-config-next` to match | Smaller than WO-23. Do it only once WO-23 is deployed and quiet |
| WO-25 `[ ]` | next-intl 3 → 4 | Config and middleware shape changed. This is what serves every Bengali string — check both locales on every page |
| WO-26 `[ ]` | Tailwind 3 → 4 | Configuration moves from `tailwind.config.ts` into CSS `@theme`, and the PostCSS plugin becomes `@tailwindcss/postcss`. Purely visual risk: nothing will fail to build once configured, it will just look wrong. Compare screens side by side |

**Not in this batch, and not urgent:** Prisma 5 → 7. It has no advisory against
it, the schema is stable, and the Go API does not use the Prisma client at all —
only `apps/web` does. Take it when something needs it.

**Verify each order with:** `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm test:e2e`, and a manual pass over login, the member dashboard, and one
deposit — in **both** locales.

# Recommended order

1. ~~**Batch A** — the live defects.~~ Done.
2. ~~**Batch B** — hardening.~~ Done (taken early; it was one session and it stops deploys landing mid-transaction).
3. ~~**WO-10** — makes `pnpm typecheck` a clean signal.~~ Done.
4. ~~**WO-14 + WO-15** — backups.~~ Done.
5. ~~**WO-11 → WO-13** — tests and CI, so regressions stop being silent.~~ Done.
6. ~~**WO-16** — migrations.~~ Done.
7. ~~**Batch E**~~ done. ~~**Batch F**~~ done. **Batch G** is what remains.
8. Host move — [production-readiness.md](production-readiness.md#phase-6--vps-or-aws), only after all of the above.

If you only ever do part of this list: **A, B, WO-14, WO-15**. That is the
difference between "it works" and "it works, and if it breaks the members' money
is still there." All four are done, and so is everything through Batch F.

What remains is **Batch G**, and it is a different kind of risk from the rest of
this file. A through F closed defects and built the equipment for finding the
next one. G is a stack of unpatched advisories — including a Middleware bypass
in the layer that runs the authentication redirects — that cannot be fixed
without moving off Next 14. Nothing else on this list is now more urgent.
