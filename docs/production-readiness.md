# Production Readiness

Everything between today's free-tier deployment and a platform that can be run on
a VPS by someone who is not the author.

This file is the **operational** backlog and the *why*. [tasks.md](tasks.md)
tracks *product* work (FR-01…22); [work-orders.md](work-orders.md) is the *what
to change*; [testing.md](testing.md) is how any of it is proved. Task IDs are
stable — cite them in commits (`RUN-07: throttle mutations`).

Completed items are one line each; the record of what they contained is in
[changelog.md](changelog.md), and the lessons that outlived them are in
[traps.md](traps.md).

`[x]` done · `[~]` partial · `[ ]` not started · `[!]` **defect in production now**

> **One thing is wrong right now: the monitoring is built and switched off.**
> Sentry, `/metrics` and UptimeRobot all exist in code and none of them is
> receiving anything, because no environment has the credentials set. Nothing is
> broken — but every claim on this page about *observing* production is currently
> a claim about code that would work if enabled.
> [How to switch it on](#the-monitoring-is-built-and-switched-off).

---

## Where the platform stands

| Area | State | Verdict |
|---|---|---|
| **Monitoring** | `[!]` | Built, correct, and **switched off in every environment** — below |
| Ledger integrity | `[x]` | LEDGER-01→07 fixed. Balance writes relative and locked ([ADR-015](decisions.md)), the waterfall handles a null guarantor inside one transaction, donations sequential and audited. A regression test for every one, each seen to fail against the pre-fix code. **And now reconciled hourly** (OPS-07): the totals are summed and compared to the stored balances, which is the only check that catches a wrong balance nobody has added up |
| Domain correctness | `[x]` | BigInt taka, zero-interest, append-only audit, request→process→confirm. Balance arithmetic is race-proof under concurrent postings |
| Product features | `[~]` | 13 of 23 FRs complete, 8 partial, 2 not started, **none broken** — [tasks.md](tasks.md) |
| Authentication | `[x]` | HS256 JWT, bcrypt, first-login token, PG-backed login lockout that **escalates** on the identifier+address pair and stays flat on the identifier alone (SEC-21). Reset secrets stored as SHA-256 (SEC-18); no auth endpoint discloses who is a member (SEC-20, [ADR-032](decisions.md)) |
| Authorization | `[x]` | Per-handler `requireRoles` plus a router-level gate on the whole `/admin` group (SEC-02) |
| Session revocation | `[x]` | **Both** backends check `token_blacklist` on every authenticated request (SEC-01, SEC-11), and **both** password paths write the marker — the reset in the same transaction as the password (SEC-17, [ADR-031](decisions.md)). Dismissal and erasure write it too, in the same transaction (SEC-23), which matters because neither backend re-reads a user's `status` per request. The marker's lifetime is derived from `JWT_EXPIRY_SECONDS` on **both** hosts, so raising that variable cannot resurrect a revoked token |
| Documents / PDFs | `[x]` | Vector text, paginated, English-only ([ADR-012](decisions.md), [ADR-013](decisions.md)). Column widths measured against content, not eyeballed |
| Automated tests | `[~]` | Nine phases, then a code audit found ten defects the suites did not reach — they prove *who may call a route* and little about what it returns. All ten closed, each with a *census* rather than a single case. [testing.md](testing.md) |
| CI/CD | `[x]` | Actions on PR and push: typecheck, lint, gofmt, vet, build, unit + integration (`-race`) + route tests, schema-drift check, browser suite, backup/restore drill, gitleaks. Branch protection is still a manual GitHub setting (CI-09) |
| Containerisation | `[x]` | Dockerfiles for both apps, full-stack compose, digest-pinned bases, images built and pushed to GHCR by CI. **Nothing in production consumes them yet** — they exist so a host move is configuration, not a project |
| Backups | `[x]` | Nightly encrypted `pg_dump` in Actions, 30-day retention and 90-day monthlies, restore drill on every push to main. **Database only** — see DATA-06 |
| Data protection | `[x]` | Identity data has an end date and money does not ([ADR-033](decisions.md), FR-23). A member with postings is anonymised, one with none is deleted, and a rejected application loses its identity documents after `security.rejectedRetentionDays` — swept daily by the Go API. The audit row names the account number and never what was erased, because `audit_logs` cannot be deleted from |
| Runtime hardening | `[x]` | Bounded bodies, server timeouts, drained shutdown, real readiness probe, scheduled cleanups, rate limiting, panic reporting, a bounded email path (RUN-01→11) |
| Git history | `[x]` | 39 files and three binaries remain in history; **assessed and accepted** — not live member data ([ADR-018](decisions.md)) |
| Secrets management | `[~]` | Env vars per host, no rotation record, no central store (OPS-02, INF-09). The *order* to rotate them in is written down — [runbook.md §3](runbook.md#3-a-suspected-credential-leak) |
| Infrastructure as code | `[ ]` | `vercel.json` only. Render config is click-ops (INF-02) |
| Search discoverability | `[~]` | Canonicals, `hreflang` + `x-default`, sitemap, `robots.txt`, JSON-LD (`NGO`, never `FinancialService`), OG/Twitter cards, a declared favicon at 48px multiples and a web app manifest. **`/` no longer redirects** — it is a real, self-canonical English page, and every `/en/*` URL 301s to its unprefixed form, which is the actual fix for the *"Duplicate, Google chose different canonical than user"* report on `/bn` ([ADR-034](decisions.md)). **Three things are outside the code**: nobody has claimed the property in Google Search Console, so there is no way to see how the site is actually indexed; `org.nameEn` in the production database still reads "Hasnahena" rather than "Hasnahena Foundation", and `org.email` reads a domain the foundation does not own (WO-97) — the JSON-LD and the public pages publish whatever those rows hold |

---

## The monitoring is built and switched off

This came from outside: Sentry emailed to say a Next.js project had been created
and **no errors had ever arrived**. That is accurate, and it is not a Sentry
setup problem.

The integration is complete and correct on both surfaces, and every piece is
deliberately inert without a credential — *a missing DSN must never fail a build,
and a financial API must never refuse to boot because error reporting is
misconfigured.* The cost of that design is exactly what happened here: **the
system is silent in the same way whether it is healthy or unwatched.**

| Piece | Where | With no credential |
|---|---|---|
| Sentry, Next server + edge + browser | `sentry.*.config.ts`, `instrumentation*.ts` | inert, no error |
| Sentry, Go API | `internal/observability/sentry.go` | logs `error tracking disabled…`, no-op flush |
| `/metrics` | `internal/metrics/handler.go` | logs `metrics endpoint disabled…` and 404s |
| Business alerting | `.github/workflows/monitor.yml` | **exits 1** — fails twice a day rather than passing silently |

**OBS-03 and OBS-04 are therefore `[~]`.** The code is done; the switch is not
thrown.

| | To enable | Where |
|---|---|---|
| `[ ]` | `SENTRY_DSN` | **Render** (Go API) |
| `[ ]` | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | **Vercel** — `NEXT_PUBLIC_*` is baked at build time, so this needs a **redeploy**, not a restart |
| `[ ]` | `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | **Vercel** — optional; without them the build succeeds with minified stack traces |
| `[ ]` | `METRICS_TOKEN`, same value in both places | **Render** *and* as a **GitHub secret** — the Monitor workflow scrapes `/metrics` with it |
| `[ ]` | An UptimeRobot monitor on `/v1/ready` | UptimeRobot free tier — deliberately not Actions, on cost grounds (see `monitor.yml`) |

**Deliberately staying off:** tracing (`tracesSampleRate: 0`) and session replay.
Tracing burns the free-tier quota that should hold actual exceptions, and replay
would record a member's dashboard — balance, loan, name — and ship it to a third
party. PII scrubbing is on in both apps.

**Then prove each one**, rather than assuming a DSN that is set is a DSN that
works — the checklist is Stage 3 in [go-live.md](go-live.md).

---

## Open items

| ID | Task | Notes |
|---|---|---|
| **OBS-03/04** `[~]` | Switch the monitoring on | Above. Not engineering: four environment variables and an UptimeRobot monitor |
| **CI-09** `[ ]` | Branch protection on `main` | **Needs a paid plan on a private repo.** `.githooks/pre-push` is the free stand-in and is active (`core.hooksPath=.githooks`) |
| **OBS-05** `[ ]` | Log aggregation | Grafana Cloud or Better Stack free tier. Required once there is more than one process |
| **OBS-07** `[ ]` | Dashboard | One screen: uptime, error rate, p95 latency, money posted today, queue depths |
| **OBS-08** `[ ]` | Audit log viewer UI | FR-22 gap. The data is complete and `GET /api/v1/admin/audit-logs` already exists and is uncalled; nobody can read it without SQL |
| **DATA-06** `[ ]` | Back up the Cloudinary assets | **The largest remaining data gap.** NID and member photos are regulatory documents in one third-party account with no export; the nightly dump covers the database and nothing else. **Accepted until the first real member document exists** ([ADR-020](decisions.md)) — there is nothing to lose yet and an export job written against an empty account cannot be tested. The trigger is that document, not a date. When built: list `hasnahena/registrations/**` via the Admin API, download to the same encrypted destination as the `pg_dump`, and reconcile against the `documents` table so a missing asset is *detected* rather than found by an approver opening a blank image |

### Closed, kept as a record

Reasoning that outlived each one is in [decisions.md](decisions.md) or
[traps.md](traps.md); what the fix contained is in [changelog.md](changelog.md).

| ID | Was | Closed by |
|---|---|---|
| SEC-01 | Token revocation did not work — the blacklist was written and never read | WO-01 |
| SEC-02 | Four admin endpoints did not check role | WO-02 — now gated at the router, so a new handler is protected by *where it is mounted* |
| SEC-03 | Gallery writes unauthenticated and world-CORS | WO-03 |
| SEC-04 | Wildcard CORS on `/api/v1/settings` | WO-04 — one origin-checked helper |
| SEC-05 | Bearer token accepted in the query string, so it landed in access logs | WO-05 — 60 s single-purpose SSE tickets |
| SEC-06 · SEC-10 | A compiled binary and 39 `Official Infos/` files committed, then deleted from the tree only | Removed from the tree; history **assessed and accepted** ([ADR-018](decisions.md)). Note gitleaks passes on this and always did — it looks for credential *patterns*, not documents that should never have been committed. **A green secret scan is not evidence that history is clean** |
| SEC-07 | No request body size limit | WO-05 — bounded at 1 MB |
| SEC-08 | Unauthenticated registration enumeration | WO-30 — 20 checks per 10 min per address |
| SEC-09 | HSTS commented out | WO-31 — behind `ENABLE_HSTS`, **off by default** so a plain-HTTP localhost API cannot pin `localhost` to HTTPS for two years in every project on that machine |
| SEC-11 | The Next handlers ignored `token_blacklist`, so a token kept working after logout, after a password change and after an admin revoked the user | `lib/auth-revocation.ts`, fails **closed** |
| SEC-13 | `availableGuarantors` returned the name **and savings balance** of the 50 wealthiest members to any signed-in member — a ranked list of who in the village has the most money | Removed. Nomination goes through `GET /api/v1/members/lookup`: exact member-ID match, name only, rate limited |
| SEC-14 | chi's `RealIP` overwrote `r.RemoteAddr` with the caller-supplied `X-Forwarded-For` entry, so the access log, the login lockout, three audit rows and the rate limiter all keyed on a value the caller chose | WO-60 — one `ClientIP`, counted from the trusted end ([ADR-019](decisions.md)) |
| SEC-15 | The support proxy forwarded any path it was given | WO-64 — an allow-list held against the Go router by a test that reads both files ([ADR-021](decisions.md)) |
| SEC-16 | Modulo bias in generated passwords and codes | WO-65 — rejection sampling. All three were `crypto/rand`-seeded, so this was a bias and **not** a predictability problem; do not describe it as the latter |
| SEC-17 | A **forgot-password reset revoked nothing**, so the one path a member reaches after losing control of their account left the attacker signed in for up to 24 hours | WO-85 — the reset spends the link, writes the hash, retires the first-login marker and revokes every session in one transaction ([ADR-031](decisions.md)) |
| SEC-18 | `password_reset_tokens.token` held the emailed secret in plaintext; for the lifetime of a row the table **was** a set of working credentials | WO-86 — `sha256(secret)` in `tokenHash`, the purpose in `scope`, unique on the pair |
| SEC-19 | The password write was `WHERE email = $2 OR phone = $3` with no row-count check, so one reset could set **two** accounts' passwords, and zero rows affected reported success | WO-87 — scoped to `id`, exactly one row required |
| SEC-20 | `forgot-password` answered `404` / `400 AUTH_EMAIL_REQUIRED` / `200` — three answers to "is this person a member?" on an unauthenticated endpoint | WO-88 — one reply for everybody, two throttles behind it, and the probes that find nothing audited ([ADR-032](decisions.md)) |
| SEC-21 | The login lockout was flat and silent: five guesses, wait, five more, for ever, with no escalation and no audit row | WO-89 — escalating on the identifier+address pair, flat on the identifier alone so it cannot be turned against the member |
| SEC-22 | Email uniqueness was a *convention*: `@unique` on a plain index means `Saif@x.com` and `saif@x.com` are two accounts, two savings balances and one person, held apart only by both write paths happening to lowercase first | WO-90 — a unique index on `lower(email)`, so a seed script, a hand-applied fix and the next creation path all have to pass through it |
| SEC-23 | A **dismissed worker kept a working staff token** — able to post deposits and process withdrawals — until it expired, up to a day later. `status` is read at login and nowhere else, by design, so nothing else takes it away | WO-91 — all three endings write the revoke-all marker inside the transaction that ends the account, with a census that fails when a fourth is added |
| DATA-07 | No data retention or erasure policy: NID images and PII were kept for ever, with no deletion path and an append-only audit log to work around | **The owner's decision, 2026-08-25** — [ADR-033](decisions.md), built as FR-23. It needed no column: a member with postings is anonymised, one without is deleted, and a rejected application loses its identity documents on the sweep's clock. The append-only log shaped the answer rather than blocking it — the row names the account number and never what was erased |
| DATA-09 | `notifications.targetUserId` was a bare `String?` with no relation, cleaned up by hand in exactly one deletion path. A notification is read *by target id*, so a re-used id delivers one member's balance and loan detail to another member's bell icon | WO-92 — a real foreign key with `onDelete: Cascade`, and the hand-written cleanup deleted |
| DATA-10 | There was **no way to remove a member**, and a rejected applicant's NID number, photograph, addresses and both parents' names were kept for ever | WO-93 / FR-23 — anonymise-or-delete by reference count, plus a daily sweep that expires a rejection's identity data ([ADR-033](decisions.md)) |
| RUN-01…10 | Server timeouts, drained shutdown, readiness probe, structured logs, cleanup sweeps, rate limiting, panic reporting, repository split | WO-06→09, WO-32, WO-38 |
| RUN-11 | The email path was 39 s worst case, synchronous, inside the approval handler, against a 30 s shutdown drain | WO-62 — a 10 s budget, 4 s per attempt ([ADR-022](decisions.md)) |
| CI-01…08, CI-10 | No test command, no integration tests, no pipeline, no secret scan, no `-race` | WO-10→13, WO-36, WO-40, WO-66 |
| DATA-01…05, DATA-08 | No backup, no restore drill, `db push` in production, no seed, a mutable audit log | WO-14→16, WO-33 ([ADR-014](decisions.md)) |
| PKG-01…08 | No Dockerfiles, no compose, no published images, no env contract | WO-20→22, WO-34→35 |

---

## Phase 6 — VPS or AWS

Only start once everything above is quiet. Moving an unmonitored system onto
infrastructure you now also have to patch makes things worse.

**Recommended target: a single VPS** (Hetzner/DigitalOcean, 4 GB), not AWS. One
machine, Docker Compose, Caddy for TLS, managed Postgres or a well-backed-up
local one. Roughly $10–25/month, one thing to understand, no surprise bills. Full
AWS (ECS/RDS/ALB) is 5–10× the cost and complexity for this workload — take it
only if a funder or regulator requires it.

| ID | Task | Notes |
|---|---|---|
| INF-01 | Choose the target and write it down as an ADR | Decide *with numbers* — cost, who administers it, what happens when that person is unavailable |
| INF-02 | Provision as code | Terraform or a documented shell script. "I clicked around and it works" is not a recoverable state |
| INF-03 | Base-image hardening | SSH keys only, no root login, `ufw` default-deny, `fail2ban`, unattended security upgrades |
| INF-04 | Reverse proxy + TLS | Caddy (automatic Let's Encrypt) or nginx + certbot. Terminate TLS, forward to both containers, set HSTS |
| INF-05 | Decide the database's home | Staying on Neon is legitimate and keeps DATA-01 simpler. Self-hosting means you own backups, tuning, upgrades and failover |
| INF-06 | Deployment pipeline | CI already builds and pushes to GHCR → pull and restart on the host. Rollback = redeploy the previous SHA |
| INF-07 | Zero-downtime deploys | Two containers behind the proxy, health-gated cutover |
| INF-08 | Log shipping off the box | A dead disk must not take the audit trail with it |
| INF-09 | Secrets management | Docker secrets or SOPS-encrypted files. Not a `.env` on the host with world-read permissions |
| INF-10 | Staging environment | A second compose stack, separate database. First real use of the restore script |
| INF-11 | Cutover runbook | Freeze window, final dump, DNS TTL lowered in advance, restore, verify, switch, **rollback plan**. Rehearse against staging |
| INF-12 | Cost + capacity review | Set a monthly budget alarm before, not after, the first bill |

**Cutover order.** DNS TTL to 300 s a day ahead → announce a maintenance window →
stand up the new stack and restore a dump → run the release checklist in
[deployment.md](deployment.md) against a temporary hostname → freeze writes →
final dump and restore → switch DNS → watch for an hour → keep the old stack warm
for 48 h.

The environment contract the app needs from any host is in
[changing-things.md](changing-things.md#i-want-to-move-off-vercel-and-render-onto-a-vps).

## Phase 7 — Steady-state operations

What makes it *stay* production-ready after you stop looking at it daily.

| ID | Task | Cadence |
|---|---|---|
| OPS-01 | Incident runbooks | `[x]` [runbook.md](runbook.md) — API down, database unreachable, bad deploy → rollback, a disputed transaction against an append-only log, credential rotation in the right order, restore from backup, and where every credential lives |
| OPS-02 | Secret rotation | Every 6 months, and immediately after any exposure. `JWT_SECRET` must change in Vercel and Render **together** or every session breaks |
| OPS-03 | Dependency updates | Monthly, on a branch, with CI green |
| OPS-04 | Restore drill | Quarterly |
| OPS-05 | Access review | Quarterly: who holds admin, Neon, Vercel, Render, Cloudinary and DNS credentials |
| OPS-06 | Bus-factor documentation | `[~]` [runbook.md §6](runbook.md#6-where-every-credential-lives) maps every credential store and who can reach it. It is a map of single points of failure, not a fix for them — **one person can still reach all of them** |
| OPS-07 | **Financial reconciliation job** | `[x]` WO-82. Five invariants summed hourly against the stored balances — savings, loan balance, loan remaining, every `savingsAfter` snapshot against the running total, and WO-72's owner pairs. On drift: an `audit_logs` row, a `slog` error and `hasnahena_ledger_drift_*`. **It never corrects anything** ([ADR-027](decisions.md)). It found two live defects in the default-recovery waterfall on its first run |
| OPS-08 | 48-hour unconfirmed-transaction sweep | Product gap in [tasks.md](tasks.md); needs the scheduler this phase provides |
| OPS-09 | Uptime/incident log | A dated file. Turns "it feels slow lately" into evidence |

---

## Ordered backlog

Each block is genuinely blocked by the one above it. **[go-live.md](go-live.md)
is the order; this is the backlog** — the platform holds fake data, so the useful
sequencing is *what gets more expensive once real member data exists*.

| # | Block | Tasks |
|---|---|---|
| 1 | **Switch the monitoring on** | OBS-03, OBS-04. Dashboard work, not engineering, and everything below is being done blind until it is done |
| 2 | **Settle the data model** | FR-15/16 is what is left — legacy `LoanStatus` is gone (WO-71) and DATA-07 turned out to need no column (FR-23). A migration today; a migration *plus a backfill* after launch. Guarded by `pnpm db:migrate:check` in CI |
| 3 | **Remaining data + ops** | DATA-06, OBS-05/07/08, OPS-02 → OPS-05, OPS-08, OPS-09. **OPS-01, OPS-06 and OPS-07 are done** — what is left of them is OPS-04, the restore rehearsal, which needs the Neon account |
| 4 | **Move hosts** | INF-01 → INF-12 |

Everything that used to head this list — the ledger, backups, tests, CI, the
observability code, containers, the security phases — is done, and it is what
turned "it works" into "it works, and if it breaks the members' money is still
there."

## Dead code that must not be deleted

**This list is empty.** It existed because several symbols were unused *only
because a wiring step was never finished*, and deleting one would have deleted
the fix. All have since been wired up. The section stays as the place to record
the next one.

## Deliberately not doing

Recorded so they are not re-proposed as gaps.

| Not doing | Why |
|---|---|
| Kubernetes | A cooperative in Jessore does not need an orchestrator. One VPS with Compose is operable by one person |
| Microservices | Two services is already the right number |
| Redis | Postgres handles the rate limits and blacklist at this scale — and that choice is what makes the single-VPS target realistic |
| Multi-region | No latency or availability requirement justifies it |
| Blue/green with separate infrastructure | INF-07's health-gated container swap is sufficient |
| Sentry tracing and session replay | Tracing burns the quota that should hold exceptions; replay would ship a member's balance and name to a third party |
| `@axe-core/playwright` | A generic audit produces a long advisory list nobody actions. The four hand-written checks are specific to members filling in financial forms on a cheap Android in sunlight |
