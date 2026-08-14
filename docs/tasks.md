# Task Dashboard

Live status of the platform. Verified against the code on **2026-08-14**. Update this file in the same commit as the work it describes.

Legend: `[x]` done · `[~]` partial · `[ ]` not started

## Requirements

| ID | Requirement | Status | Where / what is missing |
|---|---|---|---|
| FR-01 | Login by phone or email | `[x]` | Go `/v1/auth/login` |
| FR-02 | Forced password change on first login | `[x]` | `mustChangePassword` + first-login token |
| FR-03 | RBAC on sensitive actions | `[x]` | Go handlers + `lib/server-auth.ts` |
| FR-04 | Registration captures biodata, NID, address, nominee | `[x]` | `/api/v1/registrations` |
| FR-05 | Admin approve/reject registration with reason | `[x]` | Go approvals + admin UI |
| FR-06 | Member edits nominee, audit-logged | `[ ]` | captured at signup only; no edit path |
| FR-07 | Deposit request → process → confirm | `[x]` | full loop across both backends |
| FR-08 | Withdrawal request with notice period | `[~]` | request + approval work; **3-month notice not validated** |
| FR-09 | Block withdrawal breaking collateral / guarantee | `[~]` | active-loan block via `loan.allowActiveLoanWithdrawal`; no guarantor-obligation check |
| FR-10 | Max loan from configured caps | `[~]` | personal cap only — fairness and solvency caps missing |
| FR-11 | Guarantor request + approval | `[~]` | route exists but is unreachable (see bugs) |
| FR-12 | Approve → disburse → confirm | `[x]` | Go admin/worker endpoints |
| FR-13 | Installments and late fees | `[~]` | installments recorded; **no late-fee logic at all** |
| FR-14 | Default settlement waterfall | `[x]` | `ProcessWaterfallRecovery`: borrower → guarantor → donation pool |
| FR-15 | Donations carry a fund type | `[ ]` | posts as untyped `DONATION`; no Operating/Lending/Zakat split |
| FR-16 | Donation funds isolated from deposits | `[~]` | not withdrawable, but no separate pool accounting |
| FR-17 | Member raises dispute | `[x]` | `/api/v1/member/transactions/{id}/dispute` |
| FR-18 | Freeze disputed txn, notify admin | `[~]` | status freezes; admin correction flow is manual |
| FR-19 | Append-only audit log | `[x]` | `audit_logs`, written by both backends |
| FR-20 | Member dashboard | `[x]` | balances, loans, transactions, deposits, profile, support |
| FR-21 | Worker dashboard with SLA queues | `[~]` | queues live; SLA colouring (green <24h / red >48h) missing |
| FR-22 | Admin dashboard | `[~]` | approvals, reports, settings, support done; **no audit viewer UI, no liquidity alerts** |

## Known bugs

- [ ] `app/api/v1/loans/[id]/guarantor-approval/route.ts` validates the loan id against a **UUID regex**, but Prisma ids are `cuid()` — every request 400s, so FR-11 is dead in practice.
- [ ] `LoanStatus` still carries legacy `PENDING` / `APPROVED` beside the spec states; two vocabularies for one concept.
- [ ] 16 empty route folders under `apps/web/app/api` (`v1/me/*`, `v1/auth/*`, `v1/debug`, `auth/*`, several `[id]` stubs) — dead scaffolding that misleads readers about the API surface.
- [ ] `/api/v1/settings` upserts any key it receives, so a typo silently creates dead config.
- [ ] `/api/v1/settings` sets `Access-Control-Allow-Origin: *` while the Go API uses an allow-list.

## Gaps

- [ ] **Tests are effectively absent.** `apps/web/e2e/admin-dashboard.spec.ts` imports `@playwright/test`, which is not a dependency and has no config or script — it cannot run. No Go tests, no unit tests.
- [ ] No 48-hour unconfirmed-transaction sweep (needs a scheduled job).
- [ ] No CI: lint, typecheck, and `go build` are manual.
- [ ] No seed script; the first admin must be created by hand.
- [ ] Prisma has no migration history ([ADR-004](decisions.md)) — accepted while solo.

## Priority test scenarios (when testing starts)

Financial-integrity first, in this order:

1. Wrong amount processed → member disputes → admin corrects → every step traceable in `audit_logs`.
2. Loan cap enforcement, including recalculation after a deposit changes.
3. Default waterfall: borrower → guarantor (proportional) → donation pool → residual debt.
4. Withdrawal blocking: active loan, active guarantee, notice period.
5. Audit immutability: no update, no delete, corrections append.

Exit bar: zero critical or high defects in financial flows, 80% coverage on core modules.

## Suggested order

1. Fix the guarantor-approval id check — smallest change, unblocks FR-11 entirely.
2. Delete the empty API folders and collapse the legacy loan statuses.
3. Wire Playwright properly (dependency, config, script) and cover scenario 1.
4. Donation fund types (FR-15/16) — schema plus admin UI.
5. Fairness and solvency caps (FR-10), then late fees (FR-13).
6. Admin audit viewer UI and worker SLA colouring (FR-21/22).
