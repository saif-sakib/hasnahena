# Task Board

**Everything that is left to do, in one place.** There is no second list: what
used to be spread across `work-orders.md`, `production-readiness.md` and the top
of this file is here, and those two files are gone — closed work is history and
history lives in [changelog.md](changelog.md).

**Nothing finished is listed here.** A board that keeps its own history stops
being readable as a board. Delete the row in the same commit as the work; the
changelog is where it goes.

## How to use this

Say **`do T-12`** and the task is executed from the description here plus the
docs it points at — no re-reading of the codebase needed to know what is wanted.
Tasks are ordered so that each is genuinely doable when you reach it.

**Sessions** is how many working sessions the task needs end to end — including
reading the code, writing the tests that keep it fixed, running the suites and
updating the docs. A session is one focused stretch of work, not a calendar day.
Where a range is given, the low end assumes nothing surprising is found; the
high end is what it costs when the first honest look turns up more than the
task description knew about, which on this codebase has been the common case.
**`owner`** means it is not engineering at all — it needs an account, a
credential, a paid plan, or a decision only the foundation can make, and I
cannot do it.

Legend: `[ ]` not started · `[~]` partly done · `[!]` broken right now

---

## Where the platform stands

No requirement is **broken**. The money paths, the security work, the tests, CI,
backups and containers are done and hold. **The entry point is done** — Phase 1
closed on 2026-08-26; the registration → approval → first-login journey has an
end-to-end spec at phone width in both languages. **The public face is done too**
— Phase 2 closed the same day: the eleven pages a stranger can reach were
audited link by link, the menu now points at the pages rather than at anchors on
the home page, and every control on the two admin content screens is proved to
change what a visitor sees. What is left is of three kinds: a handful of owner
actions that take minutes and are blocking nothing but themselves; the
input/output sweep before production; and the long tail of product gaps in the FR
table below.

**The monitoring is now mostly on** — `METRICS_TOKEN` on Render and Sentry on
Vercel are both confirmed live. What remains of T-01 is the Go API's own Sentry
DSN, the GitHub secret the Monitor workflow reads, and the two UptimeRobot
monitors: until those, an API-side exception is still unseen and the workflow
fails twice a day.

## What it adds up to

| Phase | What | Sessions |
|---|---|---|
| **0** | Owner actions — finish the monitoring, `TRUSTED_PROXIES`, two settings confirmations | `owner`, about 30 min total |
| **3** | The whole-site input/output sweep | **4–6** |
| **4** | The last cheap schema change | **1–2** |
| — | **Go live** — the cutover in [go-live.md](go-live.md) | 1 |
| **5** | The product gaps in the FR table | **13–17** |
| **6** | Operations: restore drill, asset backup, logs, dashboard | **4–5** |
| **8** | Move hosts | **4–6** |

**To a launch you would not be embarrassed by: Phases 0, 3, 4 plus the cutover — 6–9 sessions.**
Phase 5 is real product work that a live foundation can absorb gradually; Phase 6
follows the first real data; Phase 8 waits until everything is quiet.

The high end of each range is not padding. On this codebase the first honest look
at an area has repeatedly found more than the task description knew about — the
English-first work was scoped as three orders and turned up five further defects,
two of them live on the deployed site.

---

## Phase 0 — Owner actions

None of these is engineering. All of them are quick.

**Re-verified against the live site on 2026-08-25**, because a board that
records a defect somebody has since fixed sends the next session hunting for
it. Most of what this phase used to list is already done: `METRICS_TOKEN` is set
on Render, Sentry is reporting from Vercel, and the three `system_config` rows
now read correctly. What that verification *did* find is that one of them was
never an owner problem at all — the Settings screen carried its own copy of the
organisation's defaults, disagreeing with the seed about the foundation's own
name, and **posts them back on every save**. Fixing the row by hand would have
held until the next time an admin pressed Save. That is fixed in code and
guarded by `org-defaults.test.ts`.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[~]` **T-01** | **Finish switching the monitoring on** | `owner` ~20 min | Mostly done. **Confirmed live on 2026-08-25:** `/metrics` answers `401` rather than `404`, so `METRICS_TOKEN` is set on Render; and the public pages carry `sentry-environment=production` with a release matching the deployed commit, so `NEXT_PUBLIC_SENTRY_DSN` is set on Vercel. **Three things are left and none can be checked from outside:** `SENTRY_DSN` on **Render** (the Go API — the web app being connected says nothing about it), `METRICS_TOKEN` as a **GitHub Actions secret** (same value as Render; without it the Monitor workflow exits 1 twice a day), and the two **UptimeRobot** monitors — `/v1/ready` at 1 minute and the site at 5. [deployment.md](deployment.md) |
| `[ ]` **T-02** | **`TRUSTED_PROXIES=1` on Render** | `owner` 5 min | At the default `0`, a process behind a proxy attributes every member to the proxy's address: one rate-limit bucket and one login lockout for the entire membership. The API already logs a warning at boot when it is `0` outside development ([ADR-019](decisions.md), [ADR-021](decisions.md)) |
| `[~]` **T-03** | **Fill in the English description, and read the seeded copy** | `owner` 15 min | **Settings → Organisation**: *Description (English)*, added 2026-08-25. Until it is filled in, the JSON-LD every search engine and AI assistant reads describes the foundation **in Bengali**, on the English page as well as the Bengali one. **Content & Media → Public Pages**: every box there is a pair — Bangla and English — and both halves are now **seeded with real copy** in the foundation's voice, so nothing is blank and nothing shows the wrong script. What is left is editorial rather than repair: read both languages and change what you would say differently. The four hero figures on the same screen are seeded with `135+` members and estimates consistent with it. They are **stated, not counted** — the fund's real balances are deliberately not published (owner, 2026-08-26) — so they are published under the foundation's name and nobody but the foundation can confirm them. Read all four and correct what is wrong. Open Settings once and press Save even if you change nothing: that writes the corrected defaults for any row the database is missing |
| `[ ]` **T-05** | **Decide how long a half-finished registration stays on the phone** | `owner` 5 min | The form saves a draft to `localStorage` so an applicant interrupted six steps in does not start again — and that draft holds the NID number, both parents' names and both addresses, for **7 days**. On a shared handset, which is common, that is a real if modest exposure. Shortening it weakens a feature that exists for a good reason, so it is a trade only the foundation can price. Raised twice during Phase 1 and Phase 2 and recorded here so it stops being a footnote: pick a number, or say 7 days is right |
| `[~]` **T-04** | **Confirm `security.rejectedRetentionDays` reads 365** | `owner` 2 min | **Decided 2026-08-25: 365 days**, which is the seeded default, so there is most likely nothing to change — this is a look, not an edit. Admin → Settings. The sweep counts from each rejection, so it has to be right **before** real applications exist ([ADR-033](decisions.md)) |

---

## Phase 3 — The pre-production sweep

*Owner priority, 2026-08-25: "check all the input and expected output through
all the pages of the whole website. There should be zero bug before go
production."*

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-12** | **Input/expected-output sweep, page by page** | 4–6 | Every form field on every screen for all four roles: what it accepts, what it rejects, what it says when it rejects, and what the server does with it. Money fields against rule 1 (whole taka, `parseWholeTaka`), dates, phone and NID formats, file uploads, every empty state and every error state. Done in passes of roughly one dashboard per session so findings can be fixed while they are fresh, rather than accumulating into a list too long to act on. **This cannot honestly promise "zero bugs"** — no sweep can — but it is the difference between finding them here and a member finding them with their savings |

> **On "zero bugs before production".** The suites already refuse a large class
> of defect, and the ledger is summed hourly and compared to the stored balances.
> What T-12 adds is the class no test currently reaches: a field that accepts
> something it should not, an error message that says the wrong thing, an empty
> state nobody has seen. Aim for zero *known* defects at cutover and a short path
> from a member's report to a fix — [runbook.md](runbook.md) is that path.

---

## Phase 4 — The schema, while it is still cheap

Everything here is a migration today, and a migration **plus a backfill plus a
plan for rows written in between** once real members exist. Guarded by
`pnpm db:migrate:check` in CI.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-13** | **Donation fund types** (FR-15/16) | 1–2 | A donation posts as an untyped `DONATION` with no Operating/Lending/Zakat split and no per-fund accounting. **Zakat funds cannot be reconstructed after the fact** — the money is fungible once it is in the pool, so the type has to be recorded at the moment of the posting or it is gone. Cheap only while the donation table is empty |

---

## Phase 5 — The product gaps

The FR table below is the specification; these are the rows that are not `[x]`.
Ordered by what a member notices.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[!]` **T-32** | **`TRUSTED_PROXIES` is one short since the API went behind Cloudflare** | `owner` + 1 | `api.hasnahenafoundation.com` now answers with `server: cloudflare` and a `cf-ray`, so the chain is `client → Cloudflare → Render` and the value must be **2**, not the `1` [setup.md](setup.md) documented for Render alone. At 1, `ClientIP` returns Cloudflare's **edge** address ([ADR-019](decisions.md)), and four things read it: the rate limiter, the login lockout, the access log and every audit row — so members behind one edge share a single bucket and a single lockout, and `audit_logs` answers "who did this" with an IP belonging to Cloudflare. Both ways of being wrong are silent. **Set it on Render, then verify from a real request's log line** rather than counting hops: the `ip` field must be the caller's own address. The durable fix is to prefer `CF-Connecting-IP` when the request demonstrably came through Cloudflare, which needs a change to the one resolver and an amendment to ADR-019 — decide which before writing it |
| `[!]` **T-31** | **A hard navigation into the dashboard can log the reader out** | 1–2 | Reproducible on an unmodified checkout, and intermittent: land on a dashboard URL by full page load shortly after signing in and the shell's mount-time effects sometimes fetch **without an `Authorization` header**. `apiRequest` throws on the resulting 401, the handler calls `clearClientAuthState()`, and the reader is bounced to `/login` with a session that was perfectly valid — a direct `fetch` with the same token from the same page returns 200. Clicking through the sidebar does not trip it, which is why it has survived: the browser suite navigates by clicking. It will be hit by anyone who bookmarks a dashboard screen, opens one in a new tab, or reloads. `getValidatedClientToken()` returning `null` for a token that is present is the thing to explain first — `components/layout/dashboard-layout.tsx`, `lib/client-auth.ts`, `lib/api.ts`. The fix should also stop a **single** 401 from a background poll ending a session: revalidating a notification count is not evidence that the member is signed out. Found 2026-08-27 while verifying Content & Media; a spec that reloads into `/dashboard/*` and asserts it stays there is what pins it |
| `[ ]` **T-14** | **Worker-created loans skip the lifecycle** (FR-12) | 1 | `worker_repository.go` inserts `status = 'ACTIVE'` with `disbursementDate` and `approvedAt` in one statement — no guarantor step, no approval step. The documented Request → Approve → Disburse lifecycle is reachable only through admin approval of a loan the worker UI cannot create |
| `[ ]` **T-15** | **Fairness and solvency caps** (FR-10) | 1–2 | The personal cap is enforced; the fund-level ones are not. Nothing stops the fund lending itself empty |
| `[ ]` **T-16** | **Guarantor-obligation withdrawal block** (FR-09) | 1 | A guarantor's savings back someone else's loan; today only the guarantor's *own* active loan blocks a withdrawal |
| `[ ]` **T-17** | **Notifications in both languages** | 1–2 | Both surfaces hardcode English, against rule 5. The builders are already in one place each — `internal/notify/messages.go` and `lib/notify.ts` — with a census over both, so this is a translation job rather than a hunt |
| `[ ]` **T-18** | **Member edits their nominee** (FR-06) | 1 | Captured at signup and never editable. A nominee is who receives the money if a member dies, so a stale one is the worst kind of stale record |
| `[ ]` **T-20** | **Admin correction flow for a disputed posting** (FR-18) | 1 | The freeze works; the correction is manual SQL today. Corrections append ([ADR-026](decisions.md), [runbook.md](runbook.md) §2) |
| `[ ]` **T-21** | **Support SSE client** | 1 | The stream and its ticket endpoint are live and authenticated; the UI polls anyway. `EventSource` appears nowhere in `apps/web` |
| `[ ]` **T-22** | **48-hour unconfirmed-transaction sweep** (OPS-08) | 1 | The Monitor workflow alerts on the backlog twice a day and nothing acts on it |
| `[ ]` **T-23** | **Worker SLA colouring** (FR-21) | 1 | Queues are live; the green-under-24 h / red-over-48 h signal is missing |
| `[ ]` **T-24** | **The 827 inline EN/BN strings** | 3–4 | `locale === 'bn' ? … : …` across 33 dashboard files instead of `messages/{en,bn}.json` (rule 5); the worst are `dashboard/admin/workers` (72), `member-detail-screen` (66) and `dashboard/member/loans` (57). They *are* translated, so this is a maintainability gap rather than a member-facing one — but it is also a **blind spot**: nothing in `messages.test.ts` can read a string that lives in a component, which is how the Terms of Service came to promise administrative fees in both languages while every guard passed. The `(auth)` pages were cleared by WO-96 and are held there by a census; widening that census is the same job as fixing the 827 |

---

## Phase 6 — Operations

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-25** | **Rehearse the restore** (OPS-04) | `owner` + 1 | The backup runs; nobody has restored one. Needs the Neon account: restore an artifact into a **branch**, never the primary. The one unproven step in [runbook.md](runbook.md) |
| `[ ]` **T-27** | **Log aggregation** (OBS-05) | 1 | Grafana Cloud or Better Stack free tier. Required once there is more than one process to correlate |
| `[ ]` **T-28** | **One operations dashboard** (OBS-07) | 1 | Uptime, error rate, p95 latency, money posted today, queue depths |
| `[ ]` **T-29** | **Branch protection on `main`** (CI-09) | `owner` | Needs a paid plan on a private repo. `.githooks/pre-push` is the free stand-in and is active (`core.hooksPath=.githooks`) |

---

## Phase 7 — Go live

The cutover itself — freeze, clear the fake data, rotate every secret, create the
real first admin, take the first backup by hand — is a procedure rather than a
task list, and it lives in **[go-live.md](go-live.md)**. Do it once Phases 0–3
are clear.

---

## Phase 8 — Move hosts

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-30** | **VPS or AWS** (INF-01 → INF-12) | 4–6 | Only once everything above is quiet. The containers and the env contract are already built, which is most of the work; the risk is entirely in the cutover, not the packaging |

---
## Requirements

| ID | Requirement | Status | Where / what is missing |
|---|---|---|---|
| FR-01 | Login by phone or email | `[x]` | Go `/v1/auth/login` |
| FR-02 | Forced password change on first login | `[x]` | `mustChangePassword` + first-login token |
| FR-03 | RBAC on sensitive actions | `[x]` | Go handlers + `lib/server-auth.ts`; `/admin` routes also gated at the router (SEC-02) |
| FR-04 | Registration captures biodata, NID, address, nominee | `[x]` | `/api/v1/registrations`, throttled, with the age floor from `membership.minimumAgeYears`, a live-scoped NID/email/phone uniqueness check, and a nominee who cannot be the applicant. `test/routes/registration.test.ts`, `e2e/entry-path.spec.ts` |
| FR-05 | Admin approve/reject registration with reason | `[x]` | Go approvals + admin UI. **The reject side only became true on 2026-08-26** — the screen posted a hardcoded `reason: ''` and the only record was an audit row whose `details` was the empty string. A reason is now chosen from `lib/rejection-reasons.ts`, stored on the row where a screen can read it, and quoted in the email to the applicant; the API refuses a rejection without one |
| FR-06 | Member edits nominee, audit-logged | `[ ]` | captured at signup only; no edit path |
| FR-07 | Deposit request → process → confirm | `[x]` | full loop across both backends |
| FR-08 | Member withdrawal, asked for in person and paid by staff | `[x]` | no notice, no notice period ([ADR-030](decisions.md)). `AddMemberWithdrawal` pays with or without an outstanding request and settles one when there is; `loan.noticePeriodDays` is published to members and enforced by nobody. `policy_enforcement_integration_test.go`, `cmd/server/withdrawal_status_integration_test.go` |
| FR-09 | Block withdrawal breaking collateral / guarantee | `[~]` | active-loan block via `loan.allowActiveLoanWithdrawal`; no guarantor-obligation check |
| FR-10 | Max loan from configured caps | `[~]` | members apply from the dashboard, personal cap enforced; **fairness and solvency caps still missing** |
| FR-11 | Guarantor request + approval | `[x]` | required above `loan.guarantorThresholdAmount`, nominated by member ID, approve/decline on the member dashboard |
| FR-12 | Approve → disburse → confirm | `[~]` | the worker path (`CreateMemberLoan`) writes `status = 'ACTIVE'` directly, skipping `PENDING_GUARANTOR` → `PENDING_APPROVAL`. The documented lifecycle is reachable only via admin approval of a loan the worker UI cannot create |
| FR-13 | Record installments; no late fee on a missed one | `[x]` | installments recorded and counted against the missed total. **There is no late fee** — ruled by the foundation 2026-08-25 (was T-05). The printed agreement now *denies* one rather than reserving one, and `requirements.test.ts` pins both directions: deleting the denial fails, implementing a fee fails |
| FR-14 | Default settlement waterfall | `[x]` | ordering and proportionality correct with or without a guarantor; status change, all three recovery legs and the audit row commit in one transaction |
| FR-15 | Donations carry a fund type | `[ ]` | posts as untyped `DONATION`; no Operating/Lending/Zakat split |
| FR-16 | Donation funds isolated from deposits | `[~]` | not withdrawable, and the pool now exists as a real account owned by `system_donation_fund`; no per-fund accounting |
| FR-17 | Member raises dispute | `[x]` | the transaction freezes, the audit row is written and the member gets a 200 with the frozen posting. `test/routes/success-paths.test.ts` |
| FR-18 | Freeze disputed txn, notify admin | `[~]` | status freezes; admin correction flow is manual |
| FR-19 | Append-only audit log | `[x]` | written by both backends and **enforced by a database trigger** — UPDATE is rejected outright |
| FR-20 | Member dashboard | `[x]` | balances, loans, transactions, deposits, profile, support |
| FR-21 | Worker dashboard with SLA queues | `[~]` | queues live; SLA colouring (green <24h / red >48h) missing |
| FR-22 | Admin dashboard | `[~]` | approvals, reports, settings, support and the audit viewer are done; **no liquidity alerts** |
| FR-23 | Member erasure and rejected-application retention | `[x]` | admin erases from the member detail screen — anonymise if there are postings, delete if there are none; the Go sweep clears a rejected applicant's identity after `security.rejectedRetentionDays` |
| FR-24 | Admin audit viewer | `[x]` | `dashboard/admin/audit` — a day-grouped timeline, searchable by account/receipt/loan number and name, filterable by category, severity and date range, coloured by severity, with sign-ins hidden until asked for |
| FR-25 | Tiered retention | `[x]` | four tiers in `lib/audit-actions.ts` beside the action they describe (ADR-038); a refused applicant's identity **photographs** go at the decision, the ledger and every decision are permanent |

**14 complete · 7 partial · 2 not started · 0 broken.**
**This page cannot quietly fall behind the code.** A requirement not marked
`[x]` must *still* be unimplemented in the source, or
`apps/web/test/unit/requirements.test.ts` fails and names the file that
implements it. The same suite fails if [product.md](product.md) and this table
disagree — so a task above that closes an FR has to update this row in the same
commit.

---

## Not doing

Recorded so they are not re-proposed as gaps.

| Not doing | Why |
|---|---|
| A late fee on a missed installment | **Ruled by the foundation, 2026-08-25** (was T-05). The question was never the amount, it was who keeps the money: a penalty retained by the lender is riba on the mainstream reading, and one paid entirely to charity is the form scholars permit but needs a charity ledger destination and an audit trail proving the fund retained nothing. The ruling is that there is no late fee at all. The printed loan agreement now **denies** one rather than reserving one, which is the half of the ruling a member can read, and `requirements.test.ts` fails in both directions — deleting the denial, or implementing a fee |
| Kubernetes | A cooperative in Jashore does not need an orchestrator. One VPS with Compose is operable by one person |
| Microservices | Two services is already the right number |
| Redis | Postgres handles the rate limits and the blacklist at this scale — and that choice is what makes the single-VPS target realistic |
| Multi-region | No latency or availability requirement justifies it |
| Blue/green on separate infrastructure | A health-gated container swap is sufficient |
| Sentry tracing and session replay | Tracing burns the quota that should hold exceptions; replay would ship a member's balance and name to a third party |
| `@axe-core/playwright` | A generic audit produces a long advisory list nobody actions. The four hand-written checks in `accessibility.spec.ts` are specific to members filling in financial forms on a cheap Android in sunlight |
| A second status board | This file is the only one. Closed work goes to [changelog.md](changelog.md) and nowhere else |

---

## Where everything else lives

| Looking for | Go to |
|---|---|
| What is already done | [changelog.md](changelog.md) — the only file that keeps history |
| Why the code contradicts an older assumption | [decisions.md](decisions.md) — indexed; read the one row |
| Every failure that has cost a session | [traps.md](traps.md) |
| How to change a specific thing | [changing-things.md](changing-things.md) |
| The night something breaks | [runbook.md](runbook.md) |
| The cutover procedure | [go-live.md](go-live.md) |
