# Production Readiness Map

Everything between today's free-tier deployment and a platform that can be run
on a VPS or AWS by someone who is not the author. Audited against the code on
**2026-08-16**, and re-audited **2026-08-17** against a running Postgres 17 —
every `[x]` below was re-verified against the source, not carried forward from
the previous pass.

> ## ⛔ Read this before anything else
>
> The 2026-08-17 audit found **four defects that destroy or misreport money**,
> proved against a real database rather than by reading. They are not on the
> list below because they are not operational readiness — they are the ledger
> being wrong. See [Phase −1](#phase-1--ledger-integrity-defects) at the top of
> this page. **Nothing else on this page matters until LEDGER-01 is fixed.**

This file is the **operational** backlog. [tasks.md](tasks.md) tracks *product*
work (FR-01…22). When a task here is finished, tick it here and note it there
only if it changed behaviour members can see.

Task IDs are stable — cite them in commits (`SEC-01: enforce token blacklist`).

---

## 1. Where the platform actually stands

| Area | State | One-line verdict |
|---|---|---|
| **Ledger integrity** | `[!]` | **Concurrent postings destroy money; defaulting an unguaranteed loan recovers nothing** — LEDGER-01/02. Proved against a real database 2026-08-17. Ahead of everything else on this page |
| **Git history** | `[!]` | **39 files of member records are recoverable from history** — see SEC-10. The only item on this page that is a disclosure rather than a risk |
| Product features | `[~]` | 14 of 22 FRs complete, 8 partial — see [tasks.md](tasks.md). FR-11 has a working endpoint and **no UI that calls it** |
| Domain correctness | `[~]` | BigInt taka, zero-interest, append-only audit all hold. Request→process→confirm holds for deposits; the balance arithmetic underneath it does not race-proof (LEDGER-01) |
| Authentication | `[x]` | HS256 JWT, bcrypt, first-login token, PG-backed login rate limit |
| Authorization | `[x]` | Per-handler `requireRoles` plus a router-level gate on the whole `/admin` group (SEC-02) |
| Session revocation | `[~]` | Go side is correct (SEC-01). **The Next handlers never check the blacklist** — SEC-11 |
| Documents / PDFs | `[x]` | Vector text, paginated, English-only (ADR-012, ADR-013) |
| Automated tests | `[~]` | 17 Go integration tests against real Postgres, Go unit tests on money maths/IDs/logging/revocation timing, 32 web unit tests (CI-04, done). All green. **But they are green over LEDGER-01 and LEDGER-02** — nothing tests concurrency, and every waterfall test seeds a guarantor, so the null-guarantor path was never executed. Playwright has one 28-line spec and skips without seeded credentials |
| CI/CD | `[x]` | GitHub Actions on PR and push: typecheck, lint, gofmt, vet, build, unit + integration tests, backup/restore drill, gitleaks. Branch protection is still a manual GitHub setting (CI-09) |
| Containerisation | `[x]` | Dockerfiles for both apps, full-stack compose, digest-pinned bases (PKG-01→05, 07). Both images are verified by **running** them. Images are not built in CI yet (PKG-06), and nothing in production uses them |
| Observability | `[x]` | Structured JSON access logs (RUN-04/05), Prometheus `/metrics` with HTTP, pool and business gauges, Sentry on both apps, threshold alerting via a scheduled workflow (OBS-01→06). Log aggregation and a dashboard remain open (OBS-05/07) |
| Backups | `[x]` | Nightly encrypted `pg_dump` in GitHub Actions, 30-day retention and 90-day monthlies, with a restore drill that runs on every push to main (DATA-01/02/03) |
| Runtime hardening | `[x]` | Bounded bodies, server timeouts, drained shutdown, real readiness probe, scheduled cleanups (RUN-01→06). RUN-07/08 open |
| Secrets management | `[~]` | Env vars per host, no rotation record, no central store |
| Infrastructure as code | `[ ]` | `vercel.json` only. Render config is click-ops |

`[x]` done · `[~]` partial · `[ ]` not started · `[!]` **defect in production now**

### Repo shape

| | |
|---|---|
| Go API | 38 files, 12.1k lines (incl. tests). The 4.9k-line `user_repository.go` was split by domain in WO-38; the largest file is now `dashboard_handler.go` at 2.1k, then `loan_repository.go` at 1.1k |
| Next web | 141 TS/TSX files, 26.7k lines |
| Go routes | 63 under `/v1` |
| Next route handlers | 13, of which **7 have no caller anywhere in the app** — see [WO-44](work-orders.md). Empty folders are gone |
| Prisma models | 21, 30 indexes |
| `.git` | 53 MB — **~112 MB of raw blobs** in history: 39 member-record files, three stray binaries and a 24 MB `react` blob (SEC-06, SEC-10) |

---

## Phase −1 — Ledger integrity defects

Found 2026-08-17. Each was **reproduced against a real Postgres 17**, not
inferred from reading. Every one of them silently produces a wrong balance, and
every one of them is cheap to fix now and unfixable later: once a wrong balance
is a member's savings figure, correcting it is a conversation, not a commit.

Execution specs: [WO-41 → WO-44](work-orders.md#batch-l--ledger-integrity).

### LEDGER-01 · Concurrent postings destroy money `[!]` — **critical**

`AddMemberDeposit` and `AddMemberWithdrawal`
([transaction_repository.go](../apps/api/internal/repositories/transaction_repository.go))
read the account balance **from the pool, outside the transaction and without a
lock**, compute a new absolute total in Go, and write that total back inside the
transaction. Two concurrent postings both read the old balance and the second
overwrites the first.

Measured, 20 concurrent deposits of ৳1,000 into an empty account:

```
balance      =  1,000     ← 19 deposits vanished
ledger sum   = 20,000     ← all 20 transaction rows written
```

The transaction rows are correct and the balance is not, so **the passbook and
the account disagree** — which is the one failure a cooperative cannot explain
to a member. Ten concurrent ৳5,000 withdrawals against a ৳10,000 balance *all
succeeded*: ৳50,000 paid out on ৳10,000 of savings.

The fix is not a lock ordering puzzle. `loan_repository.go` already does it
right — `SET "savingsBalance" = "savingsBalance" - $1` — and the waterfall has
been correct all along for exactly that reason.

Two callers are affected today (`POST /v1/dashboard/worker/members/{id}/deposit`
and `/withdrawal`), and `ApproveWithdrawal`'s DEPOSIT branch has a weaker form of
the same bug: it reads inside the transaction but without `FOR UPDATE`, so it is
safe against itself only because it locks the `transactions` row first.

### LEDGER-02 · Defaulting a loan with no guarantor recovers nothing `[!]` — **critical**

`ProcessWaterfallRecovery` scans `loans."guarantorId"` into a Go `string`.
The column is `String?` — nullable by design, because a loan below the guarantor
threshold has none. pgx cannot scan NULL into a string, so the whole waterfall
returns an error before step 1 runs.

`MarkLoanDefaulted` **commits the DEFAULTED status in its own transaction and
then calls the waterfall separately**, so the failure leaves the worst possible
state:

```
loan status      = DEFAULTED   ← committed
remainingAmount  = unchanged   ← nothing recovered
borrower savings = untouched   ← ৳8,000 sat there, ৳5,000 was owed
```

The admin sees an error and the loan is already defaulted. Retrying re-runs a
waterfall that will fail the same way. Every waterfall integration test seeds a
guarantor, which is why 17 green tests never touched this path.

The two-transaction split is the second half of the defect: recovery must happen
in the same transaction as the status change, or a default can be recorded that
was never settled.

### LEDGER-03 · Loan approval notification divides by 100 `[!]` — **high**

[loan_repository.go:123](../apps/api/internal/repositories/loan_repository.go) —
`float64(principalAmount)/100` in the member-facing "loan approved" message. A
৳50,000 loan is announced as **BDT 500.00**.

Money is whole taka ([ADR-002](decisions.md)); there is no paisa to divide by.
It is the last surviving ×100 from the pre-ADR-002 era and it is in the one
place a member reads a number and believes it. Every other notification on the
same path formats `float64(amount)` correctly, so this is a single-character
class of fix — and a reminder that the migration was never linted for.

### LEDGER-04 · Donations are numbered by wall clock, not by sequence `[~]` — **medium**

`RecordDonation` builds `DON-20260817143022` from `time.Now()`, bypassing
`document_sequences` entirely. That contradicts [ADR-013](decisions.md), which
exists because a receipt number is read aloud at a counter and copied into a
paper passbook. Two donations recorded in the same second collide, and
`DON-` is not one of the four declared series.

`RecordDonation` also writes **no `audit_logs` row**, which makes it the only
balance-changing method in the Go API that does not — a direct CLAUDE.md rule-2
violation that the audit-coverage integration test misses because it does not
cover donations.

---

## Phase 0 — Security defects (do these first)

These are live. Everything else on this page can wait behind them.

### SEC-11 · The Next.js surface ignores token revocation `[!]` — **high**

Found 2026-08-17. The Go API checks `token_blacklist` on every request. The
Next route handlers do not: `lib/auth.ts` (`requireAuth`) and `lib/server-auth.ts`
(`authenticateRequest`) verify the HS256 signature and `exp`, and stop there.

So after **logout**, after a **password change**, and after an **admin revokes a
user**, the old token still works against every Next handler — `PUT /api/v1/settings`,
the gallery CMS, worker CRUD, registration listing, dispute. Revocation is
advertised in [architecture.md](architecture.md) and in the README, and it is
half-true: it binds on the Go side only.

`server-auth.ts` has a `fetchUserFromApi` fallback that *would* be
blacklist-checked, but it only runs when `JWT_SECRET` is unset or verification
throws — i.e. never in a correctly configured deployment.

Blast radius is bounded by what those handlers do (no balance mutation after the
WO-42 cleanup) but it includes changing loan policy, which is not a small thing
to leave reachable with a revoked token.

### SEC-12 · `GET /api/v1/settings` is unauthenticated `[~]` — **low**

The whole `system_config` table is returned to anyone who asks. It has to be
partly public — the marketing pages and login screen read branding from it — but
it currently ships loan policy, org contact details and support retention
settings to unauthenticated callers in the same payload. Split it into a public
subset and an admin-only remainder rather than gating the whole route, which
would break the public site.

### SEC-01 · Token revocation does not work `[x]` — **critical**

`AuthService.ValidateToken` ([auth_service.go:196](../apps/api/internal/services/auth_service.go#L196))
is the only function that consults `token_blacklist`, and it has **zero
callers**. Every dashboard route authenticates through `authFromRequest`
([dashboard_handler.go:464](../apps/api/internal/handlers/dashboard_handler.go#L464))
→ `ParseAccessToken`, which validates the signature and expiry and nothing else.

Consequences: logging out does not end the session; changing a password does not
evict other sessions; a leaked token stays valid for the full
`JWT_EXPIRY_SECONDS` (24 h by default). The `token_blacklist` table, the
`BlacklistToken` calls on logout, and `BlacklistAllUserTokens` on password change
are all writing rows nobody reads.

**Done.** `authFromRequest` now calls `ValidateToken(r.Context(), …)`, and both
revocation checks in `ValidateToken` fail closed — a database error rejects the
request instead of reading as "not revoked". `auth_handler.go` keeps
`ParseAccessToken` on the logout path, where checking the blacklist for the token
being blacklisted would be circular.

Two things found while wiring it. `BlacklistAllUserTokens` inserted its
`all:<userID>` marker with no `ON CONFLICT`, so a *second* password change inside
24 h hit the unique index on `tokenHash` and silently failed to revoke; it now
upserts the marker forward. And the redundant `userIDFromRequest` +
`requireRoles` double-authentication in `AdminLoans`/`AdminLoanDetail` was
collapsed to one call, since each authentication is now a DB round-trip.

**Still open:** one extra DB round-trip per authenticated request. Acceptable at
this scale. If it shows up in latency, cache the `all:<userID>` marker lookup —
not the per-token one.

### SEC-02 · Four admin endpoints do not check role `[x]` — **critical**

They call `userIDFromRequest`, which proves *someone is logged in* and stops
there. Any member's token opens them.

| Route | Handler | Exposure |
|---|---|---|
| `POST /v1/dashboard/admin/loans/default` | [MarkLoanDefaulted:950](../apps/api/internal/handlers/dashboard_handler.go#L950) | **Any member can default any loan**, triggering guarantor recovery — unauthorised money movement |
| `GET /v1/dashboard/admin/reports/monthly` | [MonthlyReport:1025](../apps/api/internal/handlers/dashboard_handler.go#L1025) | Foundation-wide financials |
| `GET /v1/dashboard/admin/reports/yearly` | [YearlyReport:1055](../apps/api/internal/handlers/dashboard_handler.go#L1055) | Foundation-wide financials |
| `GET /v1/dashboard/admin/reports/loans` | [LoanPerformanceReport:1078](../apps/api/internal/handlers/dashboard_handler.go#L1078) | Every member's loan performance |

`MarkLoanDefaulted` is the severe one: it writes. The neighbouring `AdminLoans`
and `AdminLoanDetail` show the correct shape — `requireRoles(w, r, "ADMIN",
"SUPER_ADMIN")`.

**Done.** All four call `requireRoles(w, r, "ADMIN", "SUPER_ADMIN")`, and the
trap is closed: `/v1/dashboard/admin` is now a `chi.Route` group whose routes sit
behind `dashboardHandler.RequireRoles(…)`, so a handler added there is protected
by where it is mounted. The per-handler checks stay as defence in depth.

One exception is deliberate and marked in `main.go`: `/admin/donations` is
recorded by field workers too, so it sits in a second group gated
ADMIN/SUPER_ADMIN/WORKER rather than in the admin-only one. It keeps the
`/admin` path only for URL compatibility.

### SEC-03 · Gallery writes are unauthenticated and world-CORS `[x]` — **high**

[gallery/route.ts](../apps/web/app/api/v1/gallery/route.ts) exports `POST`,
`PUT` and `DELETE` with no auth check at all, under
`Access-Control-Allow-Origin: '*'`. Anyone on the internet can add, rewrite or
delete the foundation's public gallery — a defacement and phishing-image vector
on a charity's front page.

**Done.** `POST`, `PUT` and `DELETE` go through a `requireAdmin` helper
(`authenticateRequest` + ADMIN/SUPER_ADMIN); `GET` stays public. The wildcard is
gone — see SEC-04 for the shared helper that replaced it. The admin gallery UI
was already writing through server actions, not these routes, so nothing in the
app broke.

### SEC-04 · Wildcard CORS on `/api/v1/settings` `[x]` — **medium**

`PUT` was authenticated, so this was defence-in-depth rather than an open door.

**Done.** [lib/cors.ts](../apps/web/lib/cors.ts) is now the one CORS helper for
Next route handlers, used by both `/api/v1/gallery` and `/api/v1/settings`. It
reads the same `CORS_ORIGINS` list the Go API reads (falling back to
`NEXT_PUBLIC_APP_URL`, then localhost), echoes the request's `Origin` only when
it is on the list, and sends `Vary: Origin`. An unrecognised origin now gets no
`Access-Control-Allow-Origin` header at all.

### SEC-05 · Bearer token accepted in the query string `[x]` — **medium**

[dashboard_handler.go:467](../apps/api/internal/handlers/dashboard_handler.go#L467)
falls back to `?access_token=` because `EventSource` cannot set headers. Query
strings land in proxy logs, CDN logs, browser history and `Referer` headers.

**Done.** The `?access_token=` fallback is deleted from `authFromRequest`, which
now reads the Authorization header and nothing else. `GET /v1/dashboard/support/stream`
authenticates through `streamAuthFromRequest`: Authorization header when the
caller can set one (the Next proxy can), otherwise a `?ticket=` value issued by
`POST /v1/dashboard/support/stream/ticket`. A ticket is 32 random bytes, stored
SHA-256-hashed in `sse_tickets`, valid 60 s, and scoped to one purpose — a
captured ticket cannot be replayed against any other endpoint. Clients fetch a
fresh ticket immediately before each connect, including reconnects.

### SEC-06 · A 17 MB compiled binary is committed `[x]` — **medium**

`apps/api/server` was tracked (added in `beabc14`, updated in `5db86b7`) and not
covered by `.gitignore` — the Go section only ignored `bin/`.

**Done.** Untracked and deleted; `apps/api/server` and `apps/api/app` added to
`.gitignore`. The `.env.example` line was also removed from `.gitignore`, which
had been ignoring a file that is deliberately committed.

**Still open, and understated when this was written.** The blobs remain in
history. A full `git rev-list` sweep on 2026-08-16 found three binaries, not one:
`apps/api/server` (17.5 MB and 16.4 MB), `apps/api/seed` (13.6 MB, never recorded
anywhere), and a stray 24.6 MB `react` blob from commit `3ef0a91`. Purging is
[WO-28](work-orders.md) —
merged with SEC-10 below, because the same rewrite has to remove both and nobody
should do this twice.

### SEC-07 · No request body size limit `[x]` — **medium**

`utils.MaxRequestBodySize` was defined and **never referenced**.

**Done.** `ParseJSON` wraps `r.Body` in `io.LimitReader(r.Body, MaxRequestBodySize)`,
which covers all 27 call sites without touching the signature. An oversized body
now fails as a decode error, which every call site already surfaces as
400 `INVALID_REQUEST`. `http.MaxBytesReader` would have been the tidier wrapper
but needs the `ResponseWriter`, which `ParseJSON` does not take.

### SEC-08 · Unauthenticated registration enumeration `[x]` — **low**

`GET /api/v1/registrations?email=…` answers whether an address or phone is
registered. It exists for the signup form's live validation, so it cannot simply
be closed — but it is unauthenticated and unthrottled, which makes it a bulk
membership-disclosure oracle for a religious-finance cooperative.

**Done 2026-08-16.** 20 checks per 10 minutes per caller address, through the
existing `rate_limits` table (`apps/web/lib/rate-limit.ts`). Generous for someone
filling in the form once, useless for walking a number range: Bangladeshi mobile
numbers are an 8-digit space behind a known prefix, which at this rate takes
centuries rather than an afternoon. Verified — request 21 returns 429 with
`Retry-After: 599`, and a different address is unaffected.

The counter is in the database rather than in memory **because this runs on
Vercel**: a route handler is a serverless function whose instances the platform
creates and discards, so an in-memory counter resets at intervals the caller can
provoke. That is the opposite of the Go API's limiter (RUN-07), and the reason is
written at the top of both files.

The single upsert is deliberate — read-then-write would let two concurrent
requests both observe `attempts = limit` and both proceed, which is exactly the
case a limiter exists to stop and only appears under the load that matters. It
fails **open** on a database error: a blip must not stop people registering.

**Not done, and deliberately:** the response timing is not equalised. Both
branches are one indexed lookup and the difference is not a practical oracle at
20 requests per 10 minutes; padding every response to a fixed duration would add
latency for every real user to close a channel the rate limit already closes.

### SEC-10 · Member records are recoverable from git history `[!]` — **highest**

Found on 2026-08-16 by enumerating every blob in every ref. **39 files** were
added under `Official Infos/` in commit `f152f0c` ("docs: initial project
documentation") and deleted in `9306120`. Deleting a file in a later commit
removes it from the working tree and from nothing else.

The filenames describe the foundation's actual records:

```
Official Infos/Hasnahena Member Details.docx
Official Infos/Hasnahena/Hasnahena Member Details 01.pdf     4-page scan
Official Infos/Hasnahena/Loan Member Detail.docx
Official Infos/Hasnahena/Hasnahena ledger sanchoy book 2.docx   savings ledger
Official Infos/Hasnahena/Hasnahena ledger korjo book3.docx      loan ledger
Official Infos/Hasnahena/Hasnahena ledger ay bay book1.docx     income/expense
Official Infos/Hasnahena/Check Book.docx · Check Book2.docx
Official Infos/Hasnahena/Hasnahena Sodossho Form.docx · Aajibon Form.docx
```

Anyone with read access to the repository can recover all of them in one command.
This is the difference between every other item on this page and this one: the
rest are risks, this is a disclosure that has already occurred and is ongoing for
as long as the objects exist.

**The PDF is an image-only scan**, so no script can determine whether it contains
live member records — that requires a person to open it. Treat it as PII until
someone has.

Three questions decide how serious this is, and only the repository owner can
answer them: **is the repository private?** (if it has ever been public, treat
this as a breach); **who has had read access**, including any org, collaborator,
CI integration or fork; and **do the files hold real members or a template?**

**Fix:** [WO-28](work-orders.md)
— `git filter-repo --invert-paths` over `Official Infos/` and the three binaries
from SEC-06, force-push, then ask GitHub Support to garbage-collect unreachable
objects. Until they do, the blobs stay fetchable by SHA even after the rewrite.
Add `Official Infos/` to `.gitignore` so a re-add is not one `git add -A` away.

**Note this is not what gitleaks scans for.** The `secrets` CI job passes on this
repository and always has: it looks for credential *patterns*, not for documents
that should never have been committed. A green secret scan is not evidence that
history is clean, and this is the example.

### SEC-09 · HSTS is commented out in the API `[x]` — **low**

[cors.go](../apps/api/internal/middleware/cors.go) sets a good header set but
leaves `Strict-Transport-Security` disabled. Next sends it; the API does not.

**Done 2026-08-16.** Behind `ENABLE_HSTS`, **off by default**. That default is
the point: a browser remembers HSTS for the whole `max-age`, so sending it from a
plain-HTTP localhost API pins `localhost` to HTTPS for two years — in every
project on that developer's machine, with no obvious way to undo it. Verified
both ways: header present with the flag on, absent with it unset.

`preload` is included, which is close to irreversible once the domain is
submitted to the browser preload list. It is honest here because
`api.hasnahenafoundation.com` is permanently HTTPS behind Render.

**Action:** set `ENABLE_HSTS=true` in Render. It is in `.env.render.example`.

---

## Phase 1 — A safety net before touching anything else

You cannot refactor a money system with zero tests. This phase is what makes
every later phase safe.

| ID | Task | Notes |
|---|---|---|
| CI-01 `[x]` | Make one test command exist | **Done.** `pnpm test:go` (Go unit tests, no DB) and `pnpm test:e2e` (Playwright, wired up with config + script). `pnpm typecheck` now exits clean with zero errors, so it is finally a usable signal |
| CI-02 `[x]` | Go unit tests on money maths | **Done.** The arithmetic was inline in `user_repository.go` and duplicated, so it was extracted to `internal/money` and the repository rewired to call it. Table-driven tests plus a property test that every installment schedule repays the principal exactly. This caught a live rounding defect — see the note under "Where the platform actually stands" |
| CI-03 `[x]` | Go integration tests against a real Postgres | `docker-compose` already provides one. Cover the five priority scenarios in tasks.md — dispute→correct, loan caps, default waterfall, withdrawal blocking, audit immutability |
| CI-04 `[x]` | Web unit tests | **Done 2026-08-16.** Vitest, 32 tests in ~1s, in CI as `pnpm test:unit`. Money formatting, amount-in-words, member-id round-trips, the registration validators — the functions that are cheap to test exhaustively and expensive to get wrong on a document a member is handed |
| CI-05 `[x]` | GitHub Actions: PR pipeline | `pnpm typecheck`, `pnpm lint`, `go vet ./...`, `go build ./...`, both test suites. Required check on `main` |
| CI-06 `[x]` | Add `go vet` + `golangci-lint` | **Done 2026-08-16.** Both in CI. `unused` — the linter that names the SEC-01/SEC-07 class, symbols written and never called — is enabled and clean. `errcheck` and `staticcheck` are configured but staged behind [WO-40](work-orders.md): they report 44 findings, and a pipeline red on arrival gets switched off |
| CI-07 `[x]` | Dependabot / Renovate | Weekly, grouped, for npm + Go modules |
| CI-08 `[x]` | Secret scanning | `gitleaks` in CI. Given SEC-06, also scan history once |
| CI-09 `[ ]` | Branch protection on `main` | No direct pushes, CI green to merge. **Needs a paid plan on a private repo** — `.githooks/pre-push` is the free stand-in and is active (`core.hooksPath=.githooks`), but it skips the Go checks because Go is not installed locally |

**Exit bar:** a PR cannot merge if the financial-flow tests fail.

---

## Phase 2 — Runtime hardening

Free-tier hosts hide these. A VPS will not.

| ID | Task | Why |
|---|---|---|
| RUN-01 `[x]` | Replace `http.ListenAndServe` with a configured `http.Server` | **Done.** All four timeouts set from `SERVER_*` env vars (10s/30s/60s/120s). The SSE stream clears its own write deadline via `http.ResponseController`, which is why the access-log wrapper implements `Unwrap` |
| RUN-02 `[x]` | Graceful shutdown | **Done.** `signal.NotifyContext` → `srv.Shutdown` with a 30 s drain, then the pool closes. SSE streams are ended first (`DashboardHandler.BeginShutdown`) so they do not consume a drain window meant for money movement. **The host's stop grace period must exceed `SERVER_SHUTDOWN_TIMEOUT`** or the platform `SIGKILL`s mid-drain — noted in deployment.md |
| RUN-03 `[x]` | Real health checks | **Done.** `/v1/health` stays cheap and keeps `emailConfigured` for the release checklist; `/v1/ready` pings the pool with a 2 s budget and returns 503 `DB_UNAVAILABLE` on failure |
| RUN-04 `[x]` | Structured JSON logging | **Done.** `log/slog` JSON to stdout, level from `LOG_LEVEL`. One `http_request` line per request with request ID, method, path, status, bytes, duration, IP and — via a context holder filled in `verifyActiveRole` — the user ID. `slog.SetDefault` also routes the standard `log` package through the same handler, so a stray `log.Printf` in a dependency still emits JSON |
| RUN-05 `[x]` | Scrub PII from logs | **Done.** All three sites now log the user ID. The staff-welcome path has no user yet, so it logs only the role and leans on the request ID to tie the line back to the caller. The access log records `r.URL.Path` and never `RawQuery`, which would otherwise carry thread IDs and stream tickets |
| RUN-06 `[x]` | Schedule the cleanup jobs | **Done.** `startCleanupLoop` in `main.go`: sweeps at boot and then every `CLEANUP_INTERVAL` (default 1h), each sweep bounded at 1 minute, tied to the shutdown context, logging rows deleted only when there are any. `sse_tickets` needs no entry here — it sweeps itself on the issue path |
| RUN-07 `[x]` | Global rate limiting | **Done 2026-08-16.** Per-client throttle on mutating methods, `RATE_LIMIT_REQUESTS`/`RATE_LIMIT_WINDOW` (60/1m). Reads, `/v1/health`, `/v1/ready` and `/metrics` are exempt so a probe cannot be throttled into looking like an outage. In memory, not in `rate_limits`: it counts *every* request, so a table would mean an UPDATE on the same hot path the money transactions already contend on. **Tradeoff stated:** with N instances the effective limit is N×; Render runs one. **The load-bearing part is `clientIP`** — chi's `RealIP` is deprecated and spoofable, so keying on `RemoteAddr` would let a caller mint a fresh quota per request by varying a header. Set `TRUSTED_PROXIES=1` on Render or this is decorative |
| ~~RUN-08~~ | ~~Panic reporting~~ | **Done** (WO-18) — `observability.Recoverer` sits inside chi's Recoverer and reports the panic before re-raising. |
| ~~RUN-09~~ | ~~Split `user_repository.go`~~ | **Done 2026-08-16** (WO-38). 4,894 lines → nine files by domain, largest 1.1k. Verified as a **pure move**: all 91 declarations extracted from both versions and compared brace-to-brace, byte-identical, same SHA-256. Plus build, vet, golangci-lint, unit tests and the 17 integration tests against a real Postgres |
| RUN-10 | ~~Delete the empty API folders~~ `[x]` | Done — 27 empty directories removed (they were untracked, so local-only clutter) |

---

## Phase 3 — Observability

The question this phase answers: *a member says their deposit vanished — can you
prove what happened without a database console?*

| ID | Task | Free-tier option |
|---|---|---|
| ~~OBS-01~~ | ~~Metrics endpoint~~ | **Done** (WO-17), token-gated. |
| ~~OBS-02~~ | ~~Business metrics~~ | **Done** (WO-17). |
| ~~OBS-03~~ | ~~Error tracking~~ | **Done** (WO-18), Sentry both apps, PII stripped. |
| ~~OBS-04~~ | ~~Uptime monitoring~~ | **Done** (WO-18) — needs the UptimeRobot account created. |
| OBS-05 | Log aggregation | Grafana Cloud or Better Stack free tier. Required once there is more than one process |
| ~~OBS-06~~ | ~~Alerting~~ | **Done** (WO-19), split across UptimeRobot/Sentry/Actions on cost grounds. |
| OBS-07 | Dashboard | One screen: uptime, error rate, p95 latency, money posted today, queue depths |
| OBS-08 | Audit log viewer UI | FR-22 gap. The data is complete; nobody can read it without SQL |

---

## Phase 4 — Data safety

The one irreplaceable asset is the ledger. Everything else can be rebuilt from
source.

| ID | Task | Notes |
|---|---|---|
| ~~DATA-01~~ | ~~Automated `pg_dump` to off-provider storage~~ | **Done** (WO-14). Nightly + monthly encrypted dump in `.github/workflows/backup.yml`, retained 30/90 days as GitHub artifacts. Set `BACKUP_S3_BUCKET` to also copy to S3/B2/R2 — worth doing once there is real member data, since GitHub is then the single point of failure |
| ~~DATA-02~~ | ~~Restore drill~~ | **Done** (WO-15). `scripts/restore-check.sh` restores and asserts the money invariants; CI runs the full drill on every push, so it is continuous rather than quarterly |
| ~~DATA-03~~ | ~~Define RPO/RTO in writing~~ | **Done** (WO-15). RPO 24 h, RTO under 1 h, with the reasoning in [deployment.md](deployment.md#rpo-and-rto). The 24 h is only acceptable because the paper passbook can reconstruct a lost posting |
| ~~DATA-04~~ | ~~Adopt Prisma migrations~~ | **Done** (WO-16). [ADR-014](decisions.md) supersedes ADR-004; schema baselined as `0_init`; CI applies migrations |
| ~~DATA-05~~ | ~~Seed script~~ | **Done** (WO-16). `pnpm db:seed` — idempotent, refuses to invent a password |
| DATA-06 | Backup the Cloudinary assets | NID and member photos are regulatory documents living in one third-party account with no export. **Now the largest remaining data gap** — the nightly dump covers the database and nothing else |
| DATA-07 | Data retention + erasure policy | NID images and PII need a stated retention period and a deletion path — the audit log is append-only by design, so decide now what a member's erasure request means |
| DATA-08 `[x]` | Verify audit-log immutability at the DB level | **Done 2026-08-16**, before real data exists — a guarantee in place since the first row is provable; one added later covers only the rows after it. `BEFORE UPDATE OR DELETE` trigger: **UPDATE is never permitted**; DELETE only inside a transaction that sets `hasnahena.allow_audit_purge`, which exists for `pnpm db:clear` alone — without that hatch the trigger would break the go-live cutover it protects. TRUNCATE is untouched, which is what keeps the Go suite working. Verified across 7 cases including that the flag does not leak between transactions, that it does **not** unlock UPDATE, and that **the trigger survives a dump/restore round trip**. Prisma cannot model triggers, so a `--from-empty` baseline would drop it; `schema.prisma` says so above `model AuditLog` |

---

## Phase 5 — Portability (the bridge to a VPS)

Nothing here changes behaviour. It ends the lock-in, and it is the prerequisite
for Phase 6. Do it *before* you need to move, so the move is not also a rewrite.

| ID | Task | Notes |
|---|---|---|
| PKG-01 `[x]` | Dockerfile for the Go API | Done and **verified by running it**. Multi-stage, `CGO_ENABLED=0`, `distroless/static-debian12:nonroot`. **26.9 MB on disk / 6.0 MB compressed** — measured, not the ~17 MB originally estimated here |
| PKG-02 `[x]` | Dockerfile for the Next app | Done. Standalone output gated behind `DOCKER_BUILD=1` so the Vercel build is unchanged. Stayed on a glibc base — Prisma's traced engine is `debian-openssl-3.0.x`, and Alpine would need a `binaryTargets` change |
| PKG-03 `[x]` | Extend `docker-compose.yml` to the whole stack | Done. Postgres → one-shot migrate/seed → api → web. `docker compose up -d postgres` still works on its own |
| PKG-04 `[x]` | `.dockerignore` for both | Done, and it matters more than it looks: Next's tracer was observed copying `.env.local` into `.next/standalone/`, which would bake production credentials into an image layer |
| PKG-05 `[x]` | Pin versions everywhere | Done. Go 1.25, Node 24, pnpm 8.15.4, all four base images by digest |
| PKG-06 `[x]` | Build and push images in CI | **Done 2026-08-16.** `.github/workflows/images.yml` → GHCR, tagged by commit SHA and `latest`, on every push to `main` that touches code. Each job **runs the image it pushed** rather than trusting a green build — the three Batch F defects were all invisible until a container started — and asserts no `.env` file is inside. Both checks verified against a negative control. Nothing in production consumes them yet; they exist so the history is there for INF-06 |
| PKG-07 `[x]` | Health checks in the images | Done. The Go image has no shell, so the server probes itself: `/server -healthcheck` → `/v1/ready`. The web image uses `node -e` with `fetch` |
| PKG-08 `[x]` | Document the full env-var contract | **Done 2026-08-16.** [setup.md](setup.md) now carries a per-variable ownership table and a build-time/runtime split. The part with no error message: `NEXT_PUBLIC_*` is baked at `next build` — including for server-side route handlers — so changing one needs a **redeploy**, not a restart, and in Docker it is a `--build-arg` that `-e` cannot override |

---

## Phase 6 — VPS or AWS

Only start once Phases 0–5 are done. Moving an unmonitored, untested,
unbackupable system onto infrastructure you now also have to patch makes things
worse, not better.

### Recommended target

For a foundation of this size, **a single VPS** (Hetzner/DigitalOcean, 4 GB) is
the right answer, not AWS. One machine, Docker Compose, Caddy for TLS, managed
Postgres or a well-backed-up local one. Roughly $10–25/month, one thing to
understand, no surprise bills. Full AWS (ECS/RDS/ALB) is 5–10× the cost and
complexity for a workload this size — take it only if a funder or regulator
requires it.

| ID | Task | Notes |
|---|---|---|
| INF-01 | Choose the target and write it down as an ADR | Decide VPS vs AWS *with numbers* — cost, who administers it, what happens when that person is unavailable |
| INF-02 | Provision as code | Terraform, or a documented shell script. "I clicked around and it works" is not a recoverable state |
| INF-03 | Base-image hardening | SSH keys only, no root login, `ufw` default-deny, `fail2ban`, unattended security upgrades |
| INF-04 | Reverse proxy + TLS | Caddy (automatic Let's Encrypt) or nginx + certbot. Terminate TLS, forward to both containers, set HSTS (SEC-09) |
| INF-05 | Decide the database's home | Staying on Neon is a legitimate choice and keeps DATA-01 simpler. Self-hosting means you now own backups, tuning, upgrades and failover |
| INF-06 | Deployment pipeline | CI builds (PKG-06) → push → pull and restart on the host. Rollback = redeploy the previous SHA |
| INF-07 | Zero-downtime deploys | Two containers behind the proxy, health-gated cutover. Depends on RUN-02 and RUN-03 |
| INF-08 | Log shipping off the box | A dead disk must not take the audit trail with it |
| INF-09 | Secrets management | Docker secrets or SOPS-encrypted files. Not a `.env` on the host with world-read permissions |
| INF-10 | Staging environment | A second compose stack on the same box, separate database. First real use of DATA-04 and DATA-05 |
| INF-11 | Cutover runbook | Freeze window, final dump, DNS TTL lowered in advance, restore, verify, switch, **rollback plan**. Rehearse against staging |
| INF-12 | Cost + capacity review | Set a monthly budget alarm before, not after, the first bill |

### Cutover order

DNS TTL down to 300 s a day ahead → announce a maintenance window → stand up the
new stack and restore a dump → run the release checklist in
[deployment.md](deployment.md) against the new stack on a temporary hostname →
freeze writes → final dump and restore → switch DNS → watch for an hour → keep
the old stack warm for 48 h.

---

## Phase 7 — Steady-state operations

What makes it *stay* production-ready after you stop looking at it daily.

| ID | Task | Cadence |
|---|---|---|
| OPS-01 | Incident runbooks | Write once: API down, database unreachable, disputed transaction, suspected credential leak, bad deploy |
| OPS-02 | Secret rotation | Every 6 months, and immediately after any exposure. `JWT_SECRET` must change in Vercel and Render **together** or every session breaks |
| OPS-03 | Dependency updates | Monthly, on a branch, with CI green |
| OPS-04 | Restore drill | Quarterly (DATA-02) |
| OPS-05 | Access review | Quarterly: who holds admin, Neon, Vercel, Render, Cloudinary and DNS credentials |
| OPS-06 | Bus-factor documentation | One person can currently deploy this. Write down what a successor needs — accounts, secrets locations, the runbooks |
| OPS-07 | Financial reconciliation job | Automated: sum of transactions must equal account balances. Alert on drift. The strongest guard a ledger can have |
| OPS-08 | 48-hour unconfirmed-transaction sweep | Product gap in tasks.md; it needs the scheduler this phase provides |
| OPS-09 | Uptime/incident log | A dated file. Turns "it feels slow lately" into evidence |

---

## Ordered backlog

Do them in this order. Each block is genuinely blocked by the one above it.

**Superseded for sequencing purposes by [go-live.md](go-live.md).** The platform
is deployed and holding fake data, so the useful ordering is *what gets more
expensive once real member data exists*, not *what is most urgent*. This table
remains the backlog; that file is the order to do it in.

Rewritten 2026-08-16 after re-verifying every claim against the source. Blocks
that were entirely done have been removed rather than left struck through — the
[work-orders.md](work-orders.md) completion table is the record.

| # | Block | Tasks | Order | Rough effort |
|---|---|---|---|---|
| 1 | **Purge git history** | SEC-10 + SEC-06 | WO-28 | ½ day + GitHub Support |
| ~~2~~ | ~~**Live product defect**~~ | ~~FR-11 guarantor approval~~ | WO-29 | **Done 2026-08-16** |
| ~~3~~ | ~~**Land Batch G**~~ | ~~Merge `wo-23-next15-react19`~~ | — | **Done — PR #13** |
| 4 | **Settle the data model** | Legacy `LoanStatus`, FR-15/16, FR-08 (DATA-08 done) | [go-live.md](go-live.md) 1.2 | 2–3 days, **and only cheap before launch** |
| ~~5~~ | ~~**Security remainder**~~ | ~~SEC-08, SEC-09~~ | WO-30, WO-31 | **Done 2026-08-16** |
| ~~6~~ | ~~**Hardening remainder**~~ | ~~RUN-07, DATA-08~~ | WO-32, WO-33 | **Done 2026-08-16** |
| 7 | **Deployable artifacts** | PKG-06, PKG-08 | WO-34, WO-35 | 1 day |
| 8 | **Code health** | CI-04, CI-06, RUN-09, settings allow-list | WO-36 → WO-39 | 1 week |
| 9 | **Remaining data + ops** | DATA-06, DATA-07, OBS-05/07/08, OPS-01 → OPS-09 | — | 1 week |
| 10 | **Move hosts** | INF-01 → INF-12 | — | 1–2 weeks |

**Blocks 1 and 2 are not like the rest of this list.** Block 1 is a disclosure
that has already happened and continues for as long as the objects exist. Block 2
is a lending feature members are told exists and that has never once worked. Both
are small. Everything below block 3 is ordinary backlog by comparison.

The blocks that used to head this list — backups, tests, CI, observability,
containers — are done, and they are what turned "it works" into "it works, and if
it breaks the members' money is still there."

---

## Dead code that must not be deleted

A linter or a cleanup pass will flag these as unused. They are unused **because a
wiring step was never finished**, and each one is the remedy for a defect on this
page. Deleting them deletes the fix. Each is marked with a comment in the source.

**This list is now empty.** Every symbol that was on it has been wired up:
`AuthService.ValidateToken` and `utils.MaxRequestBodySize` by SEC-01 and SEC-07,
`SecurityService.CleanupExpiredTokens` and `CleanupExpiredRateLimits` by RUN-06.
The section stays as a place to record the next one.

---

## Deliberately not doing

Recording these so they are not re-proposed as gaps.

| Not doing | Why |
|---|---|
| Kubernetes | A cooperative in Jessore does not need an orchestrator. One VPS with Compose is operable by one person |
| Microservices | Two services is already the right number |
| Redis | Postgres handles the rate limits and blacklist at this scale (and that choice is what makes the single-VPS target realistic) |
| Multi-region | No latency or availability requirement that justifies it |
| Blue/green with separate infrastructure | INF-07's health-gated container swap is sufficient |
