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

> **`[!]` Member records are recoverable from git history.** 39 files under
> `Official Infos/` — member details, savings and loan ledgers, check books — were
> committed in `f152f0c` and deleted in `9306120`. Deleting a file removes it from
> the working tree and from nothing else. This is the only open item that is a
> disclosure rather than a risk: [SEC-10](production-readiness.md) ·
> [WO-28](work-orders.md).
>
> **`[~]` The boundaries are mostly untested.** The money arithmetic is at 93%;
> 60 of 61 Go handlers and all 21 Next route methods have no test. Every defect
> found in the last three audits lived at a boundary, not in the arithmetic.
> [testing.md](testing.md) is the plan — Phases 0 and 1 are done and found three
> more: malformed tokens crashed rather than being refused, an expired session
> answered 500 instead of 401, and the Next handlers honoured revoked tokens
> (SEC-11). Next up: **`do TEST-10`**.
>
> **Recently fixed, with regression tests confirmed red first:** the four ledger
> defects that destroyed money under concurrent postings (Batch L); the admin
> settings page, which could not save *any* setting; the document-number
> allocator, which made loan applications impossible; and registration on a
> phone (Batch M). Details in
> [work-orders.md](work-orders.md#completed--wo-01--wo-50).
>
> **Going to production?** Read [go-live.md](go-live.md) first. It orders the
> remaining work by *what gets more expensive once real member data exists*,
> which is a different order from this page.
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
| FR-10 | Max loan from configured caps | `[~]` | Members can now apply from the dashboard (WO-45). Personal cap enforced; **fairness and solvency caps still missing** |
| FR-11 | Guarantor request + approval | `[x]` | Complete 2026-08-17 (WO-45). Guarantor required above `loan.guarantorThresholdAmount`, nominated by member ID with the name confirmed, approve/decline on the member dashboard. Two defects fixed on the way: the dashboard query was scanning 5 columns into 4 *and* filtering the legacy `PENDING` status, so the panel was always empty |
| FR-12 | Approve → disburse → confirm | `[~]` | Go admin/worker endpoints exist, but the worker path (`CreateMemberLoan`) writes `status = 'ACTIVE'` directly, skipping `PENDING_GUARANTOR` → `PENDING_APPROVAL`. The documented lifecycle is reachable only via admin approval of a loan the UI cannot create |
| FR-13 | Installments and late fees | `[~]` | installments recorded; **no late-fee logic at all** |
| FR-14 | Default settlement waterfall | `[x]` | Ordering and proportionality correct, with or without a guarantor. Status change, all three recovery legs and the audit row now commit in one transaction (WO-42) |
| FR-15 | Donations carry a fund type | `[ ]` | posts as untyped `DONATION`; no Operating/Lending/Zakat split |
| FR-16 | Donation funds isolated from deposits | `[~]` | not withdrawable, but no separate pool accounting |
| FR-17 | Member raises dispute | `[x]` | `/api/v1/member/transactions/{id}/dispute` |
| FR-18 | Freeze disputed txn, notify admin | `[~]` | status freezes; admin correction flow is manual |
| FR-19 | Append-only audit log | `[x]` | `audit_logs` written by both backends and **enforced by a database trigger** since 2026-08-16 — UPDATE is rejected outright (DATA-08) |
| FR-20 | Member dashboard | `[x]` | balances, loans, transactions, deposits, profile, support |
| FR-21 | Worker dashboard with SLA queues | `[~]` | queues live; SLA colouring (green <24h / red >48h) missing |
| FR-22 | Admin dashboard | `[~]` | approvals, reports, settings, support done; **no audit viewer UI, no liquidity alerts** |

**14 complete, 8 partial.**

## Open bugs

Verified against the source on 2026-08-17, financial paths against a real
Postgres 17. Ledger defects carry `LEDGER-` ids and security defects `SEC-` ids
in [production-readiness.md](production-readiness.md); fixed ones are in the
[changelog](#changelog) rather than listed here.

| | Bug | Evidence |
|---|---|---|
| `[!]` | **Next handlers ignore the token blacklist** (SEC-11) | `lib/auth.ts` and `lib/server-auth.ts` check signature and `exp` only. After logout or a password change the old token still edits settings, gallery, workers |
| `[x]` | ~~No member loan-application or guarantor-approval UI~~ (FR-10/11) | Built 2026-08-17 by WO-45 |
| `[x]` | ~~`availableGuarantors` leaked every member's savings~~ (SEC-13) | Fixed 2026-08-17 — the member loans endpoint returned the 50 wealthiest members' names and balances to any signed-in member |
| `[x]` | ~~Concurrent postings destroy money~~ (LEDGER-01) | Fixed 2026-08-17 by WO-41 |
| `[x]` | ~~Unguaranteed loan default recovers nothing~~ (LEDGER-02) | Fixed 2026-08-17 by WO-42 |
| `[x]` | ~~Loan-approved notification divides by 100~~ (LEDGER-03) | Fixed 2026-08-17 by WO-43 |
| `[x]` | ~~Donations bypass `document_sequences`, no audit row~~ (LEDGER-04) | Fixed 2026-08-17 by WO-43 |
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

**[Batch L](work-orders.md#batch-l--ledger-integrity) is done** (WO-41 → WO-44).
The git-history purge (WO-28) is now next. Then:

1. **SEC-11** — Next handlers must check the token blacklist. Now the largest
   open defect.
2. **Collapse the legacy loan statuses** — this already cost a bug: the member
   dashboard's guarantor query filtered `PENDING` while applications create
   `PENDING_GUARANTOR`, so the panel was silently empty (fixed in WO-45) — an enum value cannot be dropped once
   rows reference it.
3. **Donation fund types** (FR-15/16) — schema plus admin UI, cheap only while
   the donation table is empty.
4. ~~WO-45 — loan-application and guarantor UI.~~ **Done 2026-08-17.** FR-12 is
   still partial: the worker path writes `status = 'ACTIVE'` directly, so a
   worker-created loan skips the lifecycle a member-created one now follows.
5. **Fairness and solvency caps** (FR-10), then late fees (FR-13).
6. **Withdrawal notice period** (FR-08) — the policy is in
   [product.md](product.md); nothing enforces it.
7. **Admin audit viewer UI** and worker SLA colouring (FR-21/22).
8. **OPS-07 reconciliation job** — sum of transactions vs account balances. Had
   this existed, LEDGER-01 would have been a nightly alert instead of an audit
   finding. The regression tests now guard the two known shapes; this guards the
   ones nobody has thought of. Treat it as the ledger's smoke alarm.

## Priority test scenarios

Financial-integrity first. 1–3 and 5 are covered by
`pnpm test:integration`; the gaps are marked.

> **The 2026-08-17 lesson.** All 17 integration tests were green while
> LEDGER-01 and LEDGER-02 were live. Both were found by asking *what does the
> suite never do* — it never ran two postings at once, and it never seeded a
> loan without a guarantor. A green suite bounds the cases it contains and says
> nothing about the ones it does not. Scenarios 7 and 8 below now close those two
> blind spots, in
> [`ledger_integrity_integration_test.go`](../apps/api/internal/repositories/ledger_integrity_integration_test.go).
>
> Each of those tests was run against the **pre-fix** code and confirmed to fail
> with the symptom it names. A regression test written after the fix, and never
> seen to fail, proves only that today's code passes it.

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
7. **Concurrency. Covered** (WO-41) — 20 parallel deposits must sum exactly, 10
   parallel withdrawals against a 2-withdrawal balance must yield exactly 2, and
   concurrent postings must not collide on a receipt number.
8. **A loan with no guarantor. Covered** (WO-42) — recovery from the borrower,
   residual debt when they cannot cover it, and atomicity of the status change.

Exit bar: zero critical or high defects in financial flows, 80% coverage on core
modules. **Financial flows now meet it** — LEDGER-01→04 are closed and covered.
SEC-11 is high but is an auth defect, not a financial one.

---

## Changelog

Compressed 2026-08-16. Full narratives are in
[work-orders.md](work-orders.md#completed-wo-01--wo-26); the durable lessons are
in [Traps](work-orders.md#traps-that-cost-a-session); the decisions are in
[decisions.md](decisions.md).

| Date | What | Notable |
|---|---|---|
| 2026-08-17 | **Batch L** (WO-41 → WO-44) — ledger integrity | Full audit against a running Postgres 17. **Concurrent postings were destroying money** — 20 parallel deposits left 1 deposit's worth — and the default waterfall failed outright on any loan without a guarantor, after committing DEFAULTED. Balance writes are now relative ([ADR-015](decisions.md)); recovery shares the status change's transaction. Also removed: a worker withdrawal endpoint that reported success while doing nothing, and 5 uncalled Next handlers. 7 regression tests, **each verified to fail against the pre-fix code first**. Integration suite 17 → 24 |
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
