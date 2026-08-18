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

> **One thing is wrong right now.**
>
> **The monitoring is built and switched off** — Sentry, `/metrics` and
> UptimeRobot all exist in code and none is receiving anything.
> [production-readiness.md](production-readiness.md#the-monitoring-is-built-and-switched-off).
>
> The other two entries that stood here on 2026-08-18 are closed. **FR-17 no
> longer reports failure while succeeding** ([WO-57](work-orders.md)), and the
> git-history disclosure was closed as a decision rather than a task after the
> owner reviewed the files ([ADR-018](decisions.md)).
>
> **The boundaries are under contract.** All 64 Go routes, all 21 Next route
> methods, every balance-writing repository method, both document renderers and
> every FR row on this page are covered by suites that fail the build when the
> code grows something they do not know about.
>
> **And that was not enough.** A code audit on 2026-08-18 read the source rather
> than the coverage and found **ten more defects**, including the FR-17 break.
> The lesson is the one already on this page in another form: the contract
> suites prove *who may call a route*, and almost nothing about what it returns
> when the caller is allowed. WO-57's route had a test that only ever drove its
> 404 — so the suite that closed it drives success paths, and a census now fails
> the build when a route hands a BigInt-bearing row to `NextResponse.json`.
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
| FR-08 | Withdrawal request with notice period | `[x]` | the member's request **is** the notice: `CreateMemberWithdrawalNotice` files a PENDING withdrawal, and both `ApproveWithdrawal` and `AddMemberWithdrawal` refuse until `loan.noticePeriodMonths` has elapsed. `policy_enforcement_integration_test.go` |
| FR-09 | Block withdrawal breaking collateral / guarantee | `[~]` | active-loan block via `loan.allowActiveLoanWithdrawal`; no guarantor-obligation check |
| FR-10 | Max loan from configured caps | `[~]` | members apply from the dashboard, personal cap enforced; **fairness and solvency caps still missing** |
| FR-11 | Guarantor request + approval | `[x]` | required above `loan.guarantorThresholdAmount`, nominated by member ID, approve/decline on the member dashboard |
| FR-12 | Approve → disburse → confirm | `[~]` | the worker path (`CreateMemberLoan`) writes `status = 'ACTIVE'` directly, skipping `PENDING_GUARANTOR` → `PENDING_APPROVAL`. The documented lifecycle is reachable only via admin approval of a loan the worker UI cannot create |
| FR-13 | Installments and late fees | `[~]` | installments recorded; **no late-fee logic at all**, and see the late-fee question below |
| FR-14 | Default settlement waterfall | `[x]` | ordering and proportionality correct with or without a guarantor; status change, all three recovery legs and the audit row commit in one transaction |
| FR-15 | Donations carry a fund type | `[ ]` | posts as untyped `DONATION`; no Operating/Lending/Zakat split |
| FR-16 | Donation funds isolated from deposits | `[~]` | not withdrawable, and the pool now exists as a real account owned by `system_donation_fund`; no per-fund accounting |
| FR-17 | Member raises dispute | `[x]` | the transaction freezes, the audit row is written and the member gets a 200 with the frozen posting. `test/routes/success-paths.test.ts` drives the success path — which nothing did until WO-57 |
| FR-18 | Freeze disputed txn, notify admin | `[~]` | status freezes; admin correction flow is manual |
| FR-19 | Append-only audit log | `[x]` | written by both backends and **enforced by a database trigger** — UPDATE is rejected outright (DATA-08) |
| FR-20 | Member dashboard | `[x]` | balances, loans, transactions, deposits, profile, support |
| FR-21 | Worker dashboard with SLA queues | `[~]` | queues live; SLA colouring (green <24h / red >48h) missing |
| FR-22 | Admin dashboard | `[~]` | approvals, reports, settings, support done; **no audit viewer UI, no liquidity alerts** |

**15 complete, 7 partial, 0 broken.**

---

## Open product defects

Verified against the source on 2026-08-18.

| | Defect | Evidence |
|---|---|---|
| `[ ]` | **`LoanStatus` carries legacy `PENDING`/`APPROVED`** beside the spec states | Two vocabularies for one concept, both live in the enum. This has already cost one bug — the guarantor panel filtered `PENDING` while applications create `PENDING_GUARANTOR` |
| `[ ]` | **A worker-created loan skips the lifecycle** (FR-12) | `worker_repository.go` inserts `status = 'ACTIVE'` with `disbursementDate`/`approvedAt` set in the same statement. No guarantor step, no approval step |
| `[ ]` | **Support chat has no SSE client** | `EventSource` appears nowhere in `apps/web`. The stream and its ticket endpoint are live and authenticated; the UI polls instead. One full-suite browser run issued **288 requests to `/v1/dashboard/notifications` and 144 to `/v1/dashboard/support/threads`** — that is the polling, measured |
| `[ ]` | **No 48-hour unconfirmed-transaction sweep** | Needs the scheduler — OPS-08. The Monitor workflow alerts on the backlog twice a day but nothing acts on it |
| `[ ]` | **Notifications are English only** | Both surfaces hardcode the message text. A Bengali-speaking member gets English notifications about their own money, against rule 5. The builders are now in one place each — `apps/api/internal/notify/messages.go` and `apps/web/lib/notify.ts` — so this is a translation job rather than a hunt |

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
| `[x]` | ~~Nothing pins EN/BN message parity~~ | **Closed 2026-08-18.** `apps/web/test/unit/messages.test.ts` — equal key sets, no long untranslated copy-paste, every `{placeholder}` carried through | [WO-51](work-orders.md) |
| `[x]` | ~~Nothing reads what a notification says~~ | **Closed 2026-08-18.** Every message is a pure builder in `apps/api/internal/notify` (or `apps/web/lib/notify.ts`), table-tested, with a census that fails when one is added untested and another that fails when a repository builds a message itself. Writing it found LEDGER-07 sitting there, which is now fixed | [WO-52](work-orders.md) |
| `[x]` | ~~The cleanup loop is untested~~ | **Closed 2026-08-18.** `internal/services/cleanup_integration_test.go` proves the sweep removes expired rows and only those, and `cmd/server/wiring_test.go` fails if `main()` stops starting it — or starts it with `startupCtx` | [WO-53](work-orders.md) |
| `[x]` | ~~No migration-drift check~~ | **Closed 2026-08-18.** `pnpm db:migrate:check` compares the migrated database with `schema.prisma` and CI runs it after `db:migrate`. Verified both ways: clean today, exit 2 on an ungenerated schema edit. The `audit_logs` trigger is **not** reported as drift | [WO-54](work-orders.md) |
| `[x]` | ~~Cloudinary paths are untested and unbacked~~ | **Partly closed 2026-08-18.** The pure paths are covered (`lib/cloudinary.test.ts`, `lib/image-utils.test.ts`) and the registration compensation path is driven end to end with the client stubbed (`test/routes/registration.test.ts`). **DATA-06 — no backup of the asset store — is still open and is now the whole of this row** | [WO-55](work-orders.md) · DATA-06 |
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

Nothing here is a work order any more — every one is closed. Rows below are
owner tasks and product decisions; when one of them needs a spec someone can
execute without re-reading the codebase, it becomes an order in
[work-orders.md](work-orders.md) first.

### Now — nothing here is a member-facing defect

WO-53 → WO-66 all closed on 2026-08-18. **No requirement is marked broken and no
open order describes a member being told something untrue.** What is left is two
operator tasks and the product backlog.

| # | Do this | Why it is first | Size |
|---|---|---|---|
| 1 | **Switch the monitoring on** — [how](production-readiness.md#the-monitoring-is-built-and-switched-off) | Not engineering: four environment variables and an UptimeRobot monitor. Until it is done, every fix below ships blind, and the Monitor workflow fails twice a day | 1 h, yours |
| 2 | **Set `TRUSTED_PROXIES=1` on Render** — [why](decisions.md) (ADR-019, ADR-021) | One environment variable. At the default `0`, a process behind a proxy attributes every member to the proxy's address: one 60/min bucket and one login lockout for the whole membership. The API logs a warning at boot when it is `0` outside development — check the Render log after the next deploy | 5 min, yours |

**Every engineering work order is closed.** WO-62, WO-64, WO-65 and WO-66 landed
on 2026-08-18; [work-orders.md](work-orders.md) lists nothing open. What the
hardening left behind is RUN-09 (a rate limiter keyed on the member rather than
the address) and DATA-06 (no Cloudinary backup) in
[production-readiness.md](production-readiness.md) — neither blocks launch, and
DATA-06 cannot be built until there is a real account to build it against
([ADR-020](decisions.md)).

### Then — the schema, while it is still cheap

Everything here is a migration today and a migration **plus a backfill plus a
plan for rows written in between** after go-live. [go-live.md](go-live.md) 1.2 is
the authority on this block.

| # | Do this | Why now |
|---|---|---|
| 6 | **Collapse the legacy `LoanStatus` values** | Postgres will not drop an enum label that any row still references |
| 7 | **Donation fund types** (FR-15/16) | Zakat funds cannot be reconstructed after the fact. Cheap only while the donation table is empty |
| 8 | **Decide DATA-07** (retention and erasure) | It decides whether you need a `deletedAt` or an anonymisation path — a schema question. Deciding late means discovering you needed a column |

Each of these is now guarded: `pnpm db:migrate:check` runs in CI after
`db:migrate`, so a schema edit without a generated migration fails the build
rather than a production query ([WO-54](work-orders.md)).

FR-08's withdrawal notice used to sit in this block. It needed no schema change
in the end — the member's request *is* the notice ([ADR-016](decisions.md)).

### Then — the rest of the product

| # | Do this |
|---|---|
| 9 | **OPS-07 reconciliation job** — sum of transactions vs account balances, alerting on drift. Had it existed, LEDGER-01 would have been a nightly alert rather than an audit finding. The ledger's smoke alarm |
| 10 | **Fix FR-12's worker path** so a worker-created loan follows the same lifecycle a member-created one does |
| 11 | **Fairness and solvency caps** (FR-10) |
| 12 | **Answer the late-fee question** (FR-13) — see above. Needs foundation policy, not code |
| 13 | **A client-side role guard** on the dashboards, and **an SSE client** for support (the UI polls; one browser run made 288 notification requests) |
| 14 | **Admin audit viewer UI** (OBS-08, FR-22) and worker SLA colouring (FR-21) |
| 15 | **DATA-06** — back up the Cloudinary assets. The largest remaining data gap, and it can only be done once there is something to back up |

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
