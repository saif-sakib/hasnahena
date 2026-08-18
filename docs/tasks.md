# Task Dashboard

Live status of the platform. Re-verified against the code on **2026-08-18**.
Update this file in the same commit as the work it describes.

This file tracks **product** work. Operational readiness lives in
[production-readiness.md](production-readiness.md) (the *why*),
[work-orders.md](work-orders.md) (the *what to change* — prompt with `do WO-28`),
and [testing.md](testing.md) (how any of it is proved).

Everything already finished is one line per batch in
[changelog.md](changelog.md). **Nothing done is listed here** — a status board
that keeps its own history stops being readable as a status board.

Legend: `[x]` done · `[~]` partial · `[ ]` not started · `[!]` **broken now**

---

## Read this first

> **Three things are wrong right now, and they are different in kind.**
>
> 1. **A member's dispute reports failure while succeeding** — FR-17, proven
>    against a real database on 2026-08-18. The transaction freezes, the audit
>    row is written, and the member is told it failed.
>    [WO-57](work-orders.md).
> 2. **Member records are recoverable from git history** —
>    [SEC-10](production-readiness.md) · [WO-28](work-orders.md). A disclosure
>    that has already occurred, not a risk.
> 3. **The monitoring is built and switched off** — Sentry, `/metrics` and
>    UptimeRobot all exist in code and none is receiving anything.
>    [production-readiness.md](production-readiness.md#the-monitoring-is-built-and-switched-off).
>
> **The boundaries are under contract.** All 64 Go routes, all 21 Next route
> methods, every balance-writing repository method, both document renderers and
> every FR row on this page are covered by suites that fail the build when the
> code grows something they do not know about.
>
> **And that was not enough.** A code audit on 2026-08-18 read the source rather
> than the coverage and found **ten more defects**, including the FR-17 break
> above. The lesson is the one already on this page in another form: the contract
> suites prove *who may call a route*, and almost nothing about what it returns
> when the caller is allowed. WO-57's route had a test that only ever drove its
> 404.
>
> **This page cannot quietly fall behind the code.** A requirement not marked
> `[x]` must *still* be unimplemented in the source, or
> `apps/web/test/unit/requirements.test.ts` fails and names the file that
> implements it.
>
> **Going to production?** Read [go-live.md](go-live.md) first. It orders the
> remaining work by *what gets more expensive once real member data exists*.
>
> **Run `pnpm db:migrate` before deploying** — schema changes ship as migrations,
> not `db push` ([ADR-014](decisions.md)).

---

## Requirements

| ID | Requirement | Status | Where / what is missing |
|---|---|---|---|
| FR-01 | Login by phone or email | `[x]` | Go `/v1/auth/login` |
| FR-02 | Forced password change on first login | `[x]` | `mustChangePassword` + first-login token |
| FR-03 | RBAC on sensitive actions | `[x]` | Go handlers + `lib/server-auth.ts`; `/admin` routes also gated at the router (SEC-02) |
| FR-04 | Registration captures biodata, NID, address, nominee | `[x]` | `/api/v1/registrations` |
| FR-05 | Admin approve/reject registration with reason | `[x]` | Go approvals + admin UI |
| FR-06 | Member edits nominee, audit-logged | `[ ]` | captured at signup only; no edit path |
| FR-07 | Deposit request → process → confirm | `[x]` | full loop across both backends |
| FR-08 | Withdrawal request with notice period | `[~]` | request + approval work; **3-month notice not validated — no notice-period code exists anywhere in either app** |
| FR-09 | Block withdrawal breaking collateral / guarantee | `[~]` | active-loan block via `loan.allowActiveLoanWithdrawal`; no guarantor-obligation check |
| FR-10 | Max loan from configured caps | `[~]` | members apply from the dashboard, personal cap enforced; **fairness and solvency caps still missing** |
| FR-11 | Guarantor request + approval | `[x]` | required above `loan.guarantorThresholdAmount`, nominated by member ID, approve/decline on the member dashboard |
| FR-12 | Approve → disburse → confirm | `[~]` | the worker path (`CreateMemberLoan`) writes `status = 'ACTIVE'` directly, skipping `PENDING_GUARANTOR` → `PENDING_APPROVAL`. The documented lifecycle is reachable only via admin approval of a loan the worker UI cannot create |
| FR-13 | Installments and late fees | `[~]` | installments recorded; **no late-fee logic at all**, and see the late-fee question below |
| FR-14 | Default settlement waterfall | `[x]` | ordering and proportionality correct with or without a guarantor; status change, all three recovery legs and the audit row commit in one transaction |
| FR-15 | Donations carry a fund type | `[ ]` | posts as untyped `DONATION`; no Operating/Lending/Zakat split |
| FR-16 | Donation funds isolated from deposits | `[~]` | not withdrawable, and `HN-ACC-DONATION` now exists as a real pool account; no per-fund accounting |
| FR-17 | Member raises dispute | `[!]` | **Broken now.** The dispute is recorded, the transaction freezes and the audit row is written — then the route answers 500 and the member is told it failed. [WO-57](work-orders.md) |
| FR-18 | Freeze disputed txn, notify admin | `[~]` | status freezes; admin correction flow is manual |
| FR-19 | Append-only audit log | `[x]` | written by both backends and **enforced by a database trigger** — UPDATE is rejected outright (DATA-08) |
| FR-20 | Member dashboard | `[x]` | balances, loans, transactions, deposits, profile, support |
| FR-21 | Worker dashboard with SLA queues | `[~]` | queues live; SLA colouring (green <24h / red >48h) missing |
| FR-22 | Admin dashboard | `[~]` | approvals, reports, settings, support done; **no audit viewer UI, no liquidity alerts** |

**13 complete, 8 partial, 1 broken.**

---

## Open product defects

Verified against the source on 2026-08-18.

| | Defect | Evidence |
|---|---|---|
| `[ ]` | **Withdrawal notice period is not validated** (FR-08) | No `noticePeriod`-shaped identifier exists in the Go API, the web lib, or the schema. `loan.noticePeriodMonths` is settable from the admin UI and read by nothing |
| `[ ]` | **`LoanStatus` carries legacy `PENDING`/`APPROVED`** beside the spec states | Two vocabularies for one concept, both live in the enum. This has already cost one bug — the guarantor panel filtered `PENDING` while applications create `PENDING_GUARANTOR` |
| `[ ]` | **A worker-created loan skips the lifecycle** (FR-12) | `worker_repository.go` inserts `status = 'ACTIVE'` with `disbursementDate`/`approvedAt` set in the same statement. No guarantor step, no approval step |
| `[ ]` | **Support chat has no SSE client** | `EventSource` appears nowhere in `apps/web`. The stream and its ticket endpoint are live and authenticated; the UI polls instead. One full-suite browser run issued **288 requests to `/v1/dashboard/notifications` and 144 to `/v1/dashboard/support/threads`** — that is the polling, measured |
| `[ ]` | **No 48-hour unconfirmed-transaction sweep** | Needs the scheduler — OPS-08. The Monitor workflow alerts on the backlog twice a day but nothing acts on it |
| `[ ]` | **Loan repayment presets show paisa** | `getLoanRepaymentPresets` in `lib/utils.ts` computes `Math.round((installment / 4) * 100) / 100`, so the "weekly" quick-fill offers e.g. `1141.75` on all three money screens. All three round before submitting, so nothing wrong is posted — the member is shown a figure that is not the one that gets recorded, and a fractional taka violates rule 1 ([WO-56](work-orders.md)) |
| `[!]` | **A dispute reports failure while succeeding** (FR-17) | `NextResponse.json` cannot serialise the raw Prisma row's `BigInt` fields, so a successful dispute throws into the route's own catch and answers 500. **Proven**: DB status `DISPUTED`, response `500`. The member retries and gets `409 DISPUTE_ALREADY_RAISED` — two apparent refusals for an objection that was recorded both times ([WO-57](work-orders.md)) |
| `[!]` | **Notification amounts print paisa from a float** (LEDGER-07) | 15 member-facing messages render `BDT %.2f` from `float64(amount)` across `transaction_repository.go` and `loan_repository.go`. Rule 1 says whole taka, no float — and the audit-log line written by the *same function* correctly uses `%d BDT`, so every posting writes one right record and one wrong one ([WO-58](work-orders.md)) |
| `[ ]` | **Three notification writes are fire-and-forget** | `registrations:455`, `guarantor-approval:63` and `:83` create a notification without `await`. On Vercel the function can be frozen at the response, so **an admin may never be told a registration is waiting** ([WO-59](work-orders.md)) |
| `[ ]` | **Old avatars can never be deleted** | `extractPublicId` does not strip a transformation segment, so the id it derives does not exist and `deleteOldAvatar` fails silently — in an asset store that has a quota and no backup (DATA-06). ([WO-63](work-orders.md)) |
| `[ ]` | **Serialisers turn a legitimate zero into null** | `x ? Number(x) : null` on a `BigInt`, so a fully repaid loan reports `remainingAmount: null` and a transaction that took a balance to exactly zero reports a blank `savingsAfter` — the passbook snapshot for "you withdrew your last taka" ([WO-61](work-orders.md)) |
| `[ ]` | **Notifications are English only** | Both surfaces hardcode the message text. A Bengali-speaking member gets English notifications about their own money, against rule 5. Fold into [WO-58](work-orders.md) |

### The late-fee question — flagged, not decided

The loan agreement PDF prints *"Late payment may attract a fixed, interest-free
late fee as set by foundation policy"*. Nothing implements a late fee, no policy
records who would keep the money, and FR-13 names one. This is pinned in both
directions by `apps/api/internal/money/shariah_test.go`: implementing a fee fails
the suite, and removing the clause from the agreement fails it too. **Rule 3 says
stop and flag rather than choose** — this is the flag. Someone with authority over
foundation policy has to answer it before FR-13 can close either way.

---

## Coverage gaps under watch

The eight testing phases are done. These are the things they deliberately or
accidentally do **not** cover, recorded so that "the suite is green" is never
mistaken for "this is checked". Each has a work order.

| | Gap | Why it matters | Order |
|---|---|---|---|
| `[ ]` | **Nothing pins EN/BN message parity** | 300 keys each and identical today, but "full EN/BN parity on all user-facing strings" is a stated quality bar with no test behind it. The browser matrix only catches a missing key on a page it happens to visit, in a locale it happens to render | [WO-51](work-orders.md) |
| `[ ]` | **`email_service.go` has no tests at all** | 488 lines, and every member-facing notification passes through it carrying an amount. LEDGER-03 was a wrong amount *in a notification* — the exact shape this file can still produce. The suites assert a notification row **exists**; none reads what it says | [WO-52](work-orders.md) |
| `[ ]` | **The cleanup loop is untested** | `startCleanupLoop` (RUN-06) sweeps expired tokens and rate limits hourly. A sweep that stops sweeping is completely silent — the table just grows | [WO-53](work-orders.md) |
| `[ ]` | **No migration-drift check** | `schema.prisma` and `prisma/migrations/` can disagree and CI will not notice, because CI applies the migrations and never compares them to the schema. The failure surfaces as a runtime column error in production | [WO-54](work-orders.md) |
| `[ ]` | **Cloudinary paths are untested and unbacked** | Upload, transform and delete have no test on either surface, and DATA-06 means the assets have no backup either. NID images are regulatory documents | [WO-55](work-orders.md) · DATA-06 |
| `[x]` | ~~The browser suite had never completed in one pass~~ | **Proven 2026-08-18: 142 passed, 1 skipped, 10.2 minutes, exit 0.** Recorded in [testing.md](testing.md#the-one-pass-browser-run) | — |
| `[ ]` | **`e2e/admin-dashboard.spec.ts` has never run anywhere** | It skips unless `E2E_ADMIN_IDENTIFIER` and `E2E_ADMIN_PASSWORD` are set, and neither `scripts/test-stack.sh env` nor the CI e2e job sets them. It is the "1 skipped" in every run. `journeys.spec.ts` already covers admin login through the fixtures, so this is redundant rather than missing coverage — wire it to `ACCOUNTS.ADMIN` or delete it, but do not leave a spec that reads as covered and never executes | — |

---

## UI gaps

Recorded rather than fixed, because each is a decision rather than a defect.

| | Gap | Detail |
|---|---|---|
| `[ ]` | No client-side role guard on the dashboards | A member who types `/en/dashboard/worker` sees the worker shell with no data in it. The API refuses every request (TEST-15/16 prove it), so nothing leaks — it is confusing, not dangerous. A redirect in the dashboard layout would fix it. `e2e/journeys.spec.ts` asserts the safety property and deliberately does *not* pin the current behaviour, which would make the gap harder to fix |
| `[ ]` | Admin and worker screens keep their copy inline | Those pages use `locale === 'bn' ? … : …` throughout rather than `messages/{en,bn}.json` (rule 5). They *are* translated — the `/bn` dashboards measure 84–97% Bengali — so this is a maintainability gap, not a member-facing one. New copy goes into the message files |

---

## Data gaps

- `[ ]` **Cloudinary assets have no backup** (`DATA-06`) — NID and member photos
  are regulatory documents in one third-party account with no export. The nightly
  dump covers the database and nothing else. **The largest remaining data gap.**
- `[ ]` **No data retention or erasure policy** (`DATA-07`) — decide now what a
  member's erasure request means when the audit log is append-only by design.
  It is a schema question, so deciding it late means discovering you needed a
  column.
- `[ ]` No audit viewer UI (`OBS-08`, FR-22) — the data is complete; nobody can
  read it without SQL.

---

## The order to work in

**This is the list to walk down one item at a time.** It is ordered by a single
question: *what is hurting a member, or will cost most to fix later?* Not by
size, and not by how interesting the work is.

Each row is self-contained — prompt with the order id (`do WO-57`) and the spec
in [work-orders.md](work-orders.md) has the files, the change and the
verification, so no re-exploration is needed.

### Now — a member is affected today

| # | Do this | Why it is first | Size |
|---|---|---|---|
| 1 | **[WO-57](work-orders.md)** — dispute reports failure while succeeding | The only broken FR. A member objects to a wrong amount and is told twice that the platform would not record it. Proven, one-line cause, one-hour fix | 1 h |
| 2 | **[WO-58](work-orders.md)** — notification amounts print paisa from a float | 15 member-facing messages, rule 1, in the exact layer LEDGER-03 lived in. The same function writes a *correct* audit line beside each wrong notification | ½ day |
| 3 | **[WO-59](work-orders.md)** — three notification writes are fire-and-forget | An admin may never learn a registration is waiting, so a member waits for an approval nobody knows to give | 1 h |

### Next — the open disclosure and the blind spots

| # | Do this | Why here | Size |
|---|---|---|---|
| 4 | **[WO-28](work-orders.md)** — purge member records from git history | SEC-10. A disclosure already in progress, and every commit below lands on top of the rewrite | ½ day + GitHub Support |
| 5 | **Switch the monitoring on** — [how](production-readiness.md#the-monitoring-is-built-and-switched-off) | Not engineering: four environment variables and an UptimeRobot monitor. Until it is done, every fix below ships blind, and the Monitor workflow fails twice a day | 1 h, yours |
| 6 | **[WO-66](work-orders.md)** — run the race detector in CI | Measured at zero races today, so this locks in a property that already holds for ~40 s of CI. Cheapest guard available for a system whose defining defect class is the lost update | 20 min |
| 7 | **[WO-40](work-orders.md)** — enable `errcheck` and `staticcheck` | 19 findings, and two of them are **`InvalidateAllUserTokens` unchecked** — a password change that revokes nothing and reports success. Six more are unchecked audit writes (rule 6) | ½ day |

### Then — correctness and hardening

| # | Do this | Why | Size |
|---|---|---|---|
| 8 | **[WO-60](work-orders.md)** — remove chi's `RealIP` | The access log currently records an address the caller chose, and with the default `TRUSTED_PROXIES=0` so does the rate limiter | 2 h |
| 9 | **[WO-61](work-orders.md)** — serialisers turn zero into null | Small, and [WO-57](work-orders.md) depends on it being right | 1 h |
| 10 | **[WO-62](work-orders.md)** — email can outlive the shutdown drain | Worst case 39 s inside a handler against a 30 s drain: a deploy mid-approval is a `SIGKILL` mid-request | ½ day |
| 11 | **[WO-63](work-orders.md)** — Cloudinary: undeletable assets, swallowed errors | Compounds DATA-06 — orphans accumulating in the one store with no backup | ½ day |
| 12 | **[WO-64](work-orders.md)** — harden the support proxy | No escalation (the Go API re-authorises), but it leaks upstream SSE streams and puts all support traffic in one rate-limit bucket | 2 h |
| 13 | **[WO-65](work-orders.md)** — modulo bias in generated secrets | The password-change verification code makes digits 0–5 25% more likely than 6–9 | 2 h |
| 14 | **[WO-56](work-orders.md)** — loan repayment presets must be whole taka | One line plus a test | 20 min |

### Then — the schema, while it is still cheap

Everything here is a migration today and a migration **plus a backfill plus a
plan for rows written in between** after go-live. [go-live.md](go-live.md) 1.2 is
the authority on this block.

| # | Do this | Why now |
|---|---|---|
| 15 | **Collapse the legacy `LoanStatus` values** | Postgres will not drop an enum label that any row still references |
| 16 | **Donation fund types** (FR-15/16) | Zakat funds cannot be reconstructed after the fact. Cheap only while the donation table is empty |
| 17 | **Withdrawal notice period** (FR-08) | A policy field on withdrawals. Add it before there are withdrawals that predate it and are exempt for no recorded reason |
| 18 | **Decide DATA-07** (retention and erasure) | It decides whether you need a `deletedAt` or an anonymisation path — a schema question. Deciding late means discovering you needed a column |

### Then — close the coverage gaps

| # | Do this | Why in this order |
|---|---|---|
| 19 | **[WO-54](work-orders.md)** — fail CI on Prisma schema drift | One hour, and it guards the four schema changes above |
| 20 | **[WO-51](work-orders.md)** — pin EN/BN message parity | 300 keys each and identical today; pinning is free now and expensive after they drift |
| 21 | **[WO-52](work-orders.md)** — test what a notification says | The census that stops WO-58's defect coming back in the next message |
| 22 | **[WO-53](work-orders.md)** — prove the cleanup loop sweeps | A sweep that stops sweeping is completely silent |
| 23 | **[WO-55](work-orders.md)** — cover the Cloudinary paths | After WO-63, which fixes what this would be testing |

### Then — the rest of the product

| # | Do this |
|---|---|
| 24 | **OPS-07 reconciliation job** — sum of transactions vs account balances, alerting on drift. Had it existed, LEDGER-01 would have been a nightly alert rather than an audit finding. The ledger's smoke alarm |
| 25 | **Fix FR-12's worker path** so a worker-created loan follows the same lifecycle a member-created one does |
| 26 | **Fairness and solvency caps** (FR-10) |
| 27 | **Answer the late-fee question** (FR-13) — see above. Needs foundation policy, not code |
| 28 | **A client-side role guard** on the dashboards, and **an SSE client** for support (the UI polls; one browser run made 288 notification requests) |
| 29 | **Admin audit viewer UI** (OBS-08, FR-22) and worker SLA colouring (FR-21) |
| 30 | **DATA-06** — back up the Cloudinary assets. The largest remaining data gap, and it can only be done once there is something to back up |

### Deliberately not in this list

- **[WO-27](work-orders.md)** — React Compiler lint cleanup. The compiler is off,
  so the 20 findings describe a hypothetical. It needs these screens moved onto a
  data-fetching library, which is a project, not a cleanup.
- **Host move** (INF-01 → INF-12). Only once everything above is quiet.

---

## Where everything else lives

| Looking for | Read |
|---|---|
| What has already been done | [changelog.md](changelog.md) |
| Why an operational task exists | [production-readiness.md](production-readiness.md) |
| Exactly what to change for a task | [work-orders.md](work-orders.md) |
| What the test suites cover, and what they do not | [testing.md](testing.md) |
| The order to do things in before launch | [go-live.md](go-live.md) |
| Why the code contradicts an older assumption | [decisions.md](decisions.md) |
