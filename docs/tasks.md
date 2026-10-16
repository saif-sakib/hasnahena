# Task Board

**Everything left to do, in one place** — there is no second list. **Nothing finished is listed**: delete the row in the same commit as the work; history goes to [changelog.md](changelog.md).

Say **`do T-12`** and the task is executed from its row plus the docs it points at. **Sessions** = focused working sessions end to end (code, tests, suites, docs); the high end is what it costs when the first honest look finds more, which here is common. **`owner`** = needs an account, credential, paid plan or a decision only the foundation can make.

Legend: `[ ]` not started · `[~]` partly done · `[!]` broken right now

## Where the platform stands

Live since 2026-08-27, with monitoring fully on since 2026-09-03 (both Sentry DSNs, `METRICS_TOKEN`, UptimeRobot on `/v1/health`, nightly database and asset backups to R2). The money paths, security, tests, CI, the entry path (registration → approval → first login) and the public site are done. Left: a few owner actions, the input/output sweep, and the product gaps in the FR table.

| Phase | What | Sessions |
|---|---|---|
| **0** | Owner actions | `owner`, ~30 min |
| **3** | The whole-site input/output sweep | **4–6** |
| **4** | The last cheap schema change | **1–2** |
| **5** | The product gaps in the FR table | **13–17** |
| **6** | Operations: logs, dashboard | **2–3** |
| **8** | Off the free tiers | per trigger |

---

## Phase 0 — Owner actions

Not engineering; all quick.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[~]` **T-03** | **Fill in the English description, and read the seeded copy** | `owner` 15 min | **Settings → Organisation → Description (English)** — until filled, the JSON-LD describes the foundation in Bengali on both pages. Then read **Content & Media → Public Pages** in both languages (all seeded) and correct anything you would say differently — especially the four hero figures (`135+` and estimates), published under the foundation's name. Press Save on Settings once to write any missing defaults |
| `[ ]` **T-05** | **Decide how long a half-finished registration stays on the phone** | `owner` 5 min | The registration draft (NID, parents' names, addresses) stays in `localStorage` for **7 days** — a modest exposure on shared handsets. Pick a number, or confirm 7 |
| `[~]` **T-04** | **Confirm `security.rejectedRetentionDays` reads 365** | `owner` 2 min | Decided 2026-08-25: 365 (the seeded default) — just look at Admin → Settings ([ADR-033](decisions.md)) |

---

## Phase 3 — The pre-production sweep

*Owner priority, 2026-08-25: "check all the input and expected output through
all the pages of the whole website. There should be zero bug before go
production."*

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-12** | **Input/expected-output sweep, page by page** | 4–6 | Every field on every screen, all four roles: what it accepts and rejects, the message, what the server does — money (rule 1, `parseWholeTaka`), dates, phone/NID, uploads, every empty and error state. One dashboard per session, fixing as you go |

> No sweep can promise zero bugs; T-12 targets the class no test reaches (a field accepting what it should not, a wrong error message, an unseen empty state). Aim for zero *known* defects and a short path from a member's report to a fix ([runbook.md](runbook.md)).

---

## Phase 4 — The schema, while it is still cheap

A migration today; a migration plus a backfill once real data accumulates.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-13** | **Donation fund types** (FR-15/16) | 1–2 | Donations post as untyped `DONATION` — no Operating/Lending/Zakat split. **Zakat cannot be reconstructed later** (money is fungible in the pool), so the type must be recorded at posting. Cheap only while the donation table is empty |

---

## Phase 5 — The product gaps

The FR rows that are not `[x]`, ordered by what a member notices.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-33** | **Actions minutes ran out in August and took the nightly backup with them** | `owner` | Aug 2026: 2,033 minutes in 17 days (86% `ci.yml`) against 2,000; GitHub Free's $0 limit means Actions — and the nightly backup — simply stopped. Done: `images.yml` tags-only, restore drill gated, asset artifact 7 days. Remaining lever: push to feature branches ([workflow.md](workflow.md) §2). Check Usage monthly; if minutes run out, verify last night's backup first |
| `[!]` **T-31** | **A hard navigation into the dashboard can log the reader out** | 1–2 | A full page load into a dashboard shortly after sign-in sometimes fetches **without `Authorization`**; the 401 handler clears the session and bounces to `/login`. Clicking through the sidebar never trips it (so the browser suite misses it); bookmarks, new tabs and reloads do. Start with why `getValidatedClientToken()` returns `null` for a present token (`dashboard-layout.tsx`, `lib/client-auth.ts`, `lib/api.ts`). Also: a single 401 from a background poll must not end a session. Pin with a spec that reloads into `/dashboard/*` and stays |
| `[ ]` **T-14** | **Worker-created loans skip the lifecycle** (FR-12) | 1 | `worker_repository.go` inserts `status = 'ACTIVE'` with `disbursementDate` and `approvedAt` in one statement — no guarantor step, no approval step. The documented Request → Approve → Disburse lifecycle is reachable only through admin approval of a loan the worker UI cannot create |
| `[ ]` **T-15** | **Fairness and solvency caps** (FR-10) | 1–2 | The personal cap is enforced; the fund-level ones are not. Nothing stops the fund lending itself empty |
| `[ ]` **T-16** | **Guarantor-obligation withdrawal block** (FR-09) | 1 | A guarantor's savings back someone else's loan; today only the guarantor's *own* active loan blocks a withdrawal |
| `[ ]` **T-17** | **Notifications in both languages** | 1–2 | Both surfaces hardcode English, against rule 5. The builders are already in one place each — `internal/notify/messages.go` and `lib/notify.ts` — with a census over both, so this is a translation job rather than a hunt |
| `[ ]` **T-18** | **Member edits their nominee** (FR-06) | 1 | Captured at signup and never editable. A nominee is who receives the money if a member dies, so a stale one is the worst kind of stale record |
| `[ ]` **T-20** | **Admin correction flow for a disputed posting** (FR-18) | 1 | The freeze works; the correction is manual SQL today. Corrections append ([ADR-026](decisions.md), [runbook.md](runbook.md) §2) |
| `[ ]` **T-22** | **48-hour unconfirmed-transaction sweep** (OPS-08) | 1 | The Monitor workflow alerts on the backlog twice a day and nothing acts on it |
| `[ ]` **T-23** | **Worker SLA colouring** (FR-21) | 1 | Queues are live; the green-under-24 h / red-over-48 h signal is missing |
| `[ ]` **T-24** | **The 827 inline EN/BN strings** | 3–4 | `locale === 'bn' ? … : …` across 33 dashboard files instead of `messages/` (rule 5); worst: `dashboard/admin/workers` (72), `member-detail-screen` (66), `dashboard/member/loans` (57). Translated, but invisible to `messages.test.ts` (how a fee promise once hid). `(auth)` is done (WO-96); widening that census is the same job |

---

## Phase 6 — Operations

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-27** | **Log aggregation** (OBS-05) | 1 | Grafana Cloud or Better Stack free tier. Required once there is more than one process to correlate |
| `[ ]` **T-28** | **One operations dashboard** (OBS-07) | 1 | Uptime, error rate, p95 latency, money posted today, queue depths |
| `[ ]` **T-29** | **Branch protection on `main`** (CI-09) | `owner` | Needs a paid plan on a private repo. `.githooks/pre-push` is the free stand-in and is active (`core.hooksPath=.githooks`) |

---

## Phase 8 — Get off the free tiers

Plan, measured limits and triggers: [scaling.md](scaling.md). Stage 0 below is free; nothing else is needed until ~6,000 members.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-31** | **Stage 0 — the free fixes** | `owner` + 0.5 | All $0. (a) ~~UptimeRobot on `/v1/ready`~~ — done, it watches `/v1/health`. (b) Assets backup weekly, not nightly (recovers Actions minutes). (c) A Cloudflare Worker cron on `/v1/health` during Dhaka daytime keeps Render warm without waking the database |
| `[ ]` **T-33** | **Decide the Vercel Hobby terms question** | `owner` | Hobby is non-commercial only. Pay $20/mo, apply to Vercel's open-source programme (this repo is MIT-licensed and may qualify), or bring T-30 forward. Capacity is fine to ~15,000 members; this is a policy risk, not a technical one |
| `[ ]` **T-34** | **Neon Free → Launch** | `owner` | Trigger: storage past 0.4 GB or compute past 80 CU-h — about **6,000 members**, the first real capacity wall. A dashboard toggle, no migration, no base fee. ~$7/mo |
| `[ ]` **T-32** | **Cloudinary → Cloudflare R2** | 1–2 | **Privacy, not cost** — an NID scan is served from a URL needing no login (ADR-038 only mitigates). R2 makes the bucket private, removes the dynamic-folder bug class and `cloudinary-reconcile.mjs`, and a vendor with no export path. Cheapest while assets number in the hundreds |
| `[ ]` **T-30** | **Leave Vercel and Render** (INF-01 → INF-12) | 2–3 | Trigger: ~10,000 members, or T-33 decided by moving. **Fly.io Singapore (~$16–25/mo) preferred over a VPS**; not AWS, not Kubernetes; Postgres stays on Neon ([scaling.md](scaling.md)) |

---
## Requirements

| ID | Requirement | Status | Where / what is missing |
|---|---|---|---|
| FR-01 | Login by phone or email | `[x]` | Go `/v1/auth/login` |
| FR-02 | Forced password change on first login | `[x]` | `mustChangePassword` + first-login token |
| FR-03 | RBAC on sensitive actions | `[x]` | Go handlers + `lib/server-auth.ts`; `/admin` routes also gated at the router (SEC-02) |
| FR-04 | Registration captures biodata, NID, address, nominee | `[x]` | `/api/v1/registrations` — throttled, age floor, live-scoped NID/email/phone uniqueness, nominee ≠ applicant. `test/routes/registration.test.ts`, `e2e/entry-path.spec.ts` |
| FR-05 | Admin approve/reject registration with reason | `[x]` | Go approvals + admin UI; a reason code from `lib/rejection-reasons.ts` is required, stored on the row and quoted in the applicant's email |
| FR-06 | Member edits nominee, audit-logged | `[ ]` | captured at signup only; no edit path |
| FR-07 | Deposit request → process → confirm | `[x]` | full loop across both backends |
| FR-08 | Member withdrawal, asked for in person and paid by staff | `[x]` | no notice period ([ADR-030](decisions.md)); `AddMemberWithdrawal` settles an outstanding request if any. `policy_enforcement_integration_test.go`, `withdrawal_status_integration_test.go` |
| FR-09 | Block withdrawal breaking collateral / guarantee | `[~]` | active-loan block via `loan.allowActiveLoanWithdrawal`; no guarantor-obligation check |
| FR-10 | Max loan from configured caps | `[~]` | members apply from the dashboard, personal cap enforced; **fairness and solvency caps still missing** |
| FR-11 | Guarantor request + approval | `[x]` | required above `loan.guarantorThresholdAmount`, nominated by member ID, approve/decline on the member dashboard |
| FR-12 | Approve → disburse → confirm | `[~]` | the worker path (`CreateMemberLoan`) writes `status = 'ACTIVE'` directly, skipping `PENDING_GUARANTOR` → `PENDING_APPROVAL`. The documented lifecycle is reachable only via admin approval of a loan the worker UI cannot create |
| FR-13 | Record installments; no late fee on a missed one | `[x]` | instalments recorded and counted; **no late fee** (ruled 2026-08-25) — the agreement denies one and `requirements.test.ts` pins both directions |
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
| FR-24 | Admin audit viewer | `[x]` | `dashboard/admin/audit` — day-grouped timeline, searchable by account/receipt/loan number and name, filtered by category, severity and date, sign-ins hidden by default |
| FR-25 | Tiered retention | `[x]` | tiers in `lib/audit-actions.ts` (ADR-038); refused applicants' photos go at the decision; the ledger and decisions are permanent |

**`requirements.test.ts` keeps this table honest**: a requirement not `[x]` must still be unimplemented in the source, and this table must agree with [product.md](product.md) — a task closing an FR updates its row in the same commit.

---

## Not doing

Recorded so they are not re-proposed as gaps.

| Not doing | Why |
|---|---|
| A late fee on a missed installment | **Ruled out by the foundation, 2026-08-25** (a penalty kept by the lender is riba). The agreement denies one; `requirements.test.ts` fails if the denial goes or a fee appears |
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
| The cutover procedure (repeat for a host move) | [runbook.md §7](runbook.md#7-re-cutting-onto-a-new-host-the-go-live-procedure) |
