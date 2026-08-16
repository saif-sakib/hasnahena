# Production Readiness Map

Everything between today's free-tier deployment and a platform that can be run
on a VPS or AWS by someone who is not the author. Audited against the code on
**2026-08-15**.

This file is the **operational** backlog. [tasks.md](tasks.md) tracks *product*
work (FR-01…22). When a task here is finished, tick it here and note it there
only if it changed behaviour members can see.

Task IDs are stable — cite them in commits (`SEC-01: enforce token blacklist`).

---

## 1. Where the platform actually stands

| Area | State | One-line verdict |
|---|---|---|
| Product features | `[~]` | 13 of 22 FRs complete, 7 partial — see [tasks.md](tasks.md) |
| Domain correctness | `[x]` | BigInt taka, zero-interest, request→process→confirm, append-only audit |
| Authentication | `[x]` | HS256 JWT, bcrypt, first-login token, PG-backed login rate limit |
| Authorization | `[x]` | Per-handler `requireRoles` plus a router-level gate on the whole `/admin` group (SEC-02) |
| Session revocation | `[x]` | `authFromRequest` → `ValidateToken`; logout and password-change now bite (SEC-01) |
| Documents / PDFs | `[x]` | Vector text, paginated, English-only (ADR-012, ADR-013) |
| Automated tests | `[x]` | Unit tests on money maths, IDs, logging and revocation timing; 17 integration tests against real Postgres covering all five financial-integrity scenarios; Playwright wired up |
| CI/CD | `[x]` | GitHub Actions on PR and push: typecheck, lint, gofmt, vet, build, unit + integration tests, gitleaks. Branch protection is still a manual GitHub setting |
| Containerisation | `[ ]` | No Dockerfile. Cannot run anywhere but Vercel + Render |
| Observability | `[~]` | Structured JSON access logs with request + user IDs (RUN-04/05). Still no metrics, traces, error tracking or alerts |
| Backups | `[ ]` | Documented as an intention; nothing scheduled, never restore-tested |
| Runtime hardening | `[x]` | Bounded bodies, server timeouts, drained shutdown, real readiness probe, scheduled cleanups (RUN-01→06). RUN-07/08 open |
| Secrets management | `[~]` | Env vars per host, no rotation record, no central store |
| Infrastructure as code | `[ ]` | `vercel.json` only. Render config is click-ops |

`[x]` done · `[~]` partial · `[ ]` not started · `[!]` **defect in production now**

### Repo shape

| | |
|---|---|
| Go API | 15 files, 8.8k lines — `user_repository.go` alone is 4.9k (55%) |
| Next web | 189 TS/TSX files, 34.7k lines |
| Go routes | 63 under `/v1` |
| Next route handlers | 15 (plus 16 empty folders) |
| Prisma models | 21, 30 indexes |
| `.git` | 59 MB — 17 MB of that is one committed binary (SEC-06) |

---

## Phase 0 — Security defects (do these first)

These are live. Everything else on this page can wait behind them.

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

**Still open:** the blob remains in history, so `.git` is still ~59 MB and every
clone pays for it. Purging with `git filter-repo` shrinks clones by ~70% but
rewrites every commit — worth doing while the repo is solo and only
`origin/main` exists. The cost only rises.

### SEC-07 · No request body size limit `[x]` — **medium**

`utils.MaxRequestBodySize` was defined and **never referenced**.

**Done.** `ParseJSON` wraps `r.Body` in `io.LimitReader(r.Body, MaxRequestBodySize)`,
which covers all 27 call sites without touching the signature. An oversized body
now fails as a decode error, which every call site already surfaces as
400 `INVALID_REQUEST`. `http.MaxBytesReader` would have been the tidier wrapper
but needs the `ResponseWriter`, which `ParseJSON` does not take.

### SEC-08 · Unauthenticated registration enumeration `[ ]` — **low**

`GET /api/v1/registrations?email=…` answers whether an address or phone is
registered. It exists for the signup form's live validation, so it cannot simply
be closed — but it is unauthenticated and unthrottled, which makes it a bulk
membership-disclosure oracle for a religious-finance cooperative.

**Fix.** Rate-limit per IP through the existing `rate_limits` table, and return
a uniform response shape so timing does not distinguish the cases.

### SEC-09 · HSTS is commented out in the API `[ ]` — **low**

[cors.go](../apps/api/internal/middleware/cors.go) sets a good header set but
leaves `Strict-Transport-Security` disabled. Next sends it; the API does not.

**Fix.** Enable it behind an `ENABLE_HSTS` env flag (off locally, on in
production). Required before any VPS move, where you own TLS termination.

---

## Phase 1 — A safety net before touching anything else

You cannot refactor a money system with zero tests. This phase is what makes
every later phase safe.

| ID | Task | Notes |
|---|---|---|
| CI-01 `[x]` | Make one test command exist | **Done.** `pnpm test:go` (Go unit tests, no DB) and `pnpm test:e2e` (Playwright, wired up with config + script). `pnpm typecheck` now exits clean with zero errors, so it is finally a usable signal |
| CI-02 `[x]` | Go unit tests on money maths | **Done.** The arithmetic was inline in `user_repository.go` and duplicated, so it was extracted to `internal/money` and the repository rewired to call it. Table-driven tests plus a property test that every installment schedule repays the principal exactly. This caught a live rounding defect — see the note under "Where the platform actually stands" |
| CI-03 `[x]` | Go integration tests against a real Postgres | `docker-compose` already provides one. Cover the five priority scenarios in tasks.md — dispute→correct, loan caps, default waterfall, withdrawal blocking, audit immutability |
| CI-04 | Web unit tests | Vitest for `lib/documents/*`, `lib/validation/*`, `lib/document-numbers.ts` |
| CI-05 `[x]` | GitHub Actions: PR pipeline | `pnpm typecheck`, `pnpm lint`, `go vet ./...`, `go build ./...`, both test suites. Required check on `main` |
| CI-06 | Add `go vet` + `golangci-lint` | Would have caught the unused `ValidateToken` and `MaxRequestBodySize` that hid SEC-01 and SEC-07 |
| CI-07 `[x]` | Dependabot / Renovate | Weekly, grouped, for npm + Go modules |
| CI-08 `[x]` | Secret scanning | `gitleaks` in CI. Given SEC-06, also scan history once |
| CI-09 | Branch protection on `main` | No direct pushes, CI green to merge |

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
| RUN-07 | Global rate limiting | Login is throttled; nothing else is. Add per-IP limits on all mutating routes |
| ~~RUN-08~~ | ~~Panic reporting~~ | **Done** (WO-18) — `observability.Recoverer` sits inside chi's Recoverer and reports the panic before re-raising. |
| RUN-09 | Split `user_repository.go` | 4.9 k lines in one file is the single biggest obstacle to anyone else contributing. Split by domain: members, deposits, loans, reports, support |
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
| DATA-08 | Verify audit-log immutability at the DB level | Rule 6 is enforced by convention. A `BEFORE UPDATE OR DELETE` trigger that raises makes it true |

---

## Phase 5 — Portability (the bridge to a VPS)

Nothing here changes behaviour. It ends the lock-in, and it is the prerequisite
for Phase 6. Do it *before* you need to move, so the move is not also a rewrite.

| ID | Task | Notes |
|---|---|---|
| PKG-01 | Dockerfile for the Go API | Multi-stage, distroless or alpine final, non-root user, `CGO_ENABLED=0`. Target <20 MB |
| PKG-02 | Dockerfile for the Next app | Multi-stage with `output: 'standalone'` in `next.config.js`. Note Prisma's engine binaries need the right base image |
| PKG-03 | Extend `docker-compose.yml` to the whole stack | It runs Postgres only. `docker compose up` should give a working platform — this doubles as onboarding and as the CI integration-test environment |
| PKG-04 | `.dockerignore` for both | Keep `node_modules`, `.next`, `.git` out of the build context |
| PKG-05 | Pin versions everywhere | Go toolchain, Node, pnpm, base images by digest. Reproducible builds are what make a rollback real |
| PKG-06 | Build and push images in CI | GHCR, tagged by commit SHA. **A deployable artifact per commit is what turns a rollback into one command** |
| PKG-07 | Health checks in the images | `HEALTHCHECK` wired to RUN-03 |
| PKG-08 | Document the full env-var contract | `.env.example` is good; add which are build-time vs runtime, and which differ between the two apps |

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

| # | Block | Tasks | Rough effort |
|---|---|---|---|
| 1 | **Security defects** | SEC-08, SEC-09 (SEC-01 → SEC-07 done) | ½ day |
| 2 | **Safety net** | CI-09 only — branch protection, a GitHub setting (CI-01 → CI-08 done) | 5 minutes |
| 3 | **Runtime hardening** | RUN-07, RUN-08 (RUN-01 → RUN-06 done) | ½ day |
| ~~4~~ | ~~**Backups that work**~~ | ~~DATA-01, DATA-02, DATA-03~~ | **Done** |
| ~~5~~ | ~~**Can see it**~~ | ~~OBS-01 → OBS-06~~ (OBS-05 log aggregation still open) | **Done** |
| 6 | **Migrations + seed** | DATA-08 only (DATA-04, DATA-05 done) | ½ day |
| 7 | **Containerise** | PKG-01 → PKG-08 | 2–3 days |
| 8 | **Code health** | RUN-09, RUN-10, OBS-07, OBS-08 | 1 week |
| 9 | **Remaining data + ops** | DATA-06, DATA-07, OPS-01 → OPS-09 | 1 week |
| 10 | **Move hosts** | INF-01 → INF-12 | 1–2 weeks |

Blocks 1–4 are the ones that matter if you only ever do part of this list: they
turn "it works" into "it works, and if it breaks the members' money is still
there."

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
