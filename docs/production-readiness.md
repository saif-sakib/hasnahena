# Production Readiness Map

Everything between today's free-tier deployment and a platform that can be run on
a VPS by someone who is not the author. Re-verified against the source on
**2026-08-18**.

This file is the **operational** backlog and the *why*. [tasks.md](tasks.md)
tracks *product* work (FR-01…22); [work-orders.md](work-orders.md) is the *what
to change*; [testing.md](testing.md) is how any of it is proved.

Task IDs are stable — cite them in commits (`SEC-10: purge history`).
**Completed phases are compressed to one line each**; the record of what they
contained is in [changelog.md](changelog.md).

`[x]` done · `[~]` partial · `[ ]` not started · `[!]` **defect in production now**

> **Three things are wrong right now, and they are different in kind.**
>
> **A member's dispute reports failure while succeeding** — FR-17, found and
> proven by the 2026-08-18 code audit. Product defect, so it lives in
> [tasks.md](tasks.md); named here because it is the most urgent thing in the
> repository and this page is read first by anyone asking "what is broken".
>
> **SEC-10** — 39 files of member records are recoverable from git history. A
> disclosure that has already occurred and continues for as long as the objects
> exist, not a risk.
>
> **The monitoring is built and switched off.** Sentry, `/metrics` and
> UptimeRobot all exist in code and none of them is receiving anything, because
> no environment has the credentials set. See
> [The monitoring is built and switched off](#the-monitoring-is-built-and-switched-off).
> Nothing is broken — but every claim on this page about *observing* production
> is currently a claim about code that would work if enabled.

---

## 1. Where the platform actually stands

| Area | State | One-line verdict |
|---|---|---|
| **Ledger integrity** | `[x]` | LEDGER-01→06 all fixed. Balance writes are relative and locked ([ADR-015](decisions.md)), the waterfall handles a null guarantor inside one transaction, donations are sequential and audited. Regression tests for every one, each verified to fail against the pre-fix code |
| **Git history** | `[!]` | **39 files of member records are recoverable from history** — see [SEC-10](#sec-10--member-records-are-recoverable-from-git-history---highest) |
| **Monitoring** | `[!]` | Built, correct, and **switched off in every environment** — see below |
| Product features | `[!]` | 13 of 22 FRs complete, 8 partial, **1 broken** (FR-17) — see [tasks.md](tasks.md) |
| Domain correctness | `[x]` | BigInt taka, zero-interest, append-only audit, request→process→confirm. Balance arithmetic is race-proof under concurrent postings |
| Authentication | `[x]` | HS256 JWT, bcrypt, first-login token, PG-backed login rate limit |
| Authorization | `[x]` | Per-handler `requireRoles` plus a router-level gate on the whole `/admin` group (SEC-02) |
| Session revocation | `[x]` | Both backends check `token_blacklist` on every authenticated request (SEC-01, SEC-11) |
| Documents / PDFs | `[x]` | Vector text, paginated, English-only ([ADR-012](decisions.md), [ADR-013](decisions.md)). Column widths are measured against their content rather than eyeballed |
| Automated tests | `[~]` | All eight phases done and the boundary gap closed — then a code audit found **ten more defects the suites do not reach**. They prove *who may call a route* and very little about what it returns to a caller who is allowed: WO-57's route had a test that only ever drove its 404. See [testing.md](testing.md) and [tasks.md](tasks.md#coverage-gaps-under-watch) |
| CI/CD | `[x]` | Actions on PR and push: typecheck, lint, gofmt, vet, build, unit + integration + route tests, browser suite, backup/restore drill, gitleaks. Branch protection is still a manual GitHub setting (CI-09) |
| Containerisation | `[x]` | Dockerfiles for both apps, full-stack compose, digest-pinned bases, images built and pushed to GHCR by CI. **Nothing in production consumes them yet** — they exist so the history is there for INF-06 |
| Observability | `[~]` | The code is complete and none of it is enabled. See below |
| Backups | `[x]` | Nightly encrypted `pg_dump` in Actions, 30-day retention and 90-day monthlies, with a restore drill that runs on every push to main. **Database only** — see DATA-06 |
| Runtime hardening | `[x]` | Bounded bodies, server timeouts, drained shutdown, real readiness probe, scheduled cleanups, rate limiting, panic reporting (RUN-01→09) |
| Secrets management | `[~]` | Env vars per host, no rotation record, no central store (OPS-02, INF-09) |
| Infrastructure as code | `[ ]` | `vercel.json` only. Render config is click-ops (INF-02) |

### Repo shape

| | |
|---|---|
| Go API | 38 files, 12.1k lines (incl. tests). Largest is `dashboard_handler.go` at 2.1k, then `loan_repository.go` at 1.1k |
| Next web | 141 TS/TSX files, 26.7k lines |
| Go routes | 64 under `/v1`, all under an enumerated contract |
| Next route handlers | 11 files, 21 exported methods. Only `admin/audit-logs` is uncalled, awaiting OBS-08's viewer |
| Prisma models | 21, 30 indexes |
| `.git` | 53 MB — **~112 MB of raw blobs** in history: 39 member-record files, three stray binaries and a 24 MB `react` blob (SEC-06, SEC-10) |

---

## The monitoring is built and switched off

This is the newest entry on the page and it came from outside: Sentry emailed the
owner to say a Next.js project had been created and **no errors had ever
arrived**. That is accurate, and it is not a Sentry setup problem.

The integration is complete and correct on both surfaces:

| Piece | Where | Behaviour with no credential |
|---|---|---|
| Sentry, Next server + edge | `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts` | `Sentry.init({ dsn: undefined })` — inert, no error |
| Sentry, browser | `instrumentation-client.ts` | inert |
| Sentry, Go API | `internal/observability/sentry.go` | logs `error tracking disabled: set SENTRY_DSN to enable Sentry` and returns a no-op flush |
| `/metrics` | `internal/metrics/handler.go` | logs `metrics endpoint disabled: set METRICS_TOKEN` and 404s |
| Business alerting | `.github/workflows/monitor.yml` | **exits 1** — the job fails twice a day rather than passing silently |

Every one of those is deliberate: *a missing DSN must never fail a build, and a
financial API must never refuse to boot because error reporting is
misconfigured.* The cost of that design is exactly what happened here — the
system is silent in the same way whether it is healthy or unwatched.

**OBS-03 and OBS-04 are therefore re-marked `[~]`.** The code is done. The
switch is not thrown.

| | To enable | Where |
|---|---|---|
| `[ ]` | `SENTRY_DSN` | **Render** (Go API) |
| `[ ]` | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | **Vercel** (web) — `NEXT_PUBLIC_*` is baked at build time, so this needs a **redeploy**, not a restart |
| `[ ]` | `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | **Vercel** — optional; without them the build succeeds with minified stack traces |
| `[ ]` | `METRICS_TOKEN`, same value in both places | **Render** *and* as a **GitHub secret** — the Monitor workflow scrapes `/metrics` with it |
| `[ ]` | An UptimeRobot monitor on `/v1/ready` | UptimeRobot free tier — deliberately not GitHub Actions, on cost grounds (see the header comment in `monitor.yml`) |

**What is deliberately staying off:** tracing (`tracesSampleRate: 0`) and session
replay (`replaysSessionSampleRate: 0`). Tracing burns the free-tier quota that
should be holding actual exceptions, and replay would record a member's dashboard
— their balance, their loan, their name — and ship it to a third party. PII
scrubbing is on in both apps (`sendDefaultPii: false` plus a `beforeSend` that
drops cookies, headers and query strings).

**Verification, once enabled** — do not assume a DSN that is set is a DSN that
works:

```bash
# Go API: any 500 path, then check the Sentry issue stream
curl -s -o /dev/null -w '%{http_code}\n' https://api.hasnahenafoundation.com/v1/ready
curl -s -H "Authorization: Bearer $METRICS_TOKEN" \
     https://api.hasnahenafoundation.com/metrics | head -5   # must not 404
```

Then trigger one deliberate error from each app and confirm both appear, tagged
with the right environment and release. This is on the Stage 3 checklist in
[go-live.md](go-live.md).

---

## Phase 0 — Security defects

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

**Fix:** [WO-28](work-orders.md) — `git filter-repo --invert-paths` over
`Official Infos/` and the three binaries from SEC-06, force-push, then ask GitHub
Support to garbage-collect unreachable objects. Until they do, the blobs stay
fetchable by SHA even after the rewrite. Add `Official Infos/` to `.gitignore` so
a re-add is not one `git add -A` away.

**Note this is not what gitleaks scans for.** The `secrets` CI job passes on this
repository and always has: it looks for credential *patterns*, not for documents
that should never have been committed. **A green secret scan is not evidence that
history is clean**, and this is the example.

### SEC-12 · `GET /api/v1/settings` still serves loan policy to anonymous callers `[~]` — **low**

**Partly closed 2026-08-17.** The route used to return the entire `system_config`
table with `SELECT *`, so the day someone added a key holding an internal
threshold or a partner's contact details it became public with no code change and
nothing to notice. It now returns **only the declared keys** in
`lib/system-config.ts`, and that is the same allowlist `PUT` validates against, so
a key cannot be writable-but-not-readable or the reverse (TEST-17).

**What remains** is the original point: the route has to be partly public — the
marketing pages and login screen read branding from it before anyone signs in —
but the declared set still includes `loan.minDepositForLoan`,
`loan.maxLoanMultiplier`, `loan.maxInstallmentMonths`,
`loan.guarantorThresholdAmount` and the rest of the loan policy. Split the
allowlist into a public subset and an admin-only remainder rather than gating the
whole route, which would break the public site.

Low, and it is genuinely low: the policy is published to members anyway. It is on
this page so that the *narrowing* is not mistaken for the *split*.

### SEC-14 · The access log records an address the caller chose `[!]` — **medium**

`main.go:172` mounts chi's `middleware.RealIP`, which staticcheck flags as
`SA1019`. It is deprecated for exactly this reason: it overwrites
`r.RemoteAddr` with the **leftmost** `X-Forwarded-For` entry, which the caller
supplies.

The access log then records that value as `"ip"`. **An access log that cannot be
trusted to say where a request came from is not evidence**, and in a financial
system the log exists to answer "who did this".

The rate limiter is a second victim but a partial one: `clientIP()` reads
`X-Forwarded-For` from the **right** and is correct whenever `TRUSTED_PROXIES >
0` — `.env.render.example` sets it to 1 and explains why. The default is **0**,
and in that configuration the limiter falls back to the `RemoteAddr` that
`RealIP` already rewrote, so a caller mints a fresh quota per request by varying
a header.

**Fix:** [WO-60](work-orders.md) — delete `RealIP`, and have the logger and the
limiter share one `clientIP` function so they cannot disagree about who the
caller is.

### SEC-15 · The support proxy forwards any path it is given `[~]` — **low**

`app/api/v1/dashboard/support/[...path]/route.ts` joins the catch-all segments
into the upstream URL without validation. Next decodes them, so `%2e%2e%2f`
arrives as `../` and `fetch` normalises it — a caller can reach any path on the
API base through this proxy.

**This is not a privilege escalation, and saying so matters**: the Go API
authorises every route itself and the `/admin` group is gated at the router, so
the token is refused wherever it arrives. What remains is that all support
traffic reaches the Go limiter from **Vercel's** address rather than the
member's, so one member can exhaust support for everyone and their abuse is not
attributable. Plus the SSE proxy does not forward the abort signal, so an
abandoned browser leaks an upstream stream — which eats the RUN-02 drain window.

**Fix:** [WO-64](work-orders.md).

### SEC-16 · Modulo bias in generated passwords and codes `[~]` — **low**

Three generators map random bytes onto an alphabet with `%`, which does not
divide 256 evenly. The one that matters is the **password-change verification
code**: `digits[buf[i] % 10]` makes digits 0–5 25% more likely than 6–9.

All three are `crypto/rand`-seeded, so this is a bias, **not** a predictability
problem — do not describe it as the latter. **Fix:** [WO-65](work-orders.md).

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
| SEC-11 | The Next handlers ignored `token_blacklist`, so a token kept working after logout, after a password change and after an admin revoked the user — on every Next endpoint including the one that sets loan policy | WO — `lib/auth-revocation.ts`, fails **closed**. The `fetchUserFromApi` fallback that *would* have been checked only ran when `JWT_SECRET` was unset, i.e. never in a correct deployment: **a safety net positioned where it can never be reached** |
| SEC-13 | `GetMemberLoans` returned the name **and savings balance** of the 50 wealthiest members to any signed-in member — a ranked list of who in the village has the most money | Removed. Guarantor nomination goes through `GET /api/v1/members/lookup`: exact member-ID match, name only, rate limited |

---

## Phases 1–5 — done, compressed

Each of these was a full phase with its own task table. They are complete; the
tables are gone and the record is in [changelog.md](changelog.md). Only the open
rows survive below.

| Phase | What it delivered | Open rows |
|---|---|---|
| **1 · Safety net** (CI-01…09) | One test command, Go money unit tests, integration tests on real Postgres, web unit tests, the Actions pipeline, `go vet` + `golangci-lint`, Dependabot, gitleaks | **CI-09** below |
| **2 · Runtime hardening** (RUN-01…10) | Configured `http.Server` with all four timeouts, drained `SIGTERM` shutdown, `/v1/ready` against the pool, JSON `slog` with member emails replaced by user IDs, hourly cleanup sweeps, global rate limiting, panic reporting, `user_repository.go` split into nine domain files | none |
| **3 · Observability** (OBS-01…08) | Token-gated `/metrics` with business gauges, Sentry on both apps, threshold alerting split across UptimeRobot/Sentry/Actions on cost grounds | **OBS-03/04** (switched off, above) · **OBS-05/07/08** below |
| **4 · Data safety** (DATA-01…08) | Nightly encrypted `pg_dump` off-provider, a restore *script* drilled on every push, RPO 24 h / RTO 1 h in writing, Prisma migrations ([ADR-014](decisions.md)), an idempotent seed, and an `audit_logs` immutability trigger verified across 7 cases **including that it survives a dump/restore round trip** | **DATA-06/07** below |
| **5 · Portability** (PKG-01…08) | Dockerfiles for both apps verified by *running* them, full-stack compose, digest-pinned bases, images pushed to GHCR by CI, in-image health checks, and the full env-var contract written down | none |

Two things from those phases are worth keeping in front of you rather than in the
changelog, because they are the shape of the next defect:

- **`.dockerignore` is a secret-containment control, not a build optimisation.**
  Next's tracer was observed copying `.env.local` into `.next/standalone/`, which
  would have baked production credentials into an image layer.
- **`NEXT_PUBLIC_*` is baked at `next build`** — including for server-side route
  handlers. Changing one needs a **redeploy**, not a restart, and in Docker it is
  a `--build-arg` that `-e` cannot override. This is the part with no error
  message, and it is why the Sentry web DSN above needs a redeploy.

### The open rows from those phases

| ID | Task | Notes |
|---|---|---|
| RUN-11 `[ ]` | Bound the email path and give it a context | `sendWithRetry` is 3 attempts × a 12 s timeout with 1.5 s backoff — **39 s worst case, synchronous, inside the approval handler**, against a 30 s `SERVER_SHUTDOWN_TIMEOUT`. A deploy during a slow Brevo call is a `SIGKILL` mid-request, which is the failure RUN-02 exists to prevent, reintroduced by a dependency's latency. No context propagation and an uninterruptible `time.Sleep`. [WO-62](work-orders.md) |
| CI-09 `[ ]` | Branch protection on `main` | No direct pushes, CI green to merge. **Needs a paid plan on a private repo** — `.githooks/pre-push` is the free stand-in and is active (`core.hooksPath=.githooks`) |
| CI-10 `[ ]` | Run the integration suite under `-race` | **Measured 2026-08-18: zero data races** across the full suite, in ~40 s. So this locks in a property that already holds rather than fixing anything — and it is the cheapest available guard for a system whose defining defect class is the lost update (LEDGER-01, LEDGER-05). [WO-66](work-orders.md) |
| OBS-05 `[ ]` | Log aggregation | Grafana Cloud or Better Stack free tier. Required once there is more than one process |
| OBS-07 `[ ]` | Dashboard | One screen: uptime, error rate, p95 latency, money posted today, queue depths |
| OBS-08 `[ ]` | Audit log viewer UI | FR-22 gap. The data is complete and `admin/audit-logs` already exists and is uncalled; nobody can read it without SQL |
| DATA-06 `[ ]` | Backup the Cloudinary assets | NID and member photos are regulatory documents living in one third-party account with no export. **The largest remaining data gap** — the nightly dump covers the database and nothing else |
| DATA-07 `[ ]` | Data retention + erasure policy | NID images and PII need a stated retention period and a deletion path. The audit log is append-only by design, so decide **now** what a member's erasure request means — it is a schema question |

---

## Phase 6 — VPS or AWS

Only start once everything above is done. Moving an unmonitored, untested,
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
| INF-06 | Deployment pipeline | CI already builds and pushes to GHCR → pull and restart on the host. Rollback = redeploy the previous SHA |
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
| OPS-07 | **Financial reconciliation job** | Automated: sum of transactions must equal account balances. Alert on drift. **The strongest guard a ledger can have** — had it existed, LEDGER-01 would have been a nightly alert rather than an audit finding. [go-live.md](go-live.md) promotes this to Stage 1 |
| OPS-08 | 48-hour unconfirmed-transaction sweep | Product gap in tasks.md; it needs the scheduler this phase provides |
| OPS-09 | Uptime/incident log | A dated file. Turns "it feels slow lately" into evidence |

---

## Ordered backlog

Do them in this order. Each block is genuinely blocked by the one above it.

**[go-live.md](go-live.md) is the order; this is the backlog.** The platform is
deployed holding fake data, so the useful sequencing is *what gets more expensive
once real member data exists*, not *what is most urgent*.

Completed blocks are removed rather than struck through — [changelog.md](changelog.md)
is the record.

| # | Block | Tasks | Order |
|---|---|---|---|
| 0 | **Fix what is hurting a member** | FR-17, LEDGER-07, the dropped notifications | [WO-57 → WO-59](work-orders.md). Not on this page's usual axis — these are wrong *now*, which beats everything that is merely expensive later |
| 1 | **Purge git history** | SEC-10, SEC-06 | [WO-28](work-orders.md) — ½ day plus GitHub Support |
| 2 | **Switch the monitoring on** | OBS-03, OBS-04 | Above. Dashboard work, not engineering, and everything below is being done blind until it is done |
| 3 | **Settle the data model** | Legacy `LoanStatus`, FR-15/16, FR-08, DATA-07 | [go-live.md](go-live.md) 1.2 — a migration today, a migration *plus a backfill* after launch |
| 4 | **Close the coverage gaps** | [WO-51 → WO-55](work-orders.md) | [tasks.md](tasks.md#coverage-gaps-under-watch) — what the eight testing phases do not reach |
| 5 | **Finish the linters and the hardening** | 19 `errcheck`/`staticcheck` findings — 6 unchecked audit writes and **2 unchecked `InvalidateAllUserTokens`, a password change that revokes nothing** — plus SEC-14/15/16 and RUN-11 | [WO-40](work-orders.md), [WO-60 → WO-65](work-orders.md) |
| 6 | **Remaining data + ops** | DATA-06, OBS-05/07/08, OPS-01 → OPS-09 | OPS-07 first |
| 7 | **Move hosts** | INF-01 → INF-12 | [changing-things.md](changing-things.md) has the env contract |

**Block 1 is not like the rest of this list.** It is a disclosure that has
already happened and continues for as long as the objects exist. Everything else
here is ordinary backlog by comparison.

The blocks that used to head this list — backups, tests, CI, observability code,
containers — are done, and they are what turned "it works" into "it works, and if
it breaks the members' money is still there."

---

## The durable lessons from all of it

Kept here rather than in the changelog because each one predicts the *next*
defect rather than describing a past one.

- **A green suite bounds the cases it contains and says nothing about the ones it
  does not.** 17 integration tests were green while LEDGER-01 and LEDGER-02
  destroyed money, because the suite never ran two postings at once and never
  seeded a loan without a guarantor. Coverage measures what was *executed*, never
  what was *checked*.
- **A fix applied from memory covers the methods someone thought of.** ADR-015
  was written, reviewed and applied to four balance writers. The fifth
  (LEDGER-05) was found by a census derived from the source, which now fails the
  build if a sixth appears. **Enumerate from the code, not from recall.**
- **Watch for a safety net positioned where it can never be reached.** SEC-11's
  `fetchUserFromApi` fallback *would* have been blacklist-checked — it only ran
  when `JWT_SECRET` was unset.
- **Two backends over one schema drift.** A fix applied to the Go document-number
  allocator was never carried to the TypeScript one, and loan applications were
  impossible for months. Grep both.
- **C, L and M were all found by running the code, not reading it.** Every audit
  that reviewed those files by eye passed them.
- **Silence is ambiguous.** The monitoring section above is the newest instance:
  a system with no DSN configured looks exactly like a system with no errors.
- **A route contract proves who may call a route, not what it returns.** The
  2026-08-18 audit's worst finding (FR-17, [WO-57](work-orders.md)) sat behind a
  test that drove the route with a non-existent id and asserted the 404. Every
  authorization case passed; the success path had never run. When a suite is
  built from "who is allowed", ask what it does once someone is.

---

## Dead code that must not be deleted

A linter or a cleanup pass will flag these as unused. They are unused **because a
wiring step was never finished**, and each one is the remedy for a defect on this
page. Deleting them deletes the fix.

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
| Sentry tracing and session replay | Tracing burns the free-tier quota that should hold exceptions; replay would ship a member's balance and name to a third party |
| `@axe-core/playwright` | A generic audit produces a long advisory list nobody actions. The four hand-written accessibility checks are specific to members filling in financial forms on a cheap Android in sunlight |
