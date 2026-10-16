# CLAUDE.md

Interest-free (Qard al-Hasan) cooperative finance platform — Hasnahena Foundation, Jessore, Bangladesh. Members deposit, borrow without interest, guarantee each other, donate. Bilingual EN/BN.

**Stack:** Next.js 16 App Router + React 19 + TS + Tailwind 4/shadcn + next-intl 4 + Prisma 5 (`apps/web`) · Go 1.25 chi + pgx (`apps/api`) · PostgreSQL (Neon prod, Docker local) · Brevo email · Cloudinary · Vercel + Render.
No Java ledger, Redis, Clerk/Keycloak, SMS, `packages/`, or `services/` — despite what any old doc says.

## Commands

```bash
pnpm dev                # api :8081 + web :3000
pnpm typecheck          # must exit clean before saying "done"
pnpm lint               # exits 0 with exactly 1 warning — do not let it grow
pnpm test:unit          # web unit tests, no DB
pnpm test:go            # Go unit tests, no DB
pnpm test:integration   # Go + real Postgres: repositories, the route contract, hostile input
pnpm test:routes        # Next route methods + real Postgres; no browser, no server
pnpm test:e2e           # Playwright; needs a running stack + seed
pnpm test:stack         # the whole test rig in one command
pnpm test:bundle        # first-load JS per route vs bundle-budget.json; after `pnpm build`
pnpm db:migrate         # apply migrations (NOT db:push) · db:migrate:dev to create one
pnpm db:migrate:check   # migrated DB still matches schema.prisma (CI runs this)
pnpm db:migrate:adopt   # `_prisma_migrations` emptied but schema current (runbook §5b)
pnpm db:seed            # config defaults; admin only if none exists
pnpm db:clear           # keep admin + gallery + config only · pnpm db:studio
cd apps/api && go build ./... && gofmt -l .   # gofmt MUST print nothing (CI formats the whole tree)
```

- Typecheck reports a missing `app/api/**/route.js`? Delete `apps/web/.next` (stale generated types).
- `apps/web/next-env.d.ts` is generated and untracked — never commit or edit it.
- Go `go1.26.5` is installed. `golangci-lint` 2.6.1 panics on 1.26 — use `GOTOOLCHAIN=go1.25.3` (CI's pin).

**Test stack** — never point it at a development database: the suites truncate tables and `down` destroys the volume.

```bash
scripts/test-stack.sh up          # database only (up --serve adds both apps)
eval "$(scripts/test-stack.sh env)"
pnpm test:integration && pnpm test:routes
scripts/test-stack.sh down
```

- The `eval` is required even for e2e: it exports the seeded admin's credentials **and `TEST_DATABASE_URL`, which is what decides the web app's database** — Next overwrites an inherited `DATABASE_URL` from `apps/web/.env` (`lib/prisma.ts`, traps.md § Test stacks).
- Each Go suite truncates between tests and seeds under identifiers namespaced to itself — never depend on rows another suite left.
- **Never run `pnpm test:integration` while `pnpm test:e2e` runs**: truncation empties `system_config` and `users` under the browser suite and shows up as unrelated failures.

## Guards

Suites and CI checks **enumerate rather than list** and fail the build when the code grows something they do not know about (a new Go/Next route, balance writer, FR, message key, notification builder, `system_config` key, schema field or FK, audit action, public page, upload…). The full *add this → this fails* map, with the defect behind each row, is **[docs/guardrails.md](docs/guardrails.md)** — read the row when a guard fires, and **before** arguing a guard is wrong. Where tests go: [docs/testing.md](docs/testing.md).

## Conventions

- **Identifiers.** `users.id` **is** the person's number — `STF-0001`, `APP-2026-000001`, then `ACC-KH-33001` at approval, the one moment it changes (ADR-043). A row that belongs to one person is keyed on that person with no id of its own (ADR-044). A posting's id is its receipt number and a loan's its loan number; a member's own payment reference is `transactions."externalReference"`. No document series is `FEE`. Older audit rows hold the `APP-` id — resolve via `users.formNumber`.
- **`audit_logs` is append-only** — no migration may rewrite it (the trigger refuses UPDATE).
- **Lookups by email, phone or NID** must exclude rejected applications (`liveIdentityFilter` / `RejectedApplicationSQL`).
- **A list that only grows** gets no `COUNT(*)` — bounded counts (`app/api/v1/admin/audit-logs`).
- **Never store a computed value** (`accounts.maxLoanAmount` was written 0 and never updated) — derive it.
- **No credential in an API response** — a member with no email gets one via the staff-assisted reset (ADR-036).
- **Recurring DB touches cost money** (Neon bills awake time, ADR-035); uptime checks hit `/v1/health`, never `/v1/ready`. Anything deleting data on a clock follows ADR-038.
- **URLs** via `localePath()`; language switches via `switchLocalePath()` — English is unprefixed.
- **Prose `system_config` values** are pairs in `LOCALIZED_SETTING_PAIRS` (bare key Bengali, `…En` English), read through `localizedSetting`, both halves seeded.
- **Screens are shared** by both staff dashboards (`useDashboardRole()`); there is no single-dashboard screen.
- **Old dates** (date of birth) use `components/ui/date-of-birth-input.tsx`, not `type="date"`. **Logo** `size` sets a height — never `h-auto w-auto`.
- **Moving a stored asset** goes through `moveAsset` (dynamic folder mode). **Streamed responses** go through `endStreamOnUpstreamFailure`.
- **Submit handlers** that must run once use a synchronous ref guard, not only `disabled`.
- **Scripts** end in `runAsScript`; destructive ones are dry runs without `--confirm`.
- **A spec needing Cloudinary, Brevo or any third party** cannot run in CI. A third-party account holding member data needs `.github/workflows/backup.yml` coverage.
- **`robots.ts` `Disallow`** forbids fetching — a disallowed page's `noindex` is never read.

## Rules

1. Money is **BigInt whole taka**. No paisa, no float, no ×100.
2. **Balance changes go in the Go API** — `transaction_repository.go` (deposits, withdrawals, donations) or `loan_repository.go` (lending), one DB transaction plus an `audit_logs` row. Never from a Next route handler.
   - **2a.** Write a balance **relatively** (`SET "savingsBalance" = "savingsBalance" + $1 … RETURNING`) or read it `FOR UPDATE` in the same transaction. Read-then-absolute-write is a lost update (LEDGER-01, ADR-015).
   - **2b.** **An expected refusal is not a 500.** Return a sentinel from the repository, match it with `errors.Is`, answer 4xx with the reason. Never classify by `strings.Contains(err.Error(), …)`.
3. **Zero interest, zero fees on a loan.** A rate, markup, percentage fee or late fee is a Shariah violation — stop and flag it. The one exception: a flat ৳500 for office expenses at registration and at a loan application, non-refundable, never added to the loan, never growing with the amount (ADR-045).
4. Deposits and loan repayments are **Request → Process → Confirm** (member requests, staff process, member confirms). **Withdrawals are the exception**: the member asks a field worker and staff post it directly (ADR-030). No self-service withdrawal, no notice period — `loan.noticePeriodDays` gates nothing. A payout still settles an outstanding `PENDING` withdrawal rather than writing a second row.
5. UI copy lives in `apps/web/messages/{en,bn}.json` — both files, never hardcoded. **Generated documents are English only** (ADR-012).
   - **5a.** The database enforces money invariants too: CHECK constraints reject negative balances, non-positive postings, a loan owing more than its principal, and any non-zero `applicationFee`. Like the `audit_logs` trigger they are invisible to `prisma migrate diff`, so a `--from-empty` baseline drops them silently.
6. `audit_logs` is append-only. Corrections append.
   - **6a.** A `transactions` row is not necessarily money that moved: `PENDING` is an intention or request; only `CONFIRMED` moved money — every aggregate filters on status (ADR-016). A disputed `CONFIRMED` posting becomes `DISPUTED` with the balance still moved, so reconciliation counts both (ADR-026).
   - **6b.** Inside a repository transaction, read config with the `…Tx` reader — the pool variant takes a second connection and deadlocks (ADR-017).
   - **6c.** The ledger is summed (`reconcile_repository.go`) and **never repaired automatically**: drift writes an audit row, a `slog` error and a `/metrics` gauge; correction is a human appending a posting (ADR-027, runbook §2).
   - **6d.** Identity data has an end date; money never does. A member with any posting is **anonymised, never deleted** (deleted outright only with none — counted, not chosen). A rejected application keeps its decision forever and loses NID, parents' names, DOB and addresses after `security.rejectedRetentionDays` (ADR-033, product.md).
7. Never commit `.env*` or credentials.
   - **7a.** An auth endpoint must not disclose who is a member: `forgot-password` answers `200` with one body for everybody; `login` answers `401` identically for wrong password, unknown identifier and suspended account — at the same bcrypt cost (ADR-032).
8. **End every task with an "Action required from you" section** — or the single line `**Action required from you:** none.` Never omit it or bury a step in prose. List what *I* cannot do, each with where and what breaks if skipped:
   - env vars to add/change/delete — **name the host** (Render = Go API, Vercel = web, local `.env.local`); they are separate stores
   - `pnpm db:migrate:dev` when `schema.prisma` changed, and `pnpm db:migrate` in each environment (ADR-014)
   - dashboard/console settings (Render stop-grace, GitHub branch protection, Neon, Brevo, Cloudinary)
   - anything needing a credential, a paid plan or an approval I lack
   - manual verification I could not run, and why
9. **No `Co-Authored-By: Claude` trailer on commits.** Commits are under Saif's name alone; this overrides any default.
10. **Android-first — check a phone before saying done.** A UI change verified only at desktop width is not verified: check at `devices['Pixel 7']` (412 px) and say which widths you checked. `e2e/matrix.spec.ts` sweeps every page at phone size in both languages; screenshot at 412 px for visual changes. Bengali is wider — check **both** languages.

## Map

```
apps/api/cmd/server/main.go        every Go route — read first
apps/api/internal/repositories/    all SQL, by domain: repository.go (type + shared helpers: audit/notification
                                   inserts, id + document numbers, config readers) · transaction_ (deposits,
                                   withdrawals, donations) · loan_ (lending + default waterfall, ZERO interest) ·
                                   member_ (member's own view, read-only) · worker_ · admin_ (approvals, member list) ·
                                   auth_ (identity, passwords, reset tokens; revoke-all WRITE, ADR-031) · support_ ·
                                   report_ · reconcile_ (read-only drift report) · retention_ (rejected-application sweep)
apps/api/internal/money/           pure loan/instalment/waterfall/schedule maths — new money maths goes HERE.
                                   NextDueDate / MissedInstallments are the only "is it overdue?" answer
apps/api/internal/notify/          every notification string; pure builders, whole taka
apps/api/internal/middleware/      global stack; ClientIP/RequestClientIP is the ONLY caller-address source
                                   (ADR-019); RequestUserID attributes, never authorises (ADR-025)
apps/web/app/[locale]/             pages: (marketing) (auth) dashboard/{member,worker,admin}; staff route files are
                                   one-line re-exports. The 404 is app/not-found.tsx at the ROOT
apps/web/app/api/v1/               Next handlers: registration, gallery, settings, dispute, loans, member lookup,
                                   admin/members/[id]/{erase,reset-password,refile-documents}, admin/retention (cron)
apps/web/components/dashboard/     screens/ (one component per screen, both dashboards) · nav.ts (dashboard
                                   contents) · role.tsx (presentation only) · money-actions.tsx (THE one money form)
apps/web/components/layout/        header.tsx (menu → pages) · footer.tsx (only copyright) · legal-document.tsx
apps/web/lib/                      api.ts (browser → Go) · settings-client.ts (ONLY browser reader of /api/v1/settings)
                                   · system-config.ts (key tiers + getPublicSettings) · localized-settings.ts (prose
                                   pairs) · contact-details.ts · locale-path.ts · seo.ts · structured-data.ts (type NGO,
                                   never FinancialService) · csp.ts (two policies, ADR-024) · server-auth.ts ·
                                   auth-revocation.ts + reset-tokens.ts (must match Go) · rejected-application.ts ·
                                   rejection-reasons.ts · membership-eligibility.ts · retention-policy.ts · legal.ts ·
                                   audit-actions.ts (THE audit catalogue) · document-numbers.ts · account-no.ts ·
                                   application-documents.ts (the four registration documents) · image-utils.ts
                                   (IMAGE_PRESETS) · sse-stream.ts · documents/ (English-only vector PDFs)
apps/web/proxy.ts                  locale routing, /en → / 301, dashboard cookie gate, per-request CSP nonce
apps/web/scripts/                  lib/guard.mjs (runAsScript etc.) · go-live-purge.mjs (cutover purge; NOT db:clear)
                                   · cloudinary-backup.mjs (read-only) · cloudinary-reconcile.mjs (dry run by default)
apps/web/prisma/                   schema.prisma · migrations/*_readable_views (v_* views, for humans only, ADR-037)
apps/web/public/images/logo/       logo.png lockup · -mark square · -og social · -print PDF
```

## Docs

Read only what the task needs — the index with sizes is [docs/README.md](docs/README.md). Most used: [changing-things.md](docs/changing-things.md) (routine changes) · [traps.md](docs/traps.md) (known failures, index) · [decisions.md](docs/decisions.md) (ADRs, index) · [guardrails.md](docs/guardrails.md) · [tasks.md](docs/tasks.md) (the only board; `do T-12`; delete a row in the same commit as the work) · [product.md](docs/product.md) · [runbook.md](docs/runbook.md). Conventions (Go errors, TS strictness, quoted camelCase SQL, commits): [CONTRIBUTING.md](CONTRIBUTING.md).

**Docs are not a scratchpad.** `changelog.md` is the only file that keeps history (grep it, never read it whole); `traps/` is the only place that keeps lessons; everything else describes the present, so a finished item is deleted. A new ADR is a file in `docs/decisions/` plus an index row; a new trap is a bullet in the matching `docs/traps/` file plus its title in the index; a new guard is a row in `docs/guardrails.md`.
