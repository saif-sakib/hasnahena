# Task Dashboard

Live status of the platform. Verified against the code on **2026-08-15**. Update this file in the same commit as the work it describes.

This file tracks **product** work. Operational readiness — security defects, tests, CI, containers, backups, observability, and the eventual move off Vercel/Render — lives in [production-readiness.md](production-readiness.md).

> **Four security defects are live in production.** Any logged-in member can mark any loan defaulted and read foundation-wide financial reports; logout does not actually end a session; the public gallery accepts unauthenticated writes. See [SEC-01…SEC-03](production-readiness.md#phase-0--security-defects-do-these-first). Fix these before starting anything below.

## Recently done

- [x] Documents are English only and drawn as real PDF text — statements/receipts/loan agreements/certificates now produce **selectable, searchable, vector-sharp** PDFs that paginate properly (the previous rasteriser clipped the last line and the footer). One document model, two renderers; `html2canvas` and `jspdf-autotable` dropped. See [ADR-012](decisions.md).
- [x] Reference numbers are sequential and readable — `DEP-2026-000123`, `WDR-…`, `LOAN-…`, `REP-…` from the `document_sequences` table, allocated inside the posting transaction. Replaces random hex suffixes that could collide on the unique `loanNumber`. See [ADR-013](decisions.md). **Run `pnpm db:push` before deploying.**
- [x] Document generation rebuilt — `lib/documents/` split into types/format/theme/templates/export; **multi-page PDFs no longer truncate** (the old exporter put one full-height image on a single A4 page), HTML escaping added, amount-in-words (EN + BN), statements now reconcile and classify loan/donation rows instead of leaving credit and debit blank. See [ADR-010](decisions.md).
- [x] New logo rolled out — black-background video frame keyed to transparency and trimmed; header, footer, auth pages, favicon, apple-icon and OG card all repointed to `images/logo/`. See [ADR-011](decisions.md).

Legend: `[x]` done · `[~]` partial · `[ ]` not started

## Requirements

| ID | Requirement | Status | Where / what is missing |
|---|---|---|---|
| FR-01 | Login by phone or email | `[x]` | Go `/v1/auth/login` |
| FR-02 | Forced password change on first login | `[x]` | `mustChangePassword` + first-login token |
| FR-03 | RBAC on sensitive actions | `[~]` | Go handlers + `lib/server-auth.ts`, but **4 admin routes check login without role** ([SEC-02](production-readiness.md#sec-02--four-admin-endpoints-do-not-check-role--)) |
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

Security defects are tracked with `SEC-` ids in [production-readiness.md](production-readiness.md) and are listed here only so this page stays honest.

- [ ] **[SEC-01] Logout and password-change do not revoke sessions.** `AuthService.ValidateToken` is the only code that reads `token_blacklist` and it has zero callers — every route uses `ParseAccessToken`, which checks signature and expiry only. A leaked token stays valid for its full 24-hour life.
- [ ] **[SEC-02] Four admin endpoints authenticate but do not authorise.** `MarkLoanDefaulted`, `MonthlyReport`, `YearlyReport`, `LoanPerformanceReport` call `userIDFromRequest` without `requireRoles`. Any member's token can default any loan — which moves money through guarantor recovery — or read foundation-wide financials.
- [ ] **[SEC-03] Gallery `POST`/`PUT`/`DELETE` have no auth check** and run under `Access-Control-Allow-Origin: *`. The public gallery is writable by anyone.
- [ ] **[SEC-07] `utils.MaxRequestBodySize` is never used** — `ParseJSON` decodes unbounded request bodies.
- [ ] **[SEC-06] A 17 MB compiled `apps/api/server` binary is committed** and is not gitignored; it is most of the repo's 59 MB history.
- [ ] `RUN-06`: `CleanupExpiredTokens` and `CleanupExpiredRateLimits` are written but never called — `token_blacklist` and `rate_limits` grow without bound.
- [ ] `app/api/v1/loans/[id]/guarantor-approval/route.ts` validates the loan id against a **UUID regex**, but Prisma ids are `cuid()` — every request 400s, so FR-11 is dead in practice.
- [ ] `LoanStatus` still carries legacy `PENDING` / `APPROVED` beside the spec states; two vocabularies for one concept.
- [ ] 16 empty route folders under `apps/web/app/api` (`v1/me/*`, `v1/auth/*`, `v1/debug`, `auth/*`, several `[id]` stubs) — dead scaffolding that misleads readers about the API surface.
- [ ] `/api/v1/settings` upserts any key it receives, so a typo silently creates dead config.
- [ ] `/api/v1/settings` sets `Access-Control-Allow-Origin: *` while the Go API uses an allow-list ([SEC-04](production-readiness.md)).

## Gaps

Operational gaps now have ids and an ordering in [production-readiness.md](production-readiness.md); the summary stays here.

- [ ] **Tests are effectively absent** (`CI-01`…`CI-04`). `apps/web/e2e/admin-dashboard.spec.ts` imports `@playwright/test`, which is not a dependency and has no config or script — it cannot run. No Go tests, no unit tests.
- [ ] **No backups** (`DATA-01`). `pg_dump` is described in deployment.md as an intention; nothing is scheduled and no restore has ever been tested. This is the largest single risk to the ledger.
- [ ] No CI: lint, typecheck, and `go build` are manual (`CI-05`).
- [ ] No Dockerfiles — the platform cannot run anywhere but Vercel + Render (`PKG-01`, `PKG-02`). This is the blocker for any VPS/AWS move.
- [ ] No observability: no metrics, error tracking, uptime monitoring, or alerts (`OBS-01`…`OBS-06`).
- [ ] No graceful shutdown or server timeouts (`RUN-01`, `RUN-02`) — a deploy can kill the API mid-transaction.
- [ ] No 48-hour unconfirmed-transaction sweep (needs a scheduled job — `OPS-08`).
- [ ] No seed script; the first admin must be created by hand (`DATA-05`).
- [ ] Prisma has no migration history ([ADR-004](decisions.md)) — accepted while solo, but `DATA-04` retires that acceptance before a second environment exists.
- [ ] `user_repository.go` is 4,868 lines — 55% of the Go codebase in one file (`RUN-09`).

## Priority test scenarios (when testing starts)

Financial-integrity first, in this order:

1. Wrong amount processed → member disputes → admin corrects → every step traceable in `audit_logs`.
2. Loan cap enforcement, including recalculation after a deposit changes.
3. Default waterfall: borrower → guarantor (proportional) → donation pool → residual debt.
4. Withdrawal blocking: active loan, active guarantee, notice period.
5. Audit immutability: no update, no delete, corrections append.

Exit bar: zero critical or high defects in financial flows, 80% coverage on core modules.

## Suggested order

Operational blocks 1–4 of [production-readiness.md](production-readiness.md#ordered-backlog) come first — the security defects, a test harness, runtime hardening, and working backups. Product work resumes here:

1. Fix the guarantor-approval id check — smallest change, unblocks FR-11 entirely.
2. Delete the empty API folders and collapse the legacy loan statuses.
3. Wire Playwright properly (dependency, config, script) and cover scenario 1.
4. Donation fund types (FR-15/16) — schema plus admin UI.
5. Fairness and solvency caps (FR-10), then late fees (FR-13).
6. Admin audit viewer UI and worker SLA colouring (FR-21/22).
