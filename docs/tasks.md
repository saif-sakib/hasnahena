# Task Dashboard

Live status of the platform. Re-verified against the code on **2026-08-17**,
with the financial paths re-checked against a running Postgres 17 rather than by
reading. Update this file in the same commit as the work it describes.

This file tracks **product** work. Operational readiness lives in
[production-readiness.md](production-readiness.md) (the *why*) and
[work-orders.md](work-orders.md) (the *what to change* — prompt with `do WO-28`).

Legend: `[x]` done · `[~]` partial · `[ ]` not started · `[!]` **broken now**

---

## Read this first

> **`[!]` The ledger races.** Concurrent postings to one account destroy money:
> 20 simultaneous ৳1,000 deposits leave a ৳1,000 balance against ৳20,000 of
> transaction rows, and ten ৳5,000 withdrawals all clear against a ৳10,000
> balance. Defaulting a loan with **no guarantor** marks it DEFAULTED and
> recovers nothing. Both reproduced against a real database on 2026-08-17.
> [LEDGER-01/02](production-readiness.md#phase-1--ledger-integrity-defects),
> fixes specced as [WO-41/42](work-orders.md#batch-l--ledger-integrity). **These
> come before everything below, including the history purge.**
>
> **`[!]` Member records are recoverable from git history.** 39 files under
> `Official Infos/` — member details, savings and loan ledgers, check books — were
> committed in `f152f0c` and deleted in `9306120`. Deleting a file removes it from
> the working tree and from nothing else. See
> [SEC-10](production-readiness.md)
> and [WO-28](work-orders.md). This is the only open item that is a disclosure
> rather than a risk.
>
> **Going to production?** Read [go-live.md](go-live.md) first. It orders the
> remaining work by *what gets more expensive once real member data exists*,
> which is a different order from this page.
>
> **`[x]` Guarantor approval is fixed (2026-08-16).** It validated loan ids
> against a UUID regex while every id is `@default(cuid())`, so FR-11 had never
> worked for any loan. Verified end to end against a real database: a real cuid
> now returns 200 and moves the loan `PENDING_GUARANTOR` → `PENDING_APPROVAL`; a
> junk id returns 404 instead of 400.
>
> **`[x]` Batch G is merged to `main`** (PR #13). Next 16 / React 19 / Tailwind 4
> / next-intl 4, `pnpm audit` 41 → 0.
>
> **Run `pnpm db:migrate` before deploying** — schema changes ship as migrations,
> not `db push` ([ADR-014](decisions.md)).

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
| FR-08 | Withdrawal request with notice period | `[~]` | request + approval work; **3-month notice not validated — confirmed, no notice-period code exists anywhere in either app** |
| FR-09 | Block withdrawal breaking collateral / guarantee | `[~]` | active-loan block via `loan.allowActiveLoanWithdrawal`; no guarantor-obligation check |
| FR-10 | Max loan from configured caps | `[~]` | personal cap only — fairness and solvency caps missing. **`/api/v1/loans/applications` exists and no UI calls it**, so a member cannot apply at all (WO-45) |
| FR-11 | Guarantor request + approval | `[~]` | **Downgraded 2026-08-17.** WO-29 fixed the endpoint and that fix is real, but **no page in the app calls it** — `guarantor` appears in the UI only as a status label. A guarantor has no way to approve anything (WO-45) |
| FR-12 | Approve → disburse → confirm | `[~]` | Go admin/worker endpoints exist, but the worker path (`CreateMemberLoan`) writes `status = 'ACTIVE'` directly, skipping `PENDING_GUARANTOR` → `PENDING_APPROVAL`. The documented lifecycle is reachable only via admin approval of a loan the UI cannot create |
| FR-13 | Installments and late fees | `[~]` | installments recorded; **no late-fee logic at all** |
| FR-14 | Default settlement waterfall | `[!]` | Ordering and proportionality are correct **when a guarantor exists**. With `guarantorId IS NULL` the whole waterfall fails on a NULL scan and recovers nothing, after the loan is already committed as DEFAULTED — LEDGER-02 |
| FR-15 | Donations carry a fund type | `[ ]` | posts as untyped `DONATION`; no Operating/Lending/Zakat split |
| FR-16 | Donation funds isolated from deposits | `[~]` | not withdrawable, but no separate pool accounting |
| FR-17 | Member raises dispute | `[x]` | `/api/v1/member/transactions/{id}/dispute` |
| FR-18 | Freeze disputed txn, notify admin | `[~]` | status freezes; admin correction flow is manual |
| FR-19 | Append-only audit log | `[x]` | `audit_logs` written by both backends and **enforced by a database trigger** since 2026-08-16 — UPDATE is rejected outright (DATA-08) |
| FR-20 | Member dashboard | `[x]` | balances, loans, transactions, deposits, profile, support |
| FR-21 | Worker dashboard with SLA queues | `[~]` | queues live; SLA colouring (green <24h / red >48h) missing |
| FR-22 | Admin dashboard | `[~]` | approvals, reports, settings, support done; **no audit viewer UI, no liquidity alerts** |

**12 complete, 9 partial, 1 broken.**

## Open bugs

Verified against the source on 2026-08-17, financial paths against a real
Postgres 17. Ledger defects carry `LEDGER-` ids and security defects `SEC-` ids
in [production-readiness.md](production-readiness.md); fixed ones are in the
[changelog](#changelog) rather than listed here.

| | Bug | Evidence |
|---|---|---|
| `[!]` | **Concurrent postings destroy money** (LEDGER-01) | Measured: 20 parallel ৳1,000 deposits → ৳1,000 balance, ৳20,000 of ledger rows. 10 parallel ৳5,000 withdrawals all cleared a ৳10,000 balance. Cause: balance read from the pool, outside the transaction, unlocked; absolute total written back |
| `[!]` | **Unguaranteed loan default recovers nothing** (LEDGER-02) | `ProcessWaterfallRecovery` scans nullable `guarantorId` into a Go `string`; pgx errors before step 1. `MarkLoanDefaulted` has already committed `DEFAULTED` in a separate transaction |
| `[!]` | **Loan-approved notification divides by 100** (LEDGER-03) | `loan_repository.go:123`. A ৳50,000 loan is announced to the member as "BDT 500.00". Last surviving ×100 from before [ADR-002](decisions.md) |
| `[!]` | **Next handlers ignore the token blacklist** (SEC-11) | `lib/auth.ts` and `lib/server-auth.ts` check signature and `exp` only. After logout or a password change the old token still edits settings, gallery, workers |
| `[ ]` | Donations bypass `document_sequences` and write no audit row (LEDGER-04) | `RecordDonation` builds `DON-<timestamp>`; two donations in one second collide. Only balance-changing Go method with no `audit_logs` row |
| `[ ]` | No member loan-application or guarantor-approval UI (FR-10/11) | Exhaustive grep: nothing under `app/[locale]/` calls `loans/applications` or `guarantor-approval` |
| `[ ]` | Withdrawal notice period is not validated (FR-08) | No `noticePeriod`-shaped identifier exists in the Go API, the web lib, or the schema. `loan.noticePeriodMonths` is settable and read by nothing |
| `[ ]` | `LoanStatus` carries legacy `PENDING`/`APPROVED` beside the spec states | Two vocabularies for one concept, both live in the enum |
| `[ ]` | Support chat has no SSE client | **Confirmed: `EventSource` appears nowhere in `apps/web`.** The stream and its ticket endpoint are live and authenticated; the UI still polls. A client must `POST …/support/stream/ticket` and pass `?ticket=` on every connect |
| `[ ]` | No 48-hour unconfirmed-transaction sweep | Needs the scheduler — OPS-08 |

## Gaps

- `[ ]` **Cloudinary assets have no backup** (`DATA-06`) — NID and member photos
  are regulatory documents in one third-party account with no export. The nightly
  dump covers the database and nothing else. **The largest remaining data gap.**
- `[ ]` **No data retention or erasure policy** (`DATA-07`) — decide now what a
  member's erasure request means when the audit log is append-only by design.
- `[ ]` No audit viewer UI (`OBS-08`, FR-22) — the data is complete; nobody can
  read it without SQL.

## Suggested order

**[Batch L](work-orders.md#batch-l--ledger-integrity) first** — WO-41/42/43. The
ledger is wrong under concurrency and on unguaranteed defaults; nothing else on
this page is worth doing over a broken balance. Then the git-history purge
(WO-28). Then:

1. **SEC-11** — Next handlers must check the token blacklist.
2. **Collapse the legacy loan statuses** — an enum value cannot be dropped once
   rows reference it.
3. **Donation fund types** (FR-15/16) — schema plus admin UI, cheap only while
   the donation table is empty.
4. **WO-45** — the member loan-application and guarantor-approval UI. This is
   what makes FR-10/11/12 real rather than endpoint-shaped.
5. **Fairness and solvency caps** (FR-10), then late fees (FR-13).
6. **Withdrawal notice period** (FR-08) — the policy is in
   [product.md](product.md); nothing enforces it.
7. **Admin audit viewer UI** and worker SLA colouring (FR-21/22).
8. **OPS-07 reconciliation job** — sum of transactions vs account balances. Had
   this existed, LEDGER-01 would have been a nightly alert instead of an audit
   finding. Treat it as the regression test for the whole ledger.

## Priority test scenarios

Financial-integrity first. 1–3 and 5 are covered by
`pnpm test:integration`; the gaps are marked.

> **The 2026-08-17 lesson.** All 17 integration tests were green while
> LEDGER-01 and LEDGER-02 were live. Both were found by asking *what does the
> suite never do* — it never runs two postings at once, and it never seeds a
> loan without a guarantor. A green suite bounds the cases it contains and says
> nothing about the ones it does not. New scenarios 7 and 8 below exist to close
> exactly those two blind spots.

1. Wrong amount processed → member disputes → admin corrects → every step
   traceable in `audit_logs`. **Covered.**
2. Loan cap enforcement, including recalculation after a deposit. **Covered.**
3. Default waterfall: borrower → guarantor (proportional) → donation pool →
   residual debt. **Covered**, including pool depletion.
4. Withdrawal blocking: active loan, active guarantee, notice period. **Partly** —
   the notice period has no code to test (FR-08).
5. Audit immutability: no update, no delete, corrections append. **Covered
   behaviourally**, not at the database level (DATA-08).
6. **Not covered at all: the guarantor flow.** Integration coverage stops at the
   Go API, and FR-11 lives in a Next route handler — which is exactly how a
   permanently-400ing endpoint went unnoticed. Add coverage with [WO-29](work-orders.md).
7. **Not covered at all: concurrency.** No test in the suite issues two postings
   at once, which is why LEDGER-01 was invisible. Required by
   [WO-41](work-orders.md): N parallel deposits must sum exactly, and parallel
   withdrawals must never overdraw.
8. **Not covered at all: a loan with no guarantor.** Every waterfall test seeds
   one, so the nullable column's real path never executed. Required by
   [WO-42](work-orders.md).

Exit bar: zero critical or high defects in financial flows, 80% coverage on core
modules. **Not met today** — LEDGER-01 and LEDGER-02 are both critical and both
in financial flows.

---

## Changelog

Compressed 2026-08-16. Full narratives are in
[work-orders.md](work-orders.md#completed-wo-01--wo-26); the durable lessons are
in [Traps](work-orders.md#traps-that-cost-a-session); the decisions are in
[decisions.md](decisions.md).

| Date | What | Notable |
|---|---|---|
| 2026-08-16 | **Batch G** (WO-23 → WO-26) — Next 14 → 16.3.1, React 18 → 19.2.8, next-intl 3 → 4.13.6, ESLint 8 → 9, Tailwind 3 → 4.3.3 | **`pnpm audit` 41 → 0.** Tailwind's codemod silently dropped `tailwindcss-animate`, killing 81 animation classes across 17 files. `sharp` closed itself — the override WO-23 declined to force was never needed |
| 2026-08-16 | **Batch F** (WO-20 → WO-22) — Dockerfiles, compose, `.dockerignore` | Verified by *running* the images; three defects survived static review, all runtime-only. `.dockerignore` turned out to be a secret-containment control |
| 2026-08-16 | **Batch E** (WO-17 → WO-19) — metrics, Sentry, alerting | `/metrics` is token-gated: the exposition is business data. Alerting split three ways on cost grounds. Found a startup context being handed to a background loop — gauges froze, which looks exactly like a calm system |
| 2026-08-16 | **Dependency incident + policy** | Three Dependabot majors merged together broke the Vercel build. Majors are now ignored for npm and Go entirely — a major is a migration, not an update. Actions are the deliberate exception |
| 2026-08-16 | **Batch D** (WO-14 → WO-16) — backups, migrations, seed | The restore is a *script*, not a paragraph, and CI drills it on every push. `db push` retired ([ADR-014](decisions.md)) |
| 2026-08-15 | **Batch C** (WO-10 → WO-13) — tests + CI | **Found: no money method wrote an `audit_logs` row** — deposit, withdrawal, disbursement and repayment all moved money with no trail. And the donation-pool waterfall leg was broken two ways, so debt vanished with no ledger row and one donation could settle unlimited defaults |
| 2026-08-15 | **Money lifecycle verified against a real database** | Two live bugs: `document_sequences."updatedAt"` NOT NULL with no default broke *all four* money flows as a generic 500; and a non-UTC session clock made every new token born revoked |
| 2026-08-15 | **Batch B** (WO-06 → WO-09) — runtime hardening | Deploys no longer kill the API mid-transaction. Member emails out of the logs |
| 2026-08-15 | **Batch A** (WO-01 → WO-05) — security defects | SEC-01→05, SEC-07. Token revocation actually revokes; the `/admin` group is gated at the router so a new handler is protected by where it is mounted |
| — | Documents rebuilt: English-only, vector, paginated ([ADR-010](decisions.md), [ADR-012](decisions.md)) · sequential reference numbers ([ADR-013](decisions.md)) · new logo ([ADR-011](decisions.md)) · environment untangled · dead-code cleanup | |
