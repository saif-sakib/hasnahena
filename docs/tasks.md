# Task Board

Live **product** status. Operational readiness lives in
[production-readiness.md](production-readiness.md), execution specs in
[work-orders.md](work-orders.md), proof in [testing.md](testing.md), and
everything already finished in [changelog.md](changelog.md).

**Nothing done is listed here** — a status board that keeps its own history stops
being readable as a status board. Update this file in the same commit as the work.

Legend: `[x]` done · `[~]` partial · `[ ]` not started · `[!]` **broken now**

> **No requirement is broken.** One thing is wrong operationally: the
> **monitoring is built and switched off**
> ([how to fix](production-readiness.md#the-monitoring-is-built-and-switched-off)).
>
> **Blocks R and S are done** (WO-67 → 72, 2026-08-19): the `/donate` and
> `/contact` pages no longer show unchangeable placeholder details, every foreign
> key is indexed, the database has CHECK constraints of its own, migrations are
> the only definition of the schema, the legacy `LoanStatus` values are gone and
> branches are a real relation. [work-orders.md](work-orders.md) holds
> WO-73 → 84 — performance, security, SEO, future-proofing — each executable with
> `do WO-73` or `do block T`.
>
> **This page cannot quietly fall behind the code.** A requirement not marked
> `[x]` must *still* be unimplemented in the source, or
> `apps/web/test/unit/requirements.test.ts` fails and names the file that
> implements it. The same suite fails if `product.md` and this table disagree.
>
> **Going to production?** [go-live.md](go-live.md) orders the remaining work by
> *what gets more expensive once real member data exists*.

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
| FR-08 | Withdrawal request with notice period | `[x]` | the member's request **is** the notice: `CreateMemberWithdrawalNotice` files a PENDING withdrawal, and both `ApproveWithdrawal` and `AddMemberWithdrawal` refuse until `loan.noticePeriodMonths` has elapsed. `policy_enforcement_integration_test.go` |
| FR-09 | Block withdrawal breaking collateral / guarantee | `[~]` | active-loan block via `loan.allowActiveLoanWithdrawal`; no guarantor-obligation check |
| FR-10 | Max loan from configured caps | `[~]` | members apply from the dashboard, personal cap enforced; **fairness and solvency caps still missing** |
| FR-11 | Guarantor request + approval | `[x]` | required above `loan.guarantorThresholdAmount`, nominated by member ID, approve/decline on the member dashboard |
| FR-12 | Approve → disburse → confirm | `[~]` | the worker path (`CreateMemberLoan`) writes `status = 'ACTIVE'` directly, skipping `PENDING_GUARANTOR` → `PENDING_APPROVAL`. The documented lifecycle is reachable only via admin approval of a loan the worker UI cannot create |
| FR-13 | Installments and late fees | `[~]` | installments recorded; **no late-fee logic at all**, and see the late-fee question below |
| FR-14 | Default settlement waterfall | `[x]` | ordering and proportionality correct with or without a guarantor; status change, all three recovery legs and the audit row commit in one transaction |
| FR-15 | Donations carry a fund type | `[ ]` | posts as untyped `DONATION`; no Operating/Lending/Zakat split |
| FR-16 | Donation funds isolated from deposits | `[~]` | not withdrawable, and the pool now exists as a real account owned by `system_donation_fund`; no per-fund accounting |
| FR-17 | Member raises dispute | `[x]` | the transaction freezes, the audit row is written and the member gets a 200 with the frozen posting. `test/routes/success-paths.test.ts` |
| FR-18 | Freeze disputed txn, notify admin | `[~]` | status freezes; admin correction flow is manual |
| FR-19 | Append-only audit log | `[x]` | written by both backends and **enforced by a database trigger** — UPDATE is rejected outright |
| FR-20 | Member dashboard | `[x]` | balances, loans, transactions, deposits, profile, support |
| FR-21 | Worker dashboard with SLA queues | `[~]` | queues live; SLA colouring (green <24h / red >48h) missing |
| FR-22 | Admin dashboard | `[~]` | approvals, reports, settings, support done; **no audit viewer UI, no liquidity alerts** |

**12 complete · 8 partial · 2 not started · 0 broken.**

---

## Open product defects

| | Defect | Evidence |
|---|---|---|
| `[ ]` | **A worker-created loan skips the lifecycle** (FR-12) | `worker_repository.go` inserts `status = 'ACTIVE'` with `disbursementDate`/`approvedAt` in the same statement. No guarantor step, no approval step |
| `[ ]` | **Support chat has no SSE client** | `EventSource` appears nowhere in `apps/web`. The stream and its ticket endpoint are live and authenticated; the UI polls instead. One full browser run issued **288 requests to `/v1/dashboard/notifications` and 144 to `/v1/dashboard/support/threads`** — that is the polling, measured |
| `[ ]` | **No 48-hour unconfirmed-transaction sweep** | Needs the scheduler — OPS-08. The Monitor workflow alerts on the backlog twice a day but nothing acts on it |
| `[ ]` | **Notifications are English only** | Both surfaces hardcode the message text, against rule 5. The builders are now in one place each — `apps/api/internal/notify/messages.go` and `apps/web/lib/notify.ts` — so this is a translation job rather than a hunt |

### The late-fee question — flagged, not decided

The loan agreement PDF prints *"Late payment may attract a fixed, interest-free
late fee as set by foundation policy"*. Nothing implements a late fee, no policy
records who would keep the money, and FR-13 names one. Pinned in both directions
by `apps/api/internal/money/shariah_test.go`: implementing a fee fails the suite,
and removing the clause from the agreement fails it too. **Rule 3 says stop and
flag rather than choose** — this is the flag. It needs someone with authority over
foundation policy, not code: a penalty retained by the lender is riba on the
mainstream reading, while one paid entirely to charity is the form scholars permit.

---

## UI gaps

Recorded rather than fixed, because each is a decision rather than a defect.

- `[ ]` **No client-side role guard on the dashboards.** A member who types
  `/en/dashboard/worker` sees the worker shell with no data in it. The API refuses
  every request, so nothing leaks — it is confusing, not dangerous. A redirect in
  the dashboard layout would fix it. `e2e/journeys.spec.ts` asserts the safety
  property and deliberately does *not* pin the current behaviour, which would make
  the gap harder to fix.
- `[ ]` **Admin, worker and `(auth)` screens keep their copy inline** —
  `locale === 'bn' ? … : …` rather than `messages/{en,bn}.json` (rule 5). They
  *are* translated (the `/bn` dashboards measure 84–97% Bengali), so this is a
  maintainability gap, not a member-facing one. New copy goes in the message files.

## Data gaps

- `[ ]` **Cloudinary assets have no backup** (`DATA-06`) — the largest remaining
  data gap, and it cannot be built until there is something to back up
  ([ADR-020](decisions.md)).
- `[ ]` **No data retention or erasure policy** (`DATA-07`) — decide now what a
  member's erasure request means when the audit log is append-only by design. It
  is a schema question, so deciding it late means discovering you needed a column.
- `[ ]` **No audit viewer UI** (`OBS-08`, FR-22) — the data is complete and the
  endpoint exists; nobody can read it without SQL.

---

## The order to work in

Ordered by one question: *what is hurting a member, or will cost most to fix
later?* Nothing here is a work order — when a row needs a spec someone can execute
without re-reading the codebase, it becomes one in
[work-orders.md](work-orders.md) first.

### Now — neither of these is engineering

| # | Do this | Why it is first |
|---|---|---|
| 1 | **Switch the monitoring on** — [how](production-readiness.md#the-monitoring-is-built-and-switched-off) | Four environment variables and an UptimeRobot monitor. Until it is done, every fix below ships blind and the Monitor workflow fails twice a day. ~1 h, yours |
| 2 | **Set `TRUSTED_PROXIES=1` on Render** — [why](decisions.md) (ADR-019, ADR-021) | One variable. At the default `0` a process behind a proxy attributes every member to the proxy's address: one 60/min bucket and one login lockout for the whole membership. The API logs a warning at boot when it is `0` outside development. 5 min, yours |

### Then — the schema, while it is still cheap

Everything here is a migration today, and a migration **plus a backfill plus a
plan for rows written in between** after go-live. [go-live.md](go-live.md) 1.2 is
the authority. Guarded by `pnpm db:migrate:check` in CI, so a schema edit without
a generated migration fails the build rather than a production query.

| # | Do this | Why now |
|---|---|---|
| 3 | **Donation fund types** (FR-15/16) | Zakat funds cannot be reconstructed after the fact. Cheap only while the donation table is empty |
| 4 | **Decide DATA-07** (retention and erasure) | It decides whether you need a `deletedAt` or an anonymisation path — a schema question |

The legacy `LoanStatus` values were the third item here and are gone
([WO-71](work-orders.md)).

### Then — the rest of the product

| # | Do this |
|---|---|
| 6 | **OPS-07 reconciliation job** — sum of transactions vs account balances, alerting on drift. Had it existed, LEDGER-01 would have been a nightly alert rather than an audit finding. The ledger's smoke alarm |
| 7 | **Fix FR-12's worker path** so a worker-created loan follows the same lifecycle a member-created one does |
| 8 | **Fairness and solvency caps** (FR-10) |
| 9 | **Answer the late-fee question** (FR-13) — needs foundation policy, not code |
| 10 | **A client-side role guard**, and **an SSE client** for support (the UI polls) |
| 11 | **Admin audit viewer UI** (OBS-08, FR-22) and worker SLA colouring (FR-21) |
| 12 | **DATA-06** — back up the Cloudinary assets, as soon as there is something to back up |
| 13 | **Host move** (INF-01 → INF-12). Only once everything above is quiet |
