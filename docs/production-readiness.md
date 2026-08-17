# Production Readiness Map

Everything between today's free-tier deployment and a platform that can be run on
a VPS by someone who is not the author. Re-verified against the source on
**2026-08-17**.

This file is the **operational** backlog and the *why*. [tasks.md](tasks.md)
tracks *product* work (FR-01…22); [work-orders.md](work-orders.md) is the *what
to change*; [testing.md](testing.md) is the plan to prove any of it.

Task IDs are stable — cite them in commits (`SEC-11: enforce blacklist in Next`).

`[x]` done · `[~]` partial · `[ ]` not started · `[!]` **defect in production now**

> **One open defect.** **SEC-10** — 39 files of member records are recoverable
> from git history. This is a disclosure that has already occurred and continues
> for as long as the objects exist, not a risk. Everything else on this page is
> done or is forward-looking work.
>
> **SEC-11 closed 2026-08-17.** Revocation now binds on both backends.

---

## 1. Where the platform actually stands

| Area | State | One-line verdict |
|---|---|---|
| **Ledger integrity** | `[x]` | LEDGER-01→06 all fixed 2026-08-17. Balance writes are relative and locked (ADR-015), the waterfall handles a null guarantor inside one transaction, donations are sequential and audited. LEDGER-05 and 06 came out of the testing plan: loan repayment had the *same* lost-update shape as LEDGER-01 in a method the first pass missed, and defaulting a loan twice recovered twice. Regression tests for every one, each verified to fail against the pre-fix code |
| **Git history** | `[!]` | **39 files of member records are recoverable from history** — see SEC-10. The only item on this page that is a disclosure rather than a risk |
| Product features | `[~]` | 14 of 22 FRs complete, 8 partial — see [tasks.md](tasks.md). FR-10/FR-11 got their UI in WO-45; FR-12 is still partial because a worker-created loan skips the lifecycle |
| Domain correctness | `[x]` | BigInt taka, zero-interest, append-only audit, request→process→confirm. Balance arithmetic is now race-proof under concurrent postings |
| Authentication | `[x]` | HS256 JWT, bcrypt, first-login token, PG-backed login rate limit |
| Authorization | `[x]` | Per-handler `requireRoles` plus a router-level gate on the whole `/admin` group (SEC-02) |
| Session revocation | `[x]` | Both backends check `token_blacklist` on every authenticated request. SEC-01 for Go, SEC-11 for Next (closed 2026-08-17) |
| Documents / PDFs | `[x]` | Vector text, paginated, English-only (ADR-012, ADR-013). Three rendering defects fixed 2026-08-17 by TEST-24/25: the PDF silently dropped typographic punctuation (turning two possessives into plurals in the loan agreement's default clause, and blanking `orDash`'s placeholder), and two statement columns were too narrow — every receipt number wrapped mid-digit. Column widths are now measured against their content rather than eyeballed |
| Automated tests | `[x]` | **Phases 0–5 done; the boundary gap is closed.** All 64 Go routes and all 21 Next route methods are under an enumerated contract that fails if a route is added without one (TEST-15/16); every balance-writing repository method has a concurrency test and an audit test, kept honest by a census derived from the source (TEST-11/14); the FR table, this repo's status board and the code are checked three ways against each other (TEST-20); both document renderers are proven to carry the same content (TEST-24). **336** web unit tests, **266** Next route-contract assertions, ~700 Go integration assertions, 400k property iterations over the loan arithmetic, **10** Playwright specs. Fourteen defects found and fixed, two of them money-moving |
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
| Go routes | 61 under `/v1` (WO-41 removed 2 dead worker routes) |
| Next route handlers | 11 — WO-44 removed 5, WO-45 added `members/lookup`. Only `admin/audit-logs` is now uncalled, awaiting OBS-08's viewer |
| Prisma models | 21, 30 indexes |
| `.git` | 53 MB — **~112 MB of raw blobs** in history: 39 member-record files, three stray binaries and a 24 MB `react` blob (SEC-06, SEC-10) |

---

## Phase −1 — Ledger integrity `[x]`

**Six defects that destroyed or misreported money, all fixed 2026-08-17.** Each
was reproduced against a real Postgres 17, and each fix carries a regression test
confirmed to fail against the pre-fix code first.

| ID | Defect | Fix |
|---|---|---|
| LEDGER-01 | Concurrent postings destroyed money — 20 simultaneous ৳1,000 deposits left a ৳1,000 balance against ৳20,000 of transaction rows | Balances written **relatively** or read `FOR UPDATE` inside the transaction ([ADR-015](decisions.md)) |
| LEDGER-02 | Defaulting a loan with **no guarantor** marked it DEFAULTED and recovered nothing | Waterfall handles a null guarantor, inside one transaction |
| LEDGER-03 | Loan approval notification divided by 100 | Removed — money is whole taka (ADR-002) |
| LEDGER-04 | Donations numbered by wall clock, so two in the same second collided | Allocated from `document_sequences` (ADR-013) |
| LEDGER-05 | **Loan repayment had LEDGER-01's exact shape** — the balance was read from the pool before the transaction opened, the "does it exceed what is owed" check used that stale read, and the write was an absolute value computed in Go. Ten concurrent ৳1,000 payments against a ৳5,000 loan all committed, leaving `accounts."loanBalance"` at **−5,000** | Every read moved inside the transaction and locked; the write is relative and carries its own guard, so the overpayment check and the write are one statement (ADR-015) |
| LEDGER-06 | **Defaulting a loan twice recovered twice.** Nothing looked at the status being changed *from*, so a second click re-ran the recovery waterfall against savings deposited since — for a debt already settled | The loan row is locked and its status checked first: 404 unknown, 409 not defaultable. Table test over all nine `LoanStatus` values, plus a race proving one of six concurrent defaults wins |

**Why a green suite missed four of them, which is the durable part:** the
integration tests never ran two postings concurrently, never seeded a loan
without a guarantor, and never called any method twice. Coverage bounds what was
*executed*, never what was *checked*. LEDGER-05 is the sharpest version of this:
the fix for LEDGER-01 was reviewed, documented as ADR-015, and applied — to the
four methods someone thought of. The fifth was found by a test that enumerates
balance writers from the source rather than from memory, and that census now
fails the build if a sixth appears. The reasoning behind each fix is in
[decisions.md](decisions.md) and [Batch L](work-orders.md#completed--wo-01--wo-50).

---

## Phase 0 — Security defects (do these first)

These are live. Everything else on this page can wait behind them.

### SEC-11 · The Next.js surface ignored token revocation `[x]` — fixed 2026-08-17

The Go API checked `token_blacklist` on every request; the Next route handlers
did not. `lib/auth.ts` and `lib/server-auth.ts` verified the HS256 signature and
`exp` and stopped there — so after **logout**, after a **password change**, and
after an **admin revoked a user**, the old token still worked against every Next
handler, including `PUT /api/v1/settings`, which sets loan policy.

`server-auth.ts` had a `fetchUserFromApi` fallback that *would* have been
blacklist-checked, but it only ran when `JWT_SECRET` was unset or verification
threw — i.e. never in a correct deployment. That is the shape to watch for: a
safety net positioned where it can never be reached.

**Fixed** by [`lib/auth-revocation.ts`](../apps/web/lib/auth-revocation.ts).
`requireActiveAuth` replaces `requireAuth` on all six routes that used it, and
`server-auth.ts` checks revocation inline for settings, gallery and avatar
upload. Both mechanisms mirror `internal/services/security_service.go` — the
per-token hash and the `all:<userId>` marker — including the whole-second `iat`
truncation, without which a token minted moments after a password change is born
revoked and first login breaks for every member.

It **fails closed**: a failed revocation lookup rejects the request. That is the
opposite of the rate limiter's fail-open, and deliberately so — a few extra
availability checks during a database blip are cheap; honouring a revoked admin
token is not.

Covered by 14 tests in
[`lib/auth-revocation.test.ts`](../apps/web/lib/auth-revocation.test.ts).

### SEC-12 · `GET /api/v1/settings` is unauthenticated `[~]` — **low**

The whole `system_config` table is returned to anyone who asks. It has to be
partly public — the marketing pages and login screen read branding from it — but
it currently ships loan policy, org contact details and support retention
settings to unauthenticated callers in the same payload. Split it into a public
subset and an admin-only remainder rather than gating the whole route, which
would break the public site.

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

### Closed security items

Kept as a record. The reasoning that outlived each one is in
[decisions.md](decisions.md), [changing-things.md](changing-things.md) or
[Traps](work-orders.md#traps-that-cost-a-session).

| ID | Was | Closed by |
|---|---|---|
| SEC-01 | Token revocation did not work — the blacklist was written and never read | WO-01 |
| SEC-02 | Four admin endpoints did not check role | WO-02 — now gated at the router, so a new handler is protected by *where it is mounted* |
| SEC-03 | Gallery writes unauthenticated and world-CORS | WO-03 |
| SEC-04 | Wildcard CORS on `/api/v1/settings` | WO-04 — one origin-checked helper |
| SEC-05 | Bearer token accepted in the query string, so it landed in access logs | WO-05 — 60 s single-purpose SSE tickets |
| SEC-06 | A 17 MB compiled binary committed | Removed from the tree; **still in history** — see SEC-10 |
| SEC-07 | No request body size limit | WO-05 — bounded at 1 MB |
| SEC-08 | Unauthenticated registration enumeration | WO-30 — 20 checks per 10 min per address |
| SEC-09 | HSTS commented out | WO-31 — behind `ENABLE_HSTS`, **off by default** so a plain-HTTP localhost API cannot pin `localhost` to HTTPS for two years in every project on that machine |
| SEC-13 | `GetMemberLoans` returned the name **and savings balance** of the 50 wealthiest members to any signed-in member — a ranked list of who in the village has the most money | Removed. Guarantor nomination now goes through `GET /api/v1/members/lookup`: exact member-ID match, name only, rate limited |

**A green secret scan is not evidence that history is clean.** gitleaks passes on
this repository and always has — it looks for credential *patterns*, not for
documents that should never have been committed. SEC-10 is the example.

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

**[go-live.md](go-live.md) is the order; this is the backlog.** The platform is
deployed holding fake data, so the useful sequencing is *what gets more expensive
once real member data exists*, not *what is most urgent*.

Completed blocks are removed rather than struck through — the
[work-orders.md](work-orders.md) completion table is the record.

| # | Block | Tasks | Order |
|---|---|---|---|
| 1 | **Purge git history** | SEC-10, SEC-06 | [WO-28](work-orders.md) — ½ day plus GitHub Support |
| 2 | **Test the boundaries** | 61 handlers, 86 endpoints at 0% | [testing.md](testing.md) Phases 0 → 3 |
| 3 | **Settle the data model** | Legacy `LoanStatus`, FR-15/16, FR-08 | [go-live.md](go-live.md) 1.2 — a migration today, a migration *plus a backfill* after launch |
| 4 | **Finish the linters** | 18 `errcheck`/`staticcheck` findings, 6 of them unchecked audit writes | [WO-40](work-orders.md) |
| 5 | **Remaining data + ops** | DATA-06 (Cloudinary assets — the largest remaining data gap), DATA-07, OBS-05/07/08, OPS-01 → OPS-09 | — |
| 6 | **Move hosts** | INF-01 → INF-12 | [changing-things.md](changing-things.md) has the env contract |

**Block 1 is not like the rest of this list.** It is a disclosure that has
already happened and continues for as long as the objects exist. Everything else
here is ordinary backlog by comparison.

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
