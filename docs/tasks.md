# Task Dashboard

Live status of the platform. Verified against the code on **2026-08-15**. Update this file in the same commit as the work it describes.

This file tracks **product** work. Operational readiness lives in [production-readiness.md](production-readiness.md) (the *why*) and [work-orders.md](work-orders.md) (the *what to change* — prompt with `do WO-01`).

> **Batch A is done — SEC-01 → SEC-05 and SEC-07 are closed.** Sessions now actually revoke, the four unprotected admin endpoints are role-gated (and the whole `/admin` group sits behind a router-level gate), gallery writes require an admin, wildcard CORS is gone from both Next routes, access tokens are no longer accepted in the query string, and request bodies are bounded. `SEC-08` (registration enumeration) and `SEC-09` remain open — see [production-readiness.md](production-readiness.md).
>
> **Run `pnpm db:migrate` before deploying** — Batch A adds an `sse_tickets` table. (The Go API also creates it on boot via `EnsureSupportSchema`, so a deploy that skips it still works.) Schema changes ship as migrations now, not `db push` — see [ADR-014](decisions.md).

## Recently done

- [x] **Batch E complete (WO-17 → WO-19) — the platform can now be watched.** Prometheus metrics on `/metrics`, Sentry in both apps, and threshold alerting, all on free tiers. Detail in [deployment.md](deployment.md#observability).
  - **Business metrics are the point.** A transaction sitting unconfirmed for three days throws no exception and returns no error status — every technical monitor reports green while a member waits on their own savings. `hasnahena_transactions_unconfirmed_over_48h`, open disputes, pending requests, postings today and active loans are exported for exactly that blind spot.
  - **`/metrics` is behind a bearer token**, which the work order did not ask for. The exposition is business data — who is waiting, how many disputes, how much is lent — and for a village cooperative that is sensitive. Unset token ⇒ 404, so probing reveals nothing. Route labels are chi route *templates*, so no member ID ever becomes a metric label.
  - **Alerting is split three ways on cost grounds.** A private repo has 2,000 Actions minutes/month billed per whole minute, so a 5-minute uptime check would cost four times the free allowance. Uptime → UptimeRobot (free, 1-minute), error rate → Sentry's own rules, business thresholds → a twice-daily Actions job that opens and reuses a single GitHub issue. ~60 minutes/month.
  - **Found a latent trap in `main.go`:** a bare `ctx` that was a 10-second startup timeout. Any long-lived loop handed it runs once and returns silently. It froze the new gauges immediately — and a frozen gauge is indistinguishable from a calm system. Nothing shipped was affected (`startCleanupLoop` already used `runCtx`), but it is now named `startupCtx` with a comment, so the next background job cannot fall in.
  - Sentry uses the current major (v10), which supports Next 13→16, so it survives the Batch G migration. Session Replay is **off**: it would record a member's balances and name and send them to a third party.

- [x] **Dependency incident, and the policy that came out of it (2026-08-16).** Three Dependabot major bumps were merged together and broke the Vercel build: `tailwindcss` 3→4 is a rewrite that moves configuration into CSS and needs a different PostCSS plugin, and this repo is configured for v3. Reverted that plus `lucide-react` 0→1 and `@types/node` 20→26; kept Next 14.2.35, the Radix and Go updates, and the Actions bumps. The Go bump also moved `go.mod` to `go 1.25.0` (pgx v5.10 requires it), so CI and the docs now say 1.25.
  - **Root cause:** `dependabot.yml` ignored majors only for a named list. Majors are now ignored for npm and Go entirely — a major is a migration, not an update. **GitHub Actions are the deliberate exception** and take majors weekly, because GitHub retires the Node runtime under old action majors on its own schedule.
  - **Node 20 → 24** across CI, `engines` and `@types/node`, ahead of Vercel's deprecation.
  - **`pnpm audit`: 41 → 23 vulnerabilities, 20 high → 8**, by pinning patched transitive versions in `pnpm.overrides` (postcss, brace-expansion, js-yaml, lodash, nanoid, picomatch, glob). Everything still standing is Next.js or next-intl and needs a framework migration — scoped as **Batch G** in [work-orders.md](work-orders.md).
  - **`.githooks/pre-push`** runs typecheck + build before a push. Branch protection needs a paid plan on a private repo; this catches the same class of failure for free. Install with `git config core.hooksPath .githooks`.
  - gitleaks now runs from the MIT binary rather than `gitleaks-action`, which wants a licence key for organisation-owned repos.

- [x] **Batch D complete (WO-14 → WO-16) — the ledger is now recoverable.** Nightly encrypted `pg_dump` runs in GitHub Actions (`.github/workflows/backup.yml`), kept 30 days as an artifact and 90 for the monthly copy, with an optional S3/B2/R2 copy. The restore procedure is a script, not a paragraph — `scripts/restore-check.sh` decrypts, restores into a scratch database, prints every row count and then asserts the money invariants (no negative balances, no orphaned transaction or loan). **CI runs the whole backup-and-restore drill on every push**, so the restore path cannot rot between the day it was written and the day it is needed. Measured against a 58 MB database (20,041 users, 200,008 transactions): dump 1 s, restore and verify 2 s. **RPO 24 h, RTO under 1 h**, written down with the reasoning in [deployment.md](deployment.md#rpo-and-rto).
  - **`db push` is retired** ([ADR-014](decisions.md)). The current schema is baselined as `0_init`, generated with `migrate diff --from-empty` so nothing changed shape at the cutover. `pnpm db:migrate` / `:dev` / `:status` / `:baseline`, and CI applies migrations rather than pushing. Migrations need a direct (non-pooled) Neon connection — the wrapper derives one and logs that it did, because the pooled endpoint fails at this in a way that looks like a hang.
  - **`pnpm db:seed` creates the first admin**, which previously had to be done by hand in Prisma Studio, plus the `system_config` defaults that were until now invisible fallbacks in two codebases. Idempotent, and it will not reset an existing admin's password.
- [x] **Batch C complete (WO-12, WO-13) — and it found two more silent money defects.** 17 integration tests now run against a real Postgres (`pnpm test:integration`), covering all five financial-integrity scenarios, plus a GitHub Actions pipeline (typecheck, lint, gofmt, vet, build, unit + integration tests, gitleaks) and grouped monthly Dependabot. Writing the tests surfaced:
  - **No money method wrote an `audit_logs` row.** Deposit, withdrawal, disbursement and repayment all moved money with no audit trail at all — a plain violation of CLAUDE.md rule 2. All four now write one inside the posting transaction, so a rolled-back posting cannot leave an audit row describing money that never moved. The dispute step wrote none either; it does now.
  - **The donation-pool leg of the default waterfall was silently broken, twice.** The `INSERT` recording a draw omitted `"accountId"` and `"userId"` — both NOT NULL — so it always failed, and its error was discarded while the loan was still written down. Debt vanished with no ledger row behind it. Separately, the pool balance summed donations and never subtracted prior draws, so **the same donation could settle an unlimited number of defaults**. Both fixed and pinned by tests.

- [x] **Verified the whole money lifecycle against a real database, and fixed two defects that broke it.** Ran the Go API against a throwaway local Postgres and drove deposit → withdrawal → loan → repayment → closure end to end, plus the security work from Batches A and B. Two live bugs surfaced:
  - **All four money flows were failing with a generic 500.** `document_sequences."updatedAt"` is `NOT NULL`, and Prisma models it as `@updatedAt` — which the *client* applies, so `prisma db push` **strips the database default**. The Go allocation query did not set the column, so the first document number after any db push failed a NOT NULL check. Since deposit, withdrawal, loan and repayment all allocate a number inside their transaction, every one of them broke. This is what made Add Deposit / Add Withdrawal / Pay Loan fail on the member detail page — the frontend was correct throughout. The query now writes both timestamps explicitly, with a regression test.
  - **A password change could lock a member out for 24 hours.** Timestamp columns are `timestamp without time zone`; Postgres `NOW()` stores the *session's* wall clock while pgx reads it back as UTC. On a non-UTC server the revocation marker read six hours in the future, so every newly issued token looked older than it. The pool now pins `timezone=UTC`. Neon defaults to UTC, which is the only reason production escaped — a VPS would not have.
- [x] **Environment untangled.** `.env.local` and `apps/web/.env` were byte-identical 49-key duplicates, 37 keys of which no code reads (Clerk, Redis, Spring/ledger, SMS, Porichoy, and a pile of never-wired settings). Local is now one file with a symlink, and production is split per host: [.env.render.example](../.env.render.example) and [.env.vercel.example](../.env.vercel.example). See [setup.md](setup.md#environment).

- [x] **Batch C, first half (WO-10, WO-11) + two live defects found on the way.** `pnpm typecheck` now exits **clean with zero errors** — Playwright is wired up (`pnpm test:e2e`, skips unless seeded credentials are set) instead of leaving an orphan spec. Money arithmetic moved out of `user_repository.go` into a tested `internal/money` package (`pnpm test:go`): installment splitting, loan caps, eligibility, default waterfall.
  - **Loan installments were losing the remainder.** `amount / installments` is integer division, so a 10,000 taka loan over 3 months stored 3,333 — three of which is 9,999. The loan agreement PDF already printed an adjusted final installment, so the signed contract and the stored schedule disagreed by up to (installments − 1) taka, and the loan could never reach a zero balance. `money.InstallmentPlan` now returns both figures, with the "repays principal exactly" invariant as a test.
  - **First login was about to break.** Batch A made token revocation real; changing a password revokes every token for that user, with a marker timestamped to the microsecond. JWT `iat` is whole seconds, so the token issued ~200 ms later during first-login re-authentication compared as *older* than the marker and was born revoked — the member would have signed in to a dashboard that 401s on every call. Revocation now compares at second precision.

- [x] **Batch B — runtime hardening (WO-06 → WO-09).** The API no longer dies mid-transaction on deploy: `SIGTERM` drains in-flight requests for up to `SERVER_SHUTDOWN_TIMEOUT` (30 s) before exiting, and the HTTP server has real timeouts so one slow client cannot hold a connection open forever. `/v1/ready` joins `/v1/health` — the first pings Postgres and 503s if it cannot reach it, the second stays cheap so a database blip never triggers a restart. Expired `token_blacklist` and `rate_limits` rows are now swept hourly instead of accumulating forever. Logging moved to `log/slog` JSON with one line per request carrying request ID, user ID, status and duration, and **member email addresses are out of the logs** — user IDs identify people now. New optional env vars (`LOG_LEVEL`, `SERVER_*`, `CLEANUP_INTERVAL`) are documented in [setup.md](setup.md); all have working defaults.

- [x] **Batch A — security defects (WO-01 → WO-05).** Six fixes in one pass. `authFromRequest` now goes through `ValidateToken`, so `token_blacklist` is finally read and logout / password-change end a session (SEC-01) — note this means **changing a password now signs the user out of the current tab too**, which is the intended behaviour but new. `MarkLoanDefaulted`, `MonthlyReport`, `YearlyReport` and `LoanPerformanceReport` gained `requireRoles`, and `/v1/dashboard/admin/*` is now a `chi` group behind a role middleware so the next handler added there is protected by where it is mounted (SEC-02). Gallery `POST`/`PUT`/`DELETE` require ADMIN/SUPER_ADMIN (SEC-03) and both gallery and settings share one origin-checked CORS helper in `lib/cors.ts` (SEC-04). `?access_token=` is deleted; the SSE stream takes a 60-second single-purpose ticket from the new `sse_tickets` table instead (SEC-05). `ParseJSON` bounds every request body at 1 MB (SEC-07). Also fixed on the way past: `BlacklistAllUserTokens` had no `ON CONFLICT`, so a second password change within 24 h silently failed to revoke anything.
- [x] Dead-code cleanup — removed a 17 MB committed Go binary, 27 empty route folders, 2 unused UI components, 4 unused npm dependencies, 2 unused repository methods and 7 unused helper exports; moved 2.3 MB of unreferenced brand masters out of `public/` into `apps/web/assets/brand/` so they are no longer served. Four "unused" Go symbols were **kept and annotated** — they are unused only because SEC-01/SEC-07/RUN-06 were never wired up, so deleting them would delete the fix. Behaviour unchanged; `clearOrgSettingsCache` was wired into the admin settings save instead of deleted, which also fixes stale letterhead on generated documents.
- [x] Documents are English only and drawn as real PDF text — statements/receipts/loan agreements/certificates now produce **selectable, searchable, vector-sharp** PDFs that paginate properly (the previous rasteriser clipped the last line and the footer). One document model, two renderers; `html2canvas` and `jspdf-autotable` dropped. See [ADR-012](decisions.md).
- [x] Reference numbers are sequential and readable — `DEP-2026-000123`, `WDR-…`, `LOAN-…`, `REP-…` from the `document_sequences` table, allocated inside the posting transaction. Replaces random hex suffixes that could collide on the unique `loanNumber`. See [ADR-013](decisions.md). **Run `pnpm db:migrate` before deploying.**
- [x] Document generation rebuilt — `lib/documents/` split into types/format/theme/templates/export; **multi-page PDFs no longer truncate** (the old exporter put one full-height image on a single A4 page), HTML escaping added, amount-in-words (EN + BN), statements now reconcile and classify loan/donation rows instead of leaving credit and debit blank. See [ADR-010](decisions.md).
- [x] New logo rolled out — black-background video frame keyed to transparency and trimmed; header, footer, auth pages, favicon, apple-icon and OG card all repointed to `images/logo/`. See [ADR-011](decisions.md).

Legend: `[x]` done · `[~]` partial · `[ ]` not started

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

- [x] **[SEC-01] Logout and password-change do not revoke sessions.** Fixed in Batch A.
- [x] **[SEC-02] Four admin endpoints authenticate but do not authorise.** Fixed in Batch A.
- [x] **[SEC-03] Gallery `POST`/`PUT`/`DELETE` have no auth check.** Fixed in Batch A.
- [x] **[SEC-05] Access token accepted in `?access_token=`.** Fixed in Batch A.
- [x] **[SEC-07] `utils.MaxRequestBodySize` is never used.** Fixed in Batch A.
- [x] `RUN-06`: `CleanupExpiredTokens` and `CleanupExpiredRateLimits` are written but never called. Fixed in Batch B — an hourly sweep runs from `main.go`.
- [ ] `app/api/v1/loans/[id]/guarantor-approval/route.ts` validates the loan id against a **UUID regex**, but Prisma ids are `cuid()` — every request 400s, so FR-11 is dead in practice.
- [ ] `LoanStatus` still carries legacy `PENDING` / `APPROVED` beside the spec states; two vocabularies for one concept.
- [ ] `/api/v1/settings` upserts any key it receives, so a typo silently creates dead config.
- [x] `/api/v1/settings` sets `Access-Control-Allow-Origin: *` while the Go API uses an allow-list ([SEC-04](production-readiness.md)). Fixed in Batch A — both Next routes now share `lib/cors.ts`, which reads the same `CORS_ORIGINS` list.
- [x] Changing a password left the tab holding a dead token. Fixed — the dialog now signs the user out and redirects to login, which is what "revoke all sessions" has to mean for the tab that triggered it.
- [ ] Withdrawal **notice period is still not validated** (FR-08). The integration tests cover active-loan and active-guarantee blocking; the notice period has no code to test.
- [ ] `audit_logs` append-only is **enforced by convention, not by the database**. The tests prove the application appends and never rewrites, but no trigger or grant stops an `UPDATE`. Worth a DB-level guard before the VPS move.
- [ ] The support chat has **no SSE client yet**. `GET /v1/dashboard/support/stream` and its ticket endpoint are live and authenticated, but nothing in the web app opens an `EventSource` — the UI still polls. A client must `POST /v1/dashboard/support/stream/ticket` and pass `?ticket=` on every connect.

## Gaps

Operational gaps now have ids and an ordering in [production-readiness.md](production-readiness.md); the summary stays here.

- [x] ~~Tests are effectively absent~~ (`CI-01`…`CI-04`). Fixed in Batch C — unit tests for `internal/money`, 17 integration tests against a real Postgres, Playwright wired up.
- [x] ~~No backups~~ (`DATA-01`). Fixed in Batch D — nightly encrypted `pg_dump` in GitHub Actions, retained 30 days (90 monthly).
- [x] ~~No CI~~ (`CI-05`). Fixed in Batch C — typecheck, lint, gofmt, vet, build, unit + integration tests, secret scan.
- [x] ~~No graceful shutdown or server timeouts~~ (`RUN-01`, `RUN-02`). Fixed in Batch B.
- [x] ~~No seed script~~ (`DATA-05`). Fixed in Batch D — `pnpm db:seed`.
- [x] ~~Prisma has no migration history~~ (`DATA-04`). Fixed in Batch D — [ADR-014](decisions.md) supersedes ADR-004.
- [ ] No Dockerfiles — the platform cannot run anywhere but Vercel + Render (`PKG-01`, `PKG-02`). This is the blocker for any VPS/AWS move.
- [ ] No observability: no metrics, error tracking, uptime monitoring, or alerts (`OBS-01`…`OBS-06`).
- [ ] No 48-hour unconfirmed-transaction sweep (needs a scheduled job — `OPS-08`).
- [ ] Withdrawal notice period is unimplemented (`FR-08`) — the policy exists in [product.md](product.md); nothing enforces it.
- [ ] `audit_logs` append-only is convention, not a database constraint (`DATA-08`). A `BEFORE UPDATE OR DELETE` trigger would make rule 6 true rather than intended.
- [ ] Cloudinary assets (NID and member photos) have no backup (`DATA-06`) — the database dump does not cover them.
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
