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

> **One open defect, and it is operational, not product.** Member records are
> recoverable from git history. It is stated once, in full, where operational
> state lives: [SEC-10](production-readiness.md) · [WO-28](work-orders.md).
>
> **The boundaries are under contract.** All 64 Go routes, all 21 Next route
> methods, every balance-writing repository method, both document renderers and
> every FR row on this page are covered by suites that fail the build when the
> code grows something they do not know about. Phases 0–8 of
> [testing.md](testing.md) are done and found **eighteen** defects, three of
> which moved or misreported money.
>
> **This page cannot quietly fall behind the code.** A requirement marked `[~]`
> here must *still* be unimplemented in the source, or
> `apps/web/test/unit/requirements.test.ts` fails and names the file that
> implements it. It caught three rows here that were already wrong.
>
> **Going to production?** Read [go-live.md](go-live.md) first. It orders the
> remaining work by *what gets more expensive once real member data exists*,
> which is a different order from this page.
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
| FR-17 | Member raises dispute | `[x]` | `/api/v1/member/transactions/{id}/dispute` |
| FR-18 | Freeze disputed txn, notify admin | `[~]` | status freezes; admin correction flow is manual |
| FR-19 | Append-only audit log | `[x]` | written by both backends and **enforced by a database trigger** — UPDATE is rejected outright (DATA-08) |
| FR-20 | Member dashboard | `[x]` | balances, loans, transactions, deposits, profile, support |
| FR-21 | Worker dashboard with SLA queues | `[~]` | queues live; SLA colouring (green <24h / red >48h) missing |
| FR-22 | Admin dashboard | `[~]` | approvals, reports, settings, support done; **no audit viewer UI, no liquidity alerts** |

**14 complete, 8 partial.**

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

## Suggested order

The go-live sequence is in [go-live.md](go-live.md) and takes precedence — it
orders by what gets more expensive once real member data exists. This is the
product-work order within that.

1. **[WO-28](work-orders.md) — purge git history.** Not product work, but every
   commit below lands on top of it and it is the only open disclosure.
2. **Turn the monitoring on.** Sentry, `/metrics` and UptimeRobot are all built
   and none is switched on in any running environment — see
   [production-readiness.md](production-readiness.md#the-monitoring-is-built-and-switched-off).
   This is an afternoon of dashboard work, not engineering, and until it is done
   every other item on this list is being worked on blind.
3. **Collapse the legacy loan statuses** — an enum value cannot be dropped once
   rows reference it, so this is cheap exactly once.
4. **Donation fund types** (FR-15/16) — schema plus admin UI, cheap only while
   the donation table is empty. Zakat funds especially cannot be reconstructed
   after the fact.
5. **Withdrawal notice period** (FR-08) — the policy is in
   [product.md](product.md); nothing enforces it, and it is a schema change.
6. **[WO-54](work-orders.md) migration drift, then [WO-51](work-orders.md)
   message parity** — both are small, both are enumerating checks that stop a
   whole class of drift, and both get more valuable the more schema and copy
   changes land.
7. **Fix FR-12's worker path** so a worker-created loan follows the same
   lifecycle a member-created one does.
8. **OPS-07 reconciliation job** — sum of transactions vs account balances. Had
   this existed, LEDGER-01 would have been a nightly alert instead of an audit
   finding. The regression tests guard the two known shapes; this guards the ones
   nobody has thought of. Treat it as the ledger's smoke alarm.
9. **Fairness and solvency caps** (FR-10), then the late-fee decision (FR-13).
10. **[WO-52](work-orders.md) notification content, [WO-53](work-orders.md)
    cleanup loop, [WO-55](work-orders.md) Cloudinary** — the remaining coverage
    gaps, in that order of value.
11. **Admin audit viewer UI** and worker SLA colouring (FR-21/22).

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
