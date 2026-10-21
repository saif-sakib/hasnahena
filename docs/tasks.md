# Task Board

**Everything left to do, in one place** — there is no second list. **Nothing finished is listed**: delete the row in the same commit as the work; history goes to [changelog.md](changelog.md).

Say **`do T-12`** and the task is executed from its row plus the docs it points at. **Sessions** = focused working sessions end to end (code, tests, suites, docs); the high end is what it costs when the first honest look finds more, which here is common. **`owner`** = needs an account, credential, paid plan or a decision only the foundation can make — the row says exactly what to click.

IDs are never reused: a new task takes the next number above the highest on this board **and** in [changelog.md](changelog.md) (highest so far: **T-49**). Phase 8 once reused four closed numbers. (Code comments citing "T-05" for the no-late-fee ruling predate the current T-05.)

Legend: `[ ]` not started · `[~]` partly done · `[!]` broken right now

## Where the platform stands

Live since 2026-08-27, monitoring fully on since 2026-09-03 (both Sentry DSNs, `METRICS_TOKEN`, UptimeRobot on `/v1/health`, nightly encrypted database and asset backups to R2), CSP enforced on both tiers, **repository public since 2026-10-18** (MIT). The money paths, security, tests, CI, the entry path (registration → approval → first login) and the public site are done. No open security alerts (2026-10-22). Left: a session bug, a handful of owner actions, the input/output sweep, and the product gaps in the FR table. Reviewed against the code 2026-10-21.

## The order to work in

Top to bottom. Owner rows can be done in any spare ten minutes alongside the engineering ones.

| # | Task | Why now |
|---|---|---|
| 1 | **T-42** preview deploys off the live database | every PR — Dependabot's included — builds a preview |
| 2 | **T-31** hard navigation logs the reader out | broken for members today |
| 3 | **T-41** the laptop off the production database | one stray script already deleted every member once |
| 4 | **T-29** branch protection | free since the repo went public |
| 5 | **T-03, T-04, T-05, T-39, T-43, T-44, T-45** | owner, ~1 hour together |
| 6 | **T-13** donation fund types | cheap only while the donation table is near-empty |
| 7 | **T-12** the input/output sweep | the owner's pre-production bar |
| 8 | **T-14 → T-16 → T-15 → T-18 → T-20 → T-22 → T-23 → T-46 → T-47 → T-17 → T-24** | product gaps, money-safety first |
| 9 | **T-27, T-28, T-48** | operations |
| 10 | **T-35 … T-30** | free-tier exits, each on its trigger |
| — | **T-49** | local only, whenever |

| Phase | What | Sessions |
|---|---|---|
| **0** | Urgent: security, a live bug, the production database | **1–3** + `owner` |
| **1** | Owner actions | `owner`, ~1 h |
| **3** | The whole-site input/output sweep | **4–6** |
| **4** | The last cheap schema change | **1–2** |
| **5** | The product gaps in the FR table | **14–19** |
| **6** | Operations: logs, dashboard, incident log | **2–3** |
| **8** | Off the free tiers | per trigger |

---

## Phase 0 — Urgent

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-42** | **Preview deploys must not reach the live database** | `owner` 2 min | Vercel builds a preview for every PR — Dependabot's #17–#19 already have one. **Vercel → Settings → Environment Variables → `DATABASE_URL`**: tick **Production only**; give Preview a different value (a Neon `preview` branch, or Neon's Vercel integration). Shared across all three, a guessable preview URL writes to the live ledger ([workflow.md §3](workflow.md#3-preview-deploys)). Check `CRON_SECRET` and the `CLOUDINARY_*` keys the same way |
| `[!]` **T-31** | **A hard navigation into the dashboard can log the reader out** | 1–2 | A full page load into a dashboard shortly after sign-in sometimes fetches **without `Authorization`**; the 401 handler clears the session and bounces to `/login`. Clicking through the sidebar never trips it (so the browser suite misses it); bookmarks, new tabs and reloads do. Lead: `proxy.ts` gates on the `hn_access_token` **cookie** but `getValidatedClientToken()` (`lib/client-auth.ts`) reads **localStorage only** — find when the two disagree (also test a bookmark on the apex, which 308s to `www`). Also: a single 401 from a background poll must not end a session. Pin with a spec that reloads into `/dashboard/*` and stays |
| `[ ]` **T-41** | **Stop developing against the production database** | `owner` 10 min + 0.5 | `.env.local` and `apps/web/.env` both point at the production Neon branch. On 2026-09-01 a shell loop deleted every member through exactly this (recovered by PITR). Follow [workflow.md §1](workflow.md#1-stop-developing-against-the-production-database): a Neon `dev` branch (or local Postgres) in **both** files, `pnpm db:purge:confirm` + `pnpm db:seed` on it, then prove it with the `grep` there. Then delete §1's "Today" column |

---

## Phase 1 — Owner actions

Not engineering; all quick.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-29** | **Branch protection on `main`** (CI-09) | `owner` 5 min | **Free now the repository is public** (`main` is unprotected today). Settings → Branches → rule for `main`: require a PR, require the CI checks, **do not allow bypass**. Keep `.githooks/pre-push`. Then delete the "Until then" sentence in [workflow.md §2](workflow.md#2-branch-pull-request-merge) |
| `[~]` **T-03** | **Fill in the English description, and read the seeded copy** | `owner` 15 min | **Settings → Organisation → Description (English)** — until filled, the JSON-LD describes the foundation in Bengali on both pages. Then read **Content & Media → Public Pages** in both languages (all seeded) and correct anything you would say differently — especially the four hero figures (`135+` and estimates), published under the foundation's name. Press Save on Settings once to write any missing defaults |
| `[~]` **T-04** | **Confirm `security.rejectedRetentionDays` reads 365** | `owner` 2 min | Decided 2026-08-25: 365 (the seeded default) — just look at Admin → Settings ([ADR-033](decisions.md)) |
| `[ ]` **T-05** | **Decide how long a half-finished registration stays on the phone** | `owner` 5 min | The registration draft (NID, parents' names, addresses) stays in `localStorage` for **7 days** (`DRAFT_TTL_MS`, `(auth)/register/page.tsx`) — a modest exposure on shared handsets. Pick a number, or confirm 7 |
| `[ ]` **T-39** | **Two-factor authentication on every account that holds a credential** | `owner` 15 min | Cloudflare has it (2026-09-03); check GitHub, Vercel, Render, Neon, Brevo, Cloudinary, Sentry and UptimeRobot. Matters more now the repository is public and its owner is named |
| `[ ]` **T-43** | **DMARC from `p=none` to `p=quarantine`** | `owner` 15 min | Reports have arrived at Brevo since 2026-09-03 and the live record still says `p=none`. Read them; if only Brevo and Cloudflare Email Routing send as the domain, change the Cloudflare TXT `_dmarc` to `p=quarantine` ([deployment.md § DNS](deployment.md#dns-cloudflare)). Never before reading them |
| `[ ]` **T-44** | **Finish the public-repository review** | `owner` 15 min + 0.25 | Three things c3a4fa2 left: (a) the **Monitor** workflow writes counts of stuck postings and open disputes to its public run summary and opens a **public** issue — keep, or move the alert to email (UptimeRobot/Sentry) and drop the counts from the summary; (b) a contributor's personal email address removed from the tree is still in **git history** — accept, or rewrite history (forks and caches may already hold it); (c) add a short `SECURITY.md` pointing at private vulnerability reporting (already enabled) and `/.well-known/security.txt`. Also Settings → Actions → require approval for **all** outside contributors' workflow runs |
| `[ ]` **T-45** | **A second person who can act** (OPS-06, OPS-05) | `owner` 30 min | One person holds every credential and is the only one who can deploy ([runbook.md §6](runbook.md#6-where-every-credential-lives)). Give a trusted second person admin access to at least GitHub, Neon and Vercel/Render (or seal the credentials and `BACKUP_PASSPHRASE` with the foundation), and do the first quarterly access review: who holds admin in the app, Neon, Vercel, Render, Cloudinary, Cloudflare. Write the date into the runbook cadence table |

---

## Phase 3 — The pre-production sweep

*Owner priority, 2026-08-25: "check all the input and expected output through
all the pages of the whole website. There should be zero bug before go
production."*

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-12** | **Input/expected-output sweep, page by page** | 4–6 | Every field on every screen, all four roles: what it accepts and rejects, the message, what the server does — money (rule 1, `parseWholeTaka`), dates, phone/NID, uploads, every empty and error state. One dashboard per session (public + auth, member, worker, admin), fixing as you go, at 412 px in both languages (rule 10) |

> No sweep can promise zero bugs; T-12 targets the class no test reaches (a field accepting what it should not, a wrong error message, an unseen empty state). Aim for zero *known* defects and a short path from a member's report to a fix ([runbook.md](runbook.md)).

---

## Phase 4 — The schema, while it is still cheap

A migration today; a migration plus a backfill once real data accumulates.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-13** | **Donation fund types** (FR-15/16) | 1–2 | Donations post as untyped `DONATION` — no Operating/Lending/Zakat split. **Zakat cannot be reconstructed later** (money is fungible in the pool), so the type must be recorded at posting. Needs the owner to confirm the three buckets and which one the default waterfall may draw from. Cheap only while the donation table is near-empty |

---

## Phase 5 — The product gaps

The FR rows that are not `[x]`, plus two gaps the FR table does not name, ordered money-safety first.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-14** | **Worker-created loans skip the lifecycle** (FR-12) | 1 | `CreateMemberLoan` (`loan_repository.go`) inserts `status = 'ACTIVE'` with `disbursementDate` and `approvedAt` in one statement — no guarantor step, no approval step. The documented Request → Approve → Disburse lifecycle is reachable only through admin approval of a loan the worker UI cannot create. Needs the owner's call: route worker loans through `PENDING_GUARANTOR`/`PENDING_APPROVAL`, or record staff-entered loans as an accepted exception (then FR-12 becomes `[x]` with that wording) |
| `[ ]` **T-16** | **Guarantor obligation, measured rather than blanket** (FR-09) | 1 | Today a member guaranteeing **any** active loan cannot withdraw anything (`ErrGuarantorBlocksWithdrawal`, `AddMemberWithdrawal`) — safe but stricter than the rule. Missing: freeze only what the guarantee commits (the guaranteed loan's remaining amount, or the share the waterfall would take) and let the surplus go; the same for a borrower's collateral ratio. Owner decides the formula; the `absent:` pattern for FR-09 in `requirements.test.ts` names what the implementation will be called |
| `[ ]` **T-15** | **Fairness and solvency caps** (FR-10) | 1–2 | The personal cap is enforced; the fund-level ones are not ([product.md](product.md): fairness 2 × pool ÷ active members, solvency = available lending funds; effective cap = min of all). Nothing stops the fund lending itself empty. Maths in `internal/money/`, read inside the loan transaction |
| `[ ]` **T-18** | **Member edits their nominee** (FR-06) | 1 | Captured at signup and never editable. A nominee is who receives the money if a member dies, so a stale one is the worst kind of stale record. The profile screen shows it read-only (`member/profile/page.tsx`); the endpoint brings an Edit control back, audit-logged, the nominee's NID never logged |
| `[ ]` **T-20** | **Admin correction flow for a disputed posting** (FR-18) | 1 | The freeze works; the correction is manual SQL today. Corrections append ([ADR-026](decisions.md), [runbook.md](runbook.md) §2) — a Go endpoint posting the correcting entry and resolving the dispute in one transaction |
| `[ ]` **T-22** | **48-hour unconfirmed-transaction sweep** (OPS-08) | 1 | `PROCESSED` postings nobody confirms. The Monitor workflow alerts on the backlog twice a day and nothing acts on it. Decide the action (flag for admin review per [product.md](product.md), notify the member, or auto-confirm) — never on a new clock (ADR-035: fold it into the existing daily job) |
| `[ ]` **T-23** | **Worker SLA colouring** (FR-21) | 1 | Queues are live; the green-under-24 h / red-over-48 h signal is missing |
| `[ ]` **T-46** | **Liquidity alerts on the admin dashboard** (FR-22) | 1 | The last missing piece of FR-22: nothing warns when available lending funds (savings pool minus outstanding loans) fall below a threshold. A new `system_config` key, a gauge on `/metrics` and a banner on the admin overview; pairs naturally with T-15's solvency figure |
| `[ ]` **T-47** | **The 14 settings nothing reads** | `owner` 5 min + 1 | `UNIMPLEMENTED_CONFIG_KEYS` (`lib/system-config.ts`): six `notification.*`, four `security.*` (2FA, session timeout, password expiry, login attempts), four `appearance.*`. None is shown, so nothing is mis-trusted — but `notification.paymentReminderNotify` names a real gap: **no member is ever reminded an instalment is due**. Owner picks which to build (reminders first; most members have no email, so in-app notification, ADR-003); delete the rest from the list |
| `[ ]` **T-17** | **Notifications in both languages** | 1–2 | Both surfaces hardcode English, against rule 5. The builders are already in one place each — `internal/notify/messages.go` and `lib/notify.ts` — with a census over both, so this is a translation job rather than a hunt; choose by the recipient's `preferredLocale` |
| `[ ]` **T-24** | **The ~750 inline EN/BN strings** | 3–4 | `locale === 'bn' ? … : …` / `isBn ? …` — **752 across 34 files** (2026-10-21) instead of `messages/` (rule 5); worst: `(auth)/register` (87), `member-detail-screen` (69), `dashboard/admin/workers` (65), `dashboard/member/loans` (55), `loans-screen` (50), `content-screen` (45). Translated, but invisible to `messages.test.ts` (how a fee promise once hid); widening that census is the same job. One folder per commit ([changing-things.md](changing-things.md)) |

---

## Phase 6 — Operations

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-27** | **Log aggregation** (OBS-05) | 1 | Grafana Cloud or Better Stack free tier, both apps. Render keeps only a short log window; the audit trail is in the database, but request logs are not |
| `[ ]` **T-28** | **One operations dashboard** (OBS-07) | 1 | Uptime, error rate, p95 latency, money posted today, queue depths — from `/metrics` plus UptimeRobot and Sentry |
| `[ ]` **T-48** | **Start the incident log** (OPS-09) | 0.25 | The runbook cadence calls for "a dated file" and none exists. Add `docs/incidents.md` (date, symptom, cause, fix, minutes down), seed it with the 2026-09-01 deletion and the August Actions outage from [changelog.md](changelog.md), and link it from the runbook |

---

## Phase 8 — Get off the free tiers

Plan, measured limits and triggers: [scaling.md](scaling.md). Nothing needs paying for until ~6,000 members.

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-35** | **Stage 0 — keep Render warm without waking the database** | `owner` + 0.5 | A Cloudflare Worker cron on `/v1/health` every 5 minutes during Dhaka daytime (00:00–17:00 UTC) — ~510 of Render's 750 instance-hours, no Neon wake ([scaling.md](scaling.md)). $0 |
| `[ ]` **T-36** | **Decide the Vercel Hobby terms question** | `owner` | Hobby is non-commercial only. Pay $20/mo, apply to Vercel's open-source programme (the repository is now public and MIT-licensed, so it may qualify), or bring T-30 forward. Capacity is fine to ~15,000 members; this is a policy risk, not a technical one |
| `[ ]` **T-37** | **Neon Free → Launch** | `owner` | Trigger: storage past 0.4 GB or compute past 80 CU-h — about **6,000 members**, the first real capacity wall. A dashboard toggle, no migration, no base fee. ~$7/mo. Set a billing alert the same day |
| `[ ]` **T-38** | **Cloudinary → Cloudflare R2** | 1–2 | **Privacy, not cost** — an NID scan is served from a URL needing no login (ADR-038 only mitigates). R2 makes the bucket private, removes the dynamic-folder bug class and `cloudinary-reconcile.mjs`, and a vendor with no export path. Cheapest while assets number in the hundreds |
| `[ ]` **T-30** | **Leave Vercel and Render** (INF-01 → INF-12) | 2–3 | Trigger: ~10,000 members, or T-36 decided by moving. **Fly.io Singapore (~$16–25/mo) preferred over a VPS**; not AWS, not Kubernetes; Postgres stays on Neon ([scaling.md](scaling.md), [deployment.md](deployment.md#getting-off-the-free-tiers)) |

---

## Local only

| # | Task | Sessions | Detail |
|---|---|---|---|
| `[ ]` **T-49** | **Voice the six promo films** | `owner` ~3 days of quota | `marketing/video/` (excluded from git). All six films unvoiced (66 beats at ~30 requests a day). Run `marketing/video/finish-narration.sh` once a day and update the status table in `marketing/video/NARRATION.md`; the films render when the last beat is cached |

---

## Recurring

Not tasks to close — dates to keep. When one is done, write the new date here.

| What | Cadence | Next due |
|---|---|---|
| Restore drill (OPS-04) — database into a Neon branch **and** the assets archive ([runbook.md §4](runbook.md#4-restore-from-backup)) | quarterly | **2026-12-03** |
| Access review (OPS-05) | quarterly | **now** — first one is part of T-45 |
| Secret rotation (OPS-02) — `JWT_SECRET` on both hosts together | 6 months, and after any exposure | **2027-02-27** (last: go-live, 2026-08-27) |
| Dependency updates (OPS-03) — merge Dependabot PRs on a branch, CI green | monthly; **security PRs within a week** | ongoing — merge them **one at a time**, CI green on `main` between ([traps/dependencies.md](traps/dependencies.md)) |
| Scheduled workflows still enabled — GitHub disables schedules on a **public** repository after 60 days without a commit, nightly backup included | check monthly | — |
| Last night's backup landed in R2 (`database/` and `assets/`) | weekly glance | — |

---
## Requirements

| ID | Requirement | Status | Where / what is missing |
|---|---|---|---|
| FR-01 | Login by phone or email | `[x]` | Go `/v1/auth/login` |
| FR-02 | Forced password change on first login | `[x]` | `mustChangePassword` + first-login token |
| FR-03 | RBAC on sensitive actions | `[x]` | Go handlers + `lib/server-auth.ts`; `/admin` routes also gated at the router (SEC-02) |
| FR-04 | Registration captures biodata, NID, address, nominee | `[x]` | `/api/v1/registrations` — throttled, age floor, live-scoped NID/email/phone uniqueness, nominee ≠ applicant. `test/routes/registration.test.ts`, `e2e/entry-path.spec.ts` |
| FR-05 | Admin approve/reject registration with reason | `[x]` | Go approvals + admin UI; a reason code from `lib/rejection-reasons.ts` is required, stored on the row and quoted in the applicant's email |
| FR-06 | Member edits nominee, audit-logged | `[ ]` | captured at signup only; no edit path (T-18) |
| FR-07 | Deposit request → process → confirm | `[x]` | full loop across both backends |
| FR-08 | Member withdrawal, asked for in person and paid by staff | `[x]` | no notice period ([ADR-030](decisions.md)); `AddMemberWithdrawal` settles an outstanding request if any. `policy_enforcement_integration_test.go`, `withdrawal_status_integration_test.go` |
| FR-09 | Block withdrawal breaking collateral / guarantee | `[~]` | active-loan block via `loan.allowActiveLoanWithdrawal`; a guarantor of any active loan is blocked outright; no measured obligation or collateral ratio (T-16) |
| FR-10 | Max loan from configured caps | `[~]` | members apply from the dashboard, personal cap enforced; **fairness and solvency caps still missing** (T-15) |
| FR-11 | Guarantor request + approval | `[x]` | required above `loan.guarantorThresholdAmount`, nominated by member ID, approve/decline on the member dashboard |
| FR-12 | Approve → disburse → confirm | `[~]` | the worker path (`CreateMemberLoan`, `loan_repository.go`) writes `status = 'ACTIVE'` directly, skipping `PENDING_GUARANTOR` → `PENDING_APPROVAL`. The documented lifecycle is reachable only via admin approval of a loan the worker UI cannot create (T-14) |
| FR-13 | Record installments; no late fee on a missed one | `[x]` | instalments recorded and counted; **no late fee** (ruled 2026-08-25) — the agreement denies one and `requirements.test.ts` pins both directions |
| FR-14 | Default settlement waterfall | `[x]` | ordering and proportionality correct with or without a guarantor; status change, all three recovery legs and the audit row commit in one transaction |
| FR-15 | Donations carry a fund type | `[ ]` | posts as untyped `DONATION`; no Operating/Lending/Zakat split (T-13) |
| FR-16 | Donation funds isolated from deposits | `[~]` | not withdrawable, and the pool now exists as a real account owned by `system_donation_fund`; no per-fund accounting (T-13) |
| FR-17 | Member raises dispute | `[x]` | from the member's transactions screen, on a `CONFIRMED` posting only (ADR-026); the transaction freezes, the audit row is written and the member gets a 200 with the frozen posting. `test/routes/success-paths.test.ts` |
| FR-18 | Freeze disputed txn, notify admin | `[~]` | status freezes; admin correction flow is manual (T-20) |
| FR-19 | Append-only audit log | `[x]` | written by both backends and **enforced by a database trigger** — UPDATE is rejected outright |
| FR-20 | Member dashboard | `[x]` | balances, loans, transactions, deposits, profile, support |
| FR-21 | Worker dashboard with SLA queues | `[~]` | queues live; SLA colouring (green <24h / red >48h) missing (T-23) |
| FR-22 | Admin dashboard | `[~]` | approvals, reports, settings, support and the audit viewer are done; **no liquidity alerts** (T-46) |
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
| Normalising the Next handlers to the Go envelope | [ADR-005](decisions.md): a breaking sweep for no member-visible gain. New handlers use the Go envelope |
| SMS | [ADR-003](decisions.md): email only in Phase 1; no SMS provider code or flags |
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
