# CLAUDE.md

Interest-free (Qard al-Hasan) cooperative finance platform — Hasnahena Foundation, Jessore, Bangladesh. Members deposit, borrow without interest, guarantee each other, donate. Bilingual EN/BN.

**Stack:** Next.js 16 App Router + React 19 + TS + Tailwind 4/shadcn + next-intl 4 + Prisma 5 (`apps/web`) · Go 1.25 chi + pgx (`apps/api`) · PostgreSQL (Neon prod, Docker local) · Brevo email · Cloudinary · Vercel + Render.
No Java ledger, Redis, Clerk/Keycloak, SMS, `packages/`, or `services/` — despite what any old doc says.

## Commands

```bash
pnpm dev        # api :8081 + web :3000        pnpm db:migrate # apply migrations (NOT db:push)
pnpm typecheck  # run before saying "done"     pnpm db:seed    # config defaults; admin only if none exists
pnpm lint                                      pnpm db:clear   # keep admin+gallery+config only
                                               pnpm db:studio
pnpm test:unit  # web unit tests, no DB        pnpm test:e2e   # Playwright; needs a running stack + seed
pnpm test:go    # Go unit tests, no DB needed  pnpm test:stack # bring the whole test rig up in one command
pnpm test:integration   # Go + real Postgres: repositories, the 64-route contract, hostile input
pnpm test:routes        # the Next route methods + real Postgres; no browser, no server
pnpm db:migrate:check   # the migrated database still matches schema.prisma (CI runs this)
pnpm db:migrate:adopt   # `_prisma_migrations` was emptied but the schema is current — record
                        # every migration as applied, run none (docs/runbook.md §5b)
pnpm test:bundle        # first-load JS per route vs bundle-budget.json; needs a prior `pnpm build`
cd apps/api && go build ./... && gofmt -l .    # Go check. gofmt MUST print nothing —
                                               # CI formats the whole tree with no exclusions
```

`pnpm lint` exits 0 with **1 warning** — do not let the count grow.

`pnpm typecheck` must exit **clean, zero errors**. Any error is yours. If it reports a missing `app/api/**/route.js`, delete `apps/web/.next` first — those are stale generated route types, not your bug.

`apps/web/next-env.d.ts` is generated and **untracked** (Next documents it as an implementation detail). Never commit it, never edit it; `next dev` and `next build` write different contents, which is why it used to dirty the tree on every run.

Go **is** installed (`go1.26.5`). `go build`, `go vet`, `go test` work directly. `golangci-lint` 2.6.1 panics on a 1.26 toolchain — use `GOTOOLCHAIN=go1.25.3`, which is what CI pins.

The database-backed suites need a database, and `pnpm test:stack` is the one
command that supplies it — Postgres on a non-default port, migrated, seeded,
optionally serving both apps. Never point it at a development database: these
suites truncate tables, and `down` destroys the volume.

```bash
scripts/test-stack.sh up          # database only
eval "$(scripts/test-stack.sh env)"
pnpm test:integration && pnpm test:routes
scripts/test-stack.sh down
```

`eval "$(scripts/test-stack.sh env)"` is not optional even for the browser
suite: it exports the seeded admin's credentials, and without them two specs
fail with `Set E2E_ADMIN_IDENTIFIER and E2E_ADMIN_PASSWORD`. It also exports
**`TEST_DATABASE_URL`, which is what actually decides the web app's database** —
Next overwrites an inherited `DATABASE_URL` from `apps/web/.env` before any of
this repo's code runs, so `DATABASE_URL` alone puts the Go API on the test
database and the web app on **your own**. See `apps/web/lib/prisma.ts` and
[docs/traps.md](docs/traps.md) § Test stacks.

Order does not matter: the Go suites truncate every table between tests, so each
suite seeds what it needs under identifiers namespaced to itself. Keep it that
way — a test depending on rows another suite left behind passes or fails on
package ordering.

**Concurrency does matter.** Never run `pnpm test:integration` while
`pnpm test:e2e` is in flight: the truncation empties `system_config` and `users`
under the browser suite, and it does not present as an empty database — it
presents as four unrelated specs failing on their own subject matter. Run them
one after the other.

**The suites and CI checks below enumerate rather than list, and will fail the
build when the code grows something they do not know about.** That is deliberate
— a list a human maintains goes stale the day it is written, which is why the
count that used to open this sentence is gone too. See
[docs/testing.md](docs/testing.md).

**Each row is compressed to the guard that fires.** The defect that put it
there — which is the part that stops the idea coming back — is the same row,
in full, in [docs/guardrails.md](docs/guardrails.md). Read that row when a
guard fires and the one-liner is not enough, and **before** arguing that a
guard is wrong.

| Add this | And this fails until you act |
|---|---|
| a Go route | `cmd/server/routes_integration_test.go` |
| a Next route file | `apps/web/test/routes/routes.contract.test.ts` |
| a repository method that writes a balance | `TestBalanceWritersAreEnumerated` |
| an FR, or a change of FR status | `apps/web/test/unit/requirements.test.ts` |
| a notification builder | `internal/notify/messages_test.go` |
| a notification message built **outside** `internal/notify` | `internal/notify/repositories_test.go` |
| a key in `messages/{en,bn}.json` | `apps/web/test/unit/messages.test.ts` |
| a Next route that returns a row from `transaction`, `loan`, `account` or `documentSequence` | `apps/web/test/routes/success-paths.test.ts` |
| a Prisma call in a route handler | `apps/web/test/unit/floating-promises.test.ts` |
| a background loop in `main()` | `apps/api/cmd/server/wiring_test.go` |
| a field in `schema.prisma` | `pnpm db:migrate:check` in CI |
| a **foreign key** in `schema.prisma` | `apps/web/test/unit/foreign-key-indexes.test.ts` |
| a `settings['…']` read in a page | `apps/web/test/unit/settings-keys-read.test.ts` |
| `CREATE TABLE` / `ALTER TABLE` in a repository | `apps/api/internal/repositories/schema_ownership_test.go` |
| a label removed from an enum in `schema.prisma` | `apps/web/test/unit/enum-literals.test.ts` |
| a `/support/*` route in `main.go` | `apps/web/test/unit/support-proxy-allowlist.test.ts` |
| a generator that maps random bytes onto an alphabet | `internal/utils/random_test.go` |
| the donation pool's owner id, in either language | `apps/web/test/unit/donation-pool-owner.test.ts` |
| a labelled identifier to a generated document | `apps/web/lib/documents/builders.test.ts` |
| a `system_config` key a **public** page reads | `apps/web/test/unit/settings-keys-read.test.ts` |
| a page under `app/[locale]/` that is neither dashboard nor auth | `apps/web/scripts/assert-static-routes.mjs` after `pnpm build` |
| a repository read on a hot path | `TestHotReadsDoNotSelectStar` |
| a header set in `proxy.ts` | `apps/web/e2e/locale-negotiation.spec.ts` |
| a `setInterval` in the dashboard shell | `apps/web/e2e/dashboard-traffic.spec.ts` |
| a **public page**, or a path in `publicPagePaths` | `apps/web/test/unit/structured-data.test.ts` |
| a `dangerouslySetInnerHTML` | `apps/web/test/unit/csp.test.ts` |
| an invariant to `repositories.AllChecks` | `apps/api/internal/repositories/reconcile_integration_test.go` |
| a write reachable from the reconciliation job | `apps/api/cmd/server/wiring_test.go` |
| an import to a shared component | `apps/web/scripts/assert-bundle-budget.mjs` after `pnpm build` |
| a `system_config` key | `apps/web/test/unit/settings-keys-read.test.ts` |
| a form that posts a money `amount` | `apps/web/lib/utils.test.ts` |
| a lookup by **email, phone or NID** | `apps/web/test/unit/rejected-application.test.ts` |
| a **second spelling of "rejected application"** | the same test |
| a **rejection reason** | `apps/web/test/unit/rejection-reasons.test.ts` |
| a **default value on the admin Settings screen** | `apps/web/test/unit/org-defaults.test.ts` |
| a page title, or the site's own name | `apps/web/test/unit/seo.test.ts` |
| **member-facing copy about a loan** | `apps/web/test/unit/messages.test.ts` |
| a loan list, or a `nextDueDate` | `apps/api/internal/repositories/loan_schedule_integration_test.go` |
| a rate-limited action | `apps/api/internal/services/rate_limit_policy_test.go` |
| a row in `password_reset_tokens`, in **either** language | `apps/web/test/unit/reset-token-scopes.test.ts` |
| a branch in `forgot-password` that depends on what the lookup found | `apps/api/cmd/server/auth_security_integration_test.go` |
| a **branch that deactivates or deletes a staff or member account** | `apps/web/test/unit/revocation-contract.test.ts` |
| a second writer of `token_blacklist`, in **either** language | the same test |
| **anything that erases or expires personal data** | `apps/web/test/routes/identity-integrity.test.ts` and… |
| an internal **URL** anywhere in `app/`, `components/` or `lib/` | `apps/web/test/unit/locale-routing.test.ts` |
| a **language switch** | the same test |
| **copy written into a component on a public page** | `apps/web/e2e/locale-content.spec.ts` |
| a `system_config` value that is **prose** | add it to `LOCALIZED_SETTING_PAIRS` in `apps/web/lib/localized-settings.ts` as `key`/`keyEn`, and read it… |
| a **new prose pair** | the same test |
| a control on **Content & Media** or **Settings** | `apps/web/test/unit/settings-keys-read.test.ts` |
| a **field to `users` that a seed fills in** | `apps/web/test/unit/purge-script.test.ts` |
| a **recurring database touch** — a ticker, a poll, a health check, a pool minimum | `apps/api/internal/config/idle_cost_test.go` |
| an **uptime or liveness check** | point it at `/v1/health`, which touches nothing |
| a **rewrite of `audit_logs` in a migration** | you cannot, and the one that happened is the argument. The append-only trigger refuses UPDATE… |
| a **person's id in an older audit row** | resolve it through `users.formNumber`, in the same query. A person's id moves once, at admission, and the… |
| a **row that a person is** | `users.id` **is** their number |
| a **row that belongs to one person** | it is keyed on that person, and carries no id of its own ([ADR-044](docs/decisions.md)): `accounts` and… |
| a **posting, or a loan** | `apps/api/internal/repositories/document_numbers_test.go` |
| a **member's own payment reference** | `transactions."externalReference"`, never the id |
| a **document series** | not `FEE`, whatever the enum label says |
| a **staff or member account number** | `apps/web/lib/account-no.test.ts` |
| a **file uploaded on somebody's behalf** | `apps/web/test/unit/image-uploads.test.ts` |
| an **image upload**, anywhere | `apps/web/test/unit/image-uploads.test.ts` |
| a **transparent image** to a compressor or a Cloudinary transformation | the same test |
| a `system_config` key an **admin uploads or types** | the same test *and* `settings-keys-read.test.ts` |
| a **logo, or a fixed header's height** | `apps/web/e2e/matrix.spec.ts` measures the lockup against the header it sits in, **with a floor as well as… |
| a **prose pair, or a public page that reads one** | `apps/web/test/unit/localized-settings.test.ts` also requires a **seed row for both halves**, with real… |
| a spec that needs **Cloudinary, Brevo or any third party** | it cannot run in CI |
| **copy on `/privacy` or `/terms`** | `apps/web/lib/legal.test.ts` and `apps/web/test/unit/messages.test.ts` |
| **copy to a page under `app/[locale]/(auth)/`** | `apps/web/test/unit/messages.test.ts` |
| a **figure to a public page** | `apps/web/test/unit/public-figures.test.ts` |
| a **default in `scripts/seed.mjs`** that could already exist as a blank row | `apps/web/test/unit/localized-settings.test.ts` |
| a **public accessor that reads the database** | `apps/web/test/unit/public-content-fallback.test.ts` |
| a way for the **web app** to reach the database in a test | `apps/web/test/unit/test-stack-database.test.ts` |
| a **`v_*` view**, or a rename of any column one names | `apps/web/test/unit/database-views.test.ts` |
| a **column that stores a computed value** | the same test, and ask what recomputes it. `accounts.maxLoanAmount` was written 0 at creation and never… |
| an **`audit_logs` row**, in either backend | `apps/web/test/unit/audit-actions.test.ts` |
| anything that **deletes or expires data on a clock** | [ADR-038](docs/decisions.md) |
| a **document uploaded before somebody is a member** | `apps/web/test/unit/image-uploads.test.ts` |
| a **credential to an API response** | `apps/web/test/unit/approval-credentials.test.ts` |
| a **list that only grows** | don't `COUNT(*)` it |
| a **date field for something that happened long ago** | use `components/ui/date-of-birth-input.tsx`, not `type="date"`. The platform calendar opens on this month,… |
| a **column to `users`** | `apps/web/test/routes/identity-integrity.test.ts` |
| a **page of a list that only grows** | `apps/web/test/unit/pagination.test.ts` and the bounded count in `app/api/v1/admin/audit-logs/route.ts` |
| a **`Disallow` in `robots.ts`** | ask whether the page is linked. `Disallow` forbids *fetching*, so a crawler never reads a `noindex` on the… |
| a **submit handler for anything that must happen once** | `apps/web/e2e/forms.spec.ts` |
| an **entrance animation on a public page** | `apps/web/e2e/scroll-reveal.spec.ts`. It asserts the NEGATIVE — that elements below the fold are actually hidden…|
| **SQL inside a Go string** | `apps/api/internal/repositories/sql_schema_census_test.go` |
| **a script under `apps/web/scripts/`** | `apps/web/test/unit/script-safety.test.ts` |
| **an overlay, modal or lightbox** | `apps/web/e2e/gallery-lightbox.spec.ts` |
| an **upload, or a spec that causes one** | `apps/web/test/unit/script-safety.test.ts` and the guard in `uploadImage` |
| a **move of a stored asset** | `moveAsset`, never `uploader.rename` on its own. This account is in **dynamic folder mode**: `public_id`… |
| a **streamed response** | `endStreamOnUpstreamFailure` from `lib/sse-stream.ts`. Next pipes the body *after* the handler returns, so… |
| a **third-party account holding member data** | `.github/workflows/backup.yml` |
| a screen to one staff dashboard | there is no such thing |

## Rules

1. Money is **BigInt whole taka**. No paisa, no float, no ×100.
2. **Balance changes go in the Go API** — `internal/repositories/transaction_repository.go` (deposits, withdrawals, donations) or `loan_repository.go` (lending), one DB transaction, plus an `audit_logs` row. Never from a Next route handler.
2b. **An expected refusal is not a 500.** A withdrawal with no matured notice, a
   guarantor whose savings are locked, a deposit against a suspended member —
   these are answers, not faults. Return a sentinel from the repository, match it
   with `errors.Is` in the handler, and answer 4xx with the reason. Classifying
   by `strings.Contains(err.Error(), …)` is how "is guarantor for active loan"
   got reported as "has an active loan", and how FR-08's two refusals became
   `500 Failed to process withdrawal` on both admin screens at once. (Those two
   refusals no longer exist — [ADR-030](docs/decisions.md) — but the rule they
   taught does.)
2a. **Write a balance relatively** (`SET "savingsBalance" = "savingsBalance" + $1 ... RETURNING`), or read it `FOR UPDATE` inside the same transaction. Reading it from the pool and writing back an absolute total is a lost update: it silently destroys money and makes the ledger disagree with the balance. That was LEDGER-01, fixed 2026-08-17 and pinned by concurrency tests — see [ADR-015](docs/decisions.md).
3. **Zero interest, zero fees.** A rate, markup, or processing fee is a Shariah violation — stop and flag it.
4. Lifecycle is **Request → Process → Confirm** for deposits and loan
   repayments: the member requests, staff process, the member confirms.
   **Withdrawals are the exception** — the member asks a field worker in person,
   and staff post it directly ([ADR-030](docs/decisions.md)). There is no
   self-service withdrawal request and no notice period; `loan.noticePeriodDays`
   is what the foundation *asks* for and gates nothing. A payout still settles an
   outstanding `PENDING` withdrawal when one exists, rather than writing a second
   row for the same money.
5. UI copy lives in `apps/web/messages/{en,bn}.json` — both files, never hardcoded in a component. **Generated documents are English only** (ADR-012).
6. `audit_logs` is append-only. Corrections append.
5a. **The database enforces the money invariants too.** CHECK constraints reject
   a negative balance, a non-positive posting, a loan owing more than its
   principal, and any non-zero `applicationFee` — rule 3 at a layer neither
   backend can go around. They are invisible to `prisma migrate diff`, like the
   `audit_logs` trigger, so a `--from-empty` baseline would drop them silently.
6a. **A `transactions` row is not necessarily money that moved.** A `PENDING`
   withdrawal is an unpaid intention and a `PENDING` deposit is a request; only
   `CONFIRMED` moved money. Any aggregate over `transactions` must filter on
   status — four were not, and counted intentions as income
   ([ADR-016](docs/decisions.md)). **And the converse**: a `CONFIRMED` posting a
   member disputes becomes `DISPUTED` while the balance stays moved, so
   reconciliation counts both ([ADR-026](docs/decisions.md)).
6c. **The ledger is summed hourly and never repaired automatically.** A wrong
   balance looks exactly like a correct one until somebody adds it up; that job
   is `reconcile_repository.go`, and on drift it writes an audit row, a `slog`
   error and a `/metrics` gauge. Correcting it is a human decision, appended as a
   new posting ([ADR-027](docs/decisions.md), [runbook.md](docs/runbook.md) §2).
6b. **Inside a repository transaction, read config with the `…Tx` reader.** The
   pool-based variant takes a second connection and deadlocks the pool under
   concurrency ([ADR-017](docs/decisions.md)).
7. Never commit `.env*` or credentials.
6d. **Identity data has an end date; the money never does.** A member with any
   posting is **anonymised, never deleted** — a posting whose owner has vanished
   does not make the hourly reconciliation smaller, it makes it permanently
   wrong. A member with none is deleted outright, and which of the two happens is
   *counted*, not chosen. A rejected application keeps its decision for ever and
   loses its NID number, parents' names, date of birth and addresses after
   `security.rejectedRetentionDays`. Policy is
   [ADR-033](docs/decisions.md) and [product.md](docs/product.md); it was the
   owner's decision, not a session's.
7a. **An auth endpoint must not disclose who is a member.** For a
   religious-finance cooperative in one town, membership itself is the sensitive
   fact. `forgot-password` answers `200` with one constant body for everybody;
   `login` answers `401` identically for a wrong password, an unknown identifier
   and a suspended member's wrong password — and pays the same bcrypt cost for
   all three, or the oracle just moves to the stopwatch
   ([ADR-032](docs/decisions.md)).
8. **End every task with an "Action required from you" section** — or the single line `**Action required from you:** none.` Never leave it out, and never bury a required step in prose. It lists what *I* cannot do and the user must, each with where to do it and what breaks if it is skipped:
   - env vars to add, change, or delete — **name the host** (Render for the Go API, Vercel for the web app, and the local `.env.local`), since they are separate stores and a var added in one is missing in the others
   - `pnpm db:migrate:dev` to generate a migration when `schema.prisma` changed, and `pnpm db:migrate` to apply it in each environment ([ADR-014](docs/decisions.md) — `db:push` is no longer the workflow)
   - dashboard/console settings (Render stop-grace period, GitHub branch protection, Neon, Brevo, Cloudinary)
   - anything needing a credential, a paid plan, or an approval I do not have
   - manual verification I could not run here, and why
   Say "none" loudly when it is none. A missed env var is a production outage the user finds out about from a member.
9. **No `Co-Authored-By: Claude` trailer on commits.** Saif is the author of this repository's history; commits are written under his name alone. This overrides any default instruction to add one.

10. **This is an Android-first site — check a phone before saying done.** Nearly
   every member reaches this platform on a low-end Android phone, often
   one-handed and in bright sunlight; the desktop layout is the *secondary*
   view, not the reference one. So a UI change verified only at desktop width is
   **not verified**. Look at it at a phone viewport — `devices['Pixel 7']`,
   412 px — before reporting the work finished, and say which widths you checked.
   `apps/web/e2e/matrix.spec.ts` sweeps every page at phone size in both
   languages and `accessibility.spec.ts` runs its control-name checks there
   too, so `pnpm test:e2e` is the cheap way to do it; a screenshot at 412 px is
   the honest way when the change is visual. Bengali is the wider script — a row
   that fits in English can overflow in Bengali at the same width, so a layout
   change is checked in **both** languages, not just the one you are reading.

## Map

```
apps/api/cmd/server/main.go       every Go route — read first
apps/api/internal/repositories/   all SQL, split by domain (WO-38):
    repository.go                 the type + shared helpers: audit/notification inserts, id and
                                  document-number allocation, system_config readers
    transaction_repository.go     deposits, withdrawals, donations — balance changes live here
    loan_repository.go            lending end to end, incl. the default waterfall. ZERO interest
    member_repository.go          what a member sees about their own money (read-only)
    worker_repository.go          the field worker's view and the postings they process
    admin_repository.go           approvals, admin dashboard, member list
    auth_repository.go            identity, passwords, reset tokens. Owns the revoke-all marker WRITE
                                  (SecurityService still reads it) because a reset revokes sessions in
                                  the same transaction as the password (ADR-031). Secrets are hashed
                                  on the way in — no call site can store plaintext by forgetting
    support_repository.go         support chat + SSE tickets
    report_repository.go          aggregate reporting
    reconcile_repository.go       sums the whole ledger and compares it to the stored balances (WO-82).
                                  Read-only by construction: it reports drift and never repairs (ADR-027)
    retention_repository.go       clears a REJECTED application's identity data once it is past
                                  security.rejectedRetentionDays (WO-93, FR-23, ADR-033). Daily loop in
                                  main(). The *member* erasure half is a Next route instead, because it
                                  has to delete the Cloudinary assets
apps/api/internal/money/          pure loan/installment/waterfall/schedule arithmetic — tested, no DB.
                                  Put new money maths HERE, not inline in SQL. NextDueDate and
                                  MissedInstallments are the only answer to "is this loan overdue?" —
                                  the API sends the verdict, the browser must not re-derive it
apps/api/internal/notify/         every member- and staff-facing notification string. Pure builders,
                                  whole taka, table-tested with a census. Nothing else may build one
apps/api/internal/middleware/     the global stack, mounted by mountMiddleware in main.go. ClientIP is the
                                  ONLY place that decides a caller's address — never read X-Forwarded-For
                                  in a handler; use RequestClientIP(r) (ADR-019). Identity does the same
                                  for *who* a caller is: RequestUserID(r), verified signature and expiry
                                  only — for attributing a request, never for authorising one (ADR-025)
apps/web/app/[locale]/            pages: (marketing) (auth) dashboard/{member,worker,admin}. Every
                                  staff route file is a one-line re-export — edit the screen, not it.
                                  The 404 is app/not-found.tsx, at the ROOT — a segment's not-found.tsx
                                  only catches notFound() thrown inside it, and an unmatched URL never
                                  reaches the segment, so one under [locale]/ renders for nothing
apps/web/components/layout/       header.tsx  the menu — PAGES, not home-page anchors, since T-10
                                  footer.tsx  the only copyright, built from the year and org.name
                                  legal-document.tsx  the shell /privacy and /terms both render into
apps/web/components/dashboard/    screens/  the worker and admin dashboards, ONE component each. Both
                                  role folders re-export the same file; the screen asks
                                  useDashboardRole() and hides what that role may not do
                                  nav.ts    the single description of what each dashboard contains.
                                  The sidebar renders it; the overview used to render it a second time
                                  as "Action Center" cards and no longer does, so `blurb*` is gone too.
                                  The Approvals item carries a red dot while the queue is not empty —
                                  the shell subscribes to the SAME SWR key the approvals screen uses,
                                  which is what puts it out live rather than on the next poll
                                  role.tsx  which dashboard a screen is in. Presentation only:
                                  the API decides, and proxy.ts pins the URL segment to the role
                                  money-actions.tsx  the ONE deposit / withdrawal / instalment /
                                  loan-application / loan-top-up form. Every screen opens it; it
                                  fetches the member detail its rules are about. Never write a second one
apps/web/app/api/v1/              Next handlers: registration, gallery, settings, dispute, loans, member
                                  lookup, and admin/members/[id]/erase — FR-23's anonymise-or-delete
apps/web/lib/api.ts               browser → Go client (apiGet/apiPost/apiPut/apiPatch)
apps/web/lib/csp.ts               the two Content-Security-Policies and why there are two (ADR-024)
apps/web/lib/seo.ts               canonical URLs, hreflang (incl. x-default), OG/Twitter metadata, and
                                  resolveSiteOrigin — which THROWS on a production build with no site URL
apps/web/lib/structured-data.ts   the JSON-LD builders. Type is NGO, never FinancialService — those carry
                                  interestRate and fee properties that misrepresent a Qard al-Hasan fund
apps/web/lib/system-config.ts     every system_config key, split into public / member / admin tiers,
                                  plus the cached getPublicSettings() every marketing page renders from
apps/web/components/ui/date-of-birth-input.tsx  day / month / year selects. The one date in this
                                  application that is decades in the past, and therefore the one that
                                  must not be a calendar. Value in and out is the same ISO string the
                                  form and the API already used
apps/web/components/ui/count-up.tsx  the hero figures, counting up from zero. Takes the admin's STRING
                                  (`৳২৫ লক্ষ+`), finds the number inside it and puts the ৳, the word and
                                  the + back — because a figure here is copy with a number in it, in
                                  either script. Renders the finished value server-side and for reduced
                                  motion; the animation is layered on after
apps/web/lib/application-documents.ts  the four registration documents, and what happens to them.
                                  APPLICATION_DOCUMENTS is the ONE list of their names — the upload, the
                                  `documents` row and the move all derive from it. fileApplicationDocuments
                                  renames them into people/<accountNo> at approval (ADR-040);
                                  purgeApplicationDocuments deletes them at a refusal (ADR-038)
apps/web/app/api/v1/admin/members/[id]/refile-documents/  the approval half of ADR-040. Called by the
                                  approvals screen the moment an approval succeeds, and by the nightly
                                  sweep for the call that never arrived. Separate from the approval so a
                                  third-party image host cannot fail a database transaction
apps/web/app/api/v1/admin/members/[id]/reset-password/  the staff-assisted reset (ADR-036). Most members
                                  have no email, so forgot-password does not exist for them. Admin only,
                                  revokes every session in the same transaction as the password
apps/web/lib/image-utils.ts       IMAGE_PRESETS — how small each kind of image needs to be, and which
                                  ones keep transparency. Every uploader compresses through this BEFORE
                                  validating: the size limit describes what is stored, not what a phone
                                  camera produces, and it is what keeps a Server Action body under the cap
apps/web/components/dashboard/branding.tsx  branding.dashboardLogo for the shell. A client fetch of a PUBLIC
                                  key, deliberately — reading it in the dashboard's server layout put a
                                  database round trip on every navigation and logged the reader out
apps/web/scripts/go-live-purge.mjs  the cutover purge. Names its survivors rather than finding them, and
                                  is a dry run without --confirm. SCRUBS a reused admin row rather than
                                  re-roling it — a seed's invented NID on an admin is a real member refused
                                  at registration. --keep-passwords once they have chosen their own,
                                  --admins-only to change nothing else. NOT pnpm db:clear (docs/go-live.md §1.1)
apps/web/lib/settings-client.ts   the ONLY way the browser may read /api/v1/settings — it attaches the
                                  token, and without one the caller silently gets the public subset
apps/web/proxy.ts                 locale routing, the dashboard cookie gate, and the per-request CSP nonce.
                                  Also the 301 from `/en/*` to the unprefixed form — before next-intl
                                  runs, because next-intl's own as-needed redirect is a 307 (ADR-034)
apps/web/lib/locale-path.ts       every internal URL. English is unprefixed and Bengali is not, so
                                  `/faq` and `/bn/faq` — localePath() is the only place that knows
apps/web/lib/rejected-application.ts  who counts as a REJECTED application, and therefore who owns an email,
                                  a phone number and an NID. Uniqueness is scoped to live rows so a rejected
                                  applicant can re-apply — every lookup by contact detail must exclude them
apps/web/lib/rejection-reasons.ts the codes an admin picks from when refusing an application. The Go twin is
                                  the allow-list in dashboard_handler.go and the sentences in email_service.go
apps/web/lib/membership-eligibility.ts  the age floor, from `membership.minimumAgeYears`. Pure, so the form,
                                  the API and the Settings screen share one answer
apps/web/lib/localized-settings.ts  EVERY system_config value that is prose, in the reader's language.
                                  LOCALIZED_SETTING_PAIRS is the list; the bare key is Bengali and the
                                  `…En` twin is English, each falling back to the other. Its own module,
                                  not part of system-config.ts, because the footer is a client component
                                  and that file imports Prisma. Named for the mechanism, not for
                                  org.address, because taking the reported key produced this bug four times
apps/web/lib/contact-details.ts   the address, phone and email the footer, the home page, /contact and
                                  /support all show — one reader, so they cannot disagree about a missing
                                  value again. They did: two showed a blank, two showed `+880 1XXX-XXXXXX`
apps/web/app/.well-known/security.txt/  RFC 9116 disclosure contact. GENERATED, not a file in
                                  public/ — `Expires` is mandatory and a lapsed file is invalid, so a date
                                  somebody must remember to move is one that stops being true silently.
                                  Contact is `org.email`, the same address every public page shows
apps/web/lib/legal.ts             when /privacy and /terms were last revised. The WORDING is
                                  messages/{en,bn}.json under `legal.*` — that is what puts it inside the
                                  fee-promise census
apps/web/lib/retention-policy.ts  security.rejectedRetentionDays, which the privacy policy quotes and the
                                  Go sweep counts. A policy naming a period the sweep does not use is a
                                  promise broken silently
apps/web/lib/server-auth.ts       JWT verify in Next handlers (same JWT_SECRET as Go)
apps/web/lib/documents/           statement, receipt, loan, certificate — English only, vector PDF
apps/web/lib/reset-tokens.ts      the password_reset_tokens contract for the half Next writes: the
                                  scopes and the SHA-256. Must agree with the Go half (ADR-031)
apps/web/lib/auth-revocation.ts   the token_blacklist contract for the half Next reads AND writes.
                                  revokeAllTokens() runs inside the caller's transaction and must
                                  match revokeAllUserTokensSQL row for row; the TTL is derived from
                                  JWT_EXPIRY_SECONDS on this host too (WO-85, WO-91)
apps/web/lib/audit-actions.ts     every action either backend writes into audit_logs — category, severity,
                                  retention tier and both languages. The ONE catalogue; audit.ts derives its
                                  AuditAction from it. Read by the admin audit screen and by the retention sweep
apps/web/app/api/v1/admin/retention/  the Cloudinary half of ADR-038. POST is admins-only and takes an
                                  optional userId (the approvals screen calls it the moment an application is
                                  refused); GET is the Vercel Cron, authenticated by CRON_SECRET and reachable
                                  by NO signed-in role. An unset CRON_SECRET accepts nobody
apps/web/lib/document-numbers.ts  DEP/WDR/DSB/REP/DON/ADJ/LOAN and APP — the gapless per-year allocator, and
                                  the id of the row each one names (ADR-044). `APP-2026-000001`
                                  is the APPLICANT's number, issued at submission; ACC-KH-33001 is the MEMBER's,
                                  issued at approval and nowhere else (ADR-039). Rejecting an application must
                                  not burn a membership number
apps/web/lib/sse-stream.ts         the one wrapper every streamed response goes through. Next pipes a body
                                  AFTER the handler returns, in code no route can put a try/catch around,
                                  so an upstream that dies mid-stream is reported as `failed to pipe
                                  response` rather than as the ordinary end of an event stream that it is
apps/web/scripts/cloudinary-backup.mjs  the only copy of a member's NID scan that is not Cloudinary's.
                                  Lists, downloads, verifies each file against the byte length the API reported,
                                  and writes ONE encrypted archive beside the database dump. Read-only by
                                  construction — repairing the tree is the reconcile script, and the tool you
                                  reach for when something has gone wrong must not be able to make it worse.
                                  No SDK and no node_modules: recovery needs node and this file
apps/web/scripts/cloudinary-reconcile.mjs  the asset tree against the database. Dry run unless --confirm.
                                  Deletes only what NO stored URL mentions and only under applications/;
                                  reports anything unreferenced under people/, gallery/ or settings/ for a
                                  human. Also repairs `asset_folder`, which a rename does not move
apps/web/scripts/lib/guard.mjs  runAsScript / requireConfirmation / refuseRemoteTarget. Every script in
                                  that directory ends in runAsScript, so importing one runs NOTHING — a bare main()
                                  is why an import loop emptied the production database on 2026-09-01
apps/web/scripts/lib/account-no.mjs  the staff series, restated for `seed.mjs` and `go-live-purge.mjs`,
                                  which run under plain node with no TypeScript loader. ONE copy for both,
                                  pinned against lib/account-no.ts by test/unit/purge-script.test.ts
apps/web/lib/account-no.ts        ACC-KH-33001 — the ONE identifier a member is given (ADR-023/029).
                                  `users.accountNo`; called memberId before 2026-08-19. The Go half is
                                  apps/api/internal/utils/account_no.go and the two must agree
apps/web/prisma/schema.prisma     the data model
apps/web/prisma/migrations/*_readable_views/  the v_* views — v_people, v_transactions, v_loans,
                                  v_audit, v_pending_applications. For a human with a SQL console,
                                  never for code: each leads with the account/receipt/loan number and
                                  joins the names in, which is affordable ONLY because nothing reads
                                  them. Invisible to db:migrate:check (ADR-037)
apps/web/components/ui/logo.tsx   the lockup. `size` sets a HEIGHT, and the width follows the aspect
                                  ratio — never `h-auto w-auto`, which overrides the size prop entirely
                                  and renders every call site at the asset's intrinsic 192x108
apps/web/public/images/logo/      logo.png lockup · -mark square · -og social · -print PDF
```

## Docs — read only what the task needs

`decisions.md` and `traps.md` are **indexes over directories**. Read the index,
then open the one entry — the sets are 108 KB and 114 KB, the entries 2–5 KB.

| File | For | KB |
|---|---|---|
| [docs/changing-things.md](docs/changing-things.md) | **"I want to change ___"** — blast radius, files to touch, how to prove nothing broke. Start here for routine work | 32 |
| [docs/traps.md](docs/traps.md) | **index of 171 failures that each cost a session**, grouped by what you have to be touching. All 171 titles are on the index page, so it alone answers "is this already known?" | 14 |
| [docs/decisions.md](docs/decisions.md) | **index of 44 ADRs** — why the code contradicts an old assumption. Check before "fixing" one | 7 |
| [docs/guardrails.md](docs/guardrails.md) | the full account behind each row of the table above — the defect that put the guard there | 37 |
| [docs/workflow.md](docs/workflow.md) | **the development habits** — which database to develop against, branch → PR → merge, preview deploys, and the ordered list of what to fix first | 12 |
| [docs/product.md](docs/product.md) | domain rules, roles, loan/withdrawal/default policy, FR-01…23 | 16 |
| [docs/architecture.md](docs/architecture.md) | request flow, auth, which backend owns an endpoint, UI tokens | 12 |
| [docs/data-model.md](docs/data-model.md) | schema, invariants, `system_config` keys | 27 |
| [docs/api.md](docs/api.md) | endpoint reference | 15 |
| [docs/testing.md](docs/testing.md) | where a new test goes, the fixture contract, running each suite, what is deliberately uncovered | 17 |
| [docs/setup.md](docs/setup.md) · [deployment.md](docs/deployment.md) | env vars, hosting, **switching the monitoring on** | 23 · 46 |
| [docs/scaling.md](docs/scaling.md) | **when the free tiers actually run out** — which limit binds at which member count, measured; the options compared; the staged plan. The first wall is Neon's 0.5 GB at ~6,000 members and costs $7 to pass. Supersedes deployment.md's "Phase 6" | 21 |
| [docs/tasks.md](docs/tasks.md) | **everything left to do**, ordered, one session estimate each. Closed rows are deleted, so the numbering has gaps — that is the board working, not a missing task. `do T-12` reads that row and executes it. The only board; **delete a row in the same commit as the work** | 22 |
| [docs/go-live.md](docs/go-live.md) | **the cutover procedure, executed 2026-08-27** — freeze, clear, rotate, first real admin, launch day. Kept as the procedure to repeat for a host move, not as a status | 17 |
| [docs/runbook.md](docs/runbook.md) | **the night something breaks** — rollback, a disputed transaction, what to rotate in which host and in what order, restore from backup, where every credential lives, and the steady-state cadences | 21 |
| [docs/changelog.md](docs/changelog.md) | what is already done, one line per batch, plus the per-defect record. The only doc that keeps history. **Never read whole — `grep` it** | 131 |

Conventions (Go errors, TS strictness, quoted camelCase SQL, commit format): [CONTRIBUTING.md](CONTRIBUTING.md).

**Docs are not a scratchpad.** `changelog.md` is the only file that keeps
history; `traps.md` is the only file that keeps lessons. Everything else
describes the present, so a finished item is deleted from it rather than struck
through. A new ADR is a **file** in `docs/decisions/` plus a row in the index; a
new trap is a bullet in the matching `docs/traps/` file plus its title in the
index; a new guard is a compressed row here **and** the full account in
`docs/guardrails.md`.
