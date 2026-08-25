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
pnpm test:bundle        # first-load JS per route vs bundle-budget.json; needs a prior `pnpm build`
cd apps/api && go build ./...                  # Go check
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

Order does not matter: the Go suites truncate every table between tests, so each
suite seeds what it needs under identifiers namespaced to itself. Keep it that
way — a test depending on rows another suite left behind passes or fails on
package ordering.

**The suites and CI checks below enumerate rather than list, and will fail the
build when the code grows something they do not know about.** That is deliberate
— a list a human maintains goes stale the day it is written, which is why the
count that used to open this sentence is gone too. See
[docs/testing.md](docs/testing.md).

| Add this | And this fails until you act |
|---|---|
| a Go route | `cmd/server/routes_integration_test.go` — walks the chi router; declare who may call it |
| a Next route file | `apps/web/test/routes/routes.contract.test.ts` — walks `app/api` on disk |
| a repository method that writes a balance | `TestBalanceWritersAreEnumerated` — demands a concurrency test and an audit test. `AddLoanTopUp` writes three (loan principal, loan remaining, account `loanBalance`) and its test asserts the three still agree afterwards, which a per-column check would miss |
| an FR, or a change of FR status | `apps/web/test/unit/requirements.test.ts` — `product.md`, `tasks.md` and the code must agree, and a requirement marked `[~]` must **still** be unimplemented in the source |
| a notification builder | `internal/notify/messages_test.go` — `TestEveryBuilderIsTested` reads `messages.go`; every builder needs a table row |
| a notification message built **outside** `internal/notify` | `internal/notify/repositories_test.go` — a string literal or a float verb in a repository fails |
| a key in `messages/{en,bn}.json` | `apps/web/test/unit/messages.test.ts` — both files, no untranslated copy-paste, no dropped `{placeholder}` |
| a Next route that returns a row from `transaction`, `loan`, `account` or `documentSequence` | `apps/web/test/routes/success-paths.test.ts` — serialise it; `JSON.stringify` throws on a BigInt *after* your write has committed |
| a Prisma call in a route handler | `apps/web/test/unit/floating-promises.test.ts` — await it. On Vercel an unsettled promise is work that never happens |
| a background loop in `main()` | `apps/api/cmd/server/wiring_test.go` — reads the AST; a loop nobody starts is the original RUN-06 defect, and `startupCtx` makes it run exactly once |
| a field in `schema.prisma` | `pnpm db:migrate:check` in CI — generate the migration, or the database and the schema disagree until a column is missing in production |
| a **foreign key** in `schema.prisma` | `apps/web/test/unit/foreign-key-indexes.test.ts` — index it, with the column *leading*. An unindexed FK is a sequential scan on read **and** on every write to the parent row |
| a `settings['…']` read in a page | `apps/web/test/unit/settings-keys-read.test.ts` — declare the key in `SYSTEM_CONFIG_KEYS`, or the page's `\|\| 'fallback'` is the only value it can ever show and no admin can change it |
| `CREATE TABLE` / `ALTER TABLE` in a repository | `apps/api/internal/repositories/schema_ownership_test.go` — migrations are the only definition of this schema (WO-70); a second one disagrees eventually and `IF NOT EXISTS` makes it silent |
| a label removed from an enum in `schema.prisma` | `apps/web/test/unit/enum-literals.test.ts` — every Go SQL comparison must name labels of **one** enum. A stale label is a runtime error inside a query that no compiler sees |
| a `/support/*` route in `main.go` | `apps/web/test/unit/support-proxy-allowlist.test.ts` — the Next proxy forwards an allow-list; a route missing from it 404s in production with nothing in either log saying why |
| a generator that maps random bytes onto an alphabet | `internal/utils/random_test.go` — use `utils.RandomString`; `%` over a byte is not uniform, and both suites keep the biased version to prove the statistic can tell |
| the donation pool's owner id, in either language | `apps/web/test/unit/donation-pool-owner.test.ts` — `seed.mjs`, `db-clear-preserve-core.mjs` and `transaction_repository.go` must name the same id, or donations fail with "run `pnpm db:seed`" on a seeded database |
| a labelled identifier to a generated document | `apps/web/lib/documents/builders.test.ts` — `users.accountNo` is the **only** member identifier ([ADR-023](docs/decisions.md), [ADR-029](docs/decisions.md)); no document may give it two names, which is what "Member ID" and "Account No" on the statement were. The surviving label is **Account No** |
| a `system_config` key a **public** page reads | `apps/web/test/unit/settings-keys-read.test.ts` — the public pages render from `getPublicSettings()`, which selects `PUBLIC_CONFIG_KEYS` and nothing else. A key outside it reads `undefined` and the page shows its hardcoded fallback forever |
| a page under `app/[locale]/` that is neither dashboard nor auth | `apps/web/scripts/assert-static-routes.mjs` after `pnpm build` — marketing routes must be prerendered, dashboard and auth routes must not. It reads the build's own manifest, because no test over the source can know which a route is |
| a repository read on a hot path | `TestHotReadsDoNotSelectStar` — name the columns. `SELECT *` on `users` ships the address, both parents' names, the NID number and the photo URL to render a name and a balance |
| a header set in `proxy.ts` | `apps/web/e2e/locale-negotiation.spec.ts` — assert it over HTTP, not in a unit test. `proxy.ts` is edge middleware and Next can replace what it sets further down the response path, which is how `/` shipped a language-negotiated 307 with `cache-control: public` and no `Vary: Accept-Language` |
| a `setInterval` in the dashboard shell | `apps/web/e2e/dashboard-traffic.spec.ts` — it counts what one open tab asks for in seventy seconds, and a hidden tab must ask for nothing |
| a **public page**, or a path in `publicPagePaths` | `apps/web/test/unit/structured-data.test.ts` — it must render `<StructuredData>` and have a breadcrumb label in both languages, or it ships a page search engines read as anonymous |
| a `dangerouslySetInnerHTML` | `apps/web/test/unit/csp.test.ts` — exactly **one** is sanctioned, in `components/seo/structured-data.tsx`. [ADR-024](docs/decisions.md) lets the marketing pages keep `'unsafe-inline'` on the grounds that they have no XSS sink; a second one makes that argument false |
| an invariant to `repositories.AllChecks` | `apps/api/internal/repositories/reconcile_integration_test.go` — plant a drift for it. A check nobody has seen fail may not work |
| a write reachable from the reconciliation job | `apps/api/cmd/server/wiring_test.go` — it reads the source and fails on any `UPDATE accounts` there. The job reports drift; it must never correct it ([ADR-027](docs/decisions.md)) |
| an import to a shared component | `apps/web/scripts/assert-bundle-budget.mjs` after `pnpm build` — first-load JS per route against `bundle-budget.json`, >10% growth fails. Accept a real cost with `pnpm test:bundle:update` |
| a `system_config` key | `apps/web/test/unit/settings-keys-read.test.ts` — put it in **exactly one** of `CONTENT_CONFIG_KEYS` (Content & Media) or `SETTINGS_CONFIG_KEYS` (Settings). In neither, no admin can change it; in both, whichever form saves last reverts the other |
| a form that posts a money `amount` | `apps/web/lib/utils.test.ts` — it walks `app/`, `components/` and `lib/` for anything posting one and demands `parseWholeTaka`. And ask first whether `components/dashboard/money-actions.tsx` should own it: staff deposits, withdrawals, instalments and loan applications each existed twice and the copies disagreed about paisa and about FR-08 |
| a lookup by **email, phone or NID** | `apps/web/test/unit/rejected-application.test.ts` — exclude rejected applications. Uniqueness is scoped to *live* rows so a rejected applicant can apply again with the same details (owner's ruling, 2026-08-26), which means **two rows may share an email**. A lookup that forgets it authenticates against a row whose password hash nothing can match, or tells a genuine applicant their own address is taken |
| a **second spelling of "rejected application"** | the same test — derive it from `RejectedApplicationSQL` / `lib/rejected-application.ts`. The retention sweep selected on `phone LIKE 'rejected-%'`, the tombstone rejection used to write; removing that scramble would have left the sweep matching **nothing, for ever**, running on schedule and reporting zero cleared — which is what a correct sweep reports on a quiet week |
| a **rejection reason** | `apps/web/test/unit/rejection-reasons.test.ts` — the code list exists in the picker, the Go handler's allow-list and the email's sentence table. A code the picker offers that the handler refuses is a 400 on a button that looks like it works; one the handler accepts with no sentence is a rejection email that gives no reason, which is the state this replaced |
| a **default value on the admin Settings screen** | `apps/web/test/unit/org-defaults.test.ts` — it must equal the seeded default in `scripts/seed.mjs`. That screen POSTS every field on save, so its "fallback" is a **writer**: the two disagreed about the foundation's own name, and any admin pressing Save renamed the organisation in the JSON-LD, on every document's letterhead and in the browser tab |
| a page title, or the site's own name | `apps/web/test/unit/seo.test.ts` — call `siteTitle(locale)`. The `<title>` existed three times and had already drifted: the layout said "Hasnahena Foundation" while the home page said "Hasnahena", and the home page's `generateMetadata` overrides the layout's, so the most-crawled title on the site was the one missing the word people search for |
| **member-facing copy about a loan** | `apps/web/test/unit/messages.test.ts` — it reads the prose for a promise of a charge. The Terms of Service told every member, in both languages, that loans "are interest-free but may include administrative fees"; `applicationFee = 0`, the CHECK constraint and the "markup" source search all passed, because none of them reads a string in a page |
| a loan list, or a `nextDueDate` | `apps/api/internal/repositories/loan_schedule_integration_test.go` — `/admin/loans` and `/worker/loans` are one React component and must return the **same rows** and agree on `isOverdue`, `missedInstallments` and the date. Three queries once answered the date three ways, and the two lists carried different statuses |
| a rate-limited action | `apps/api/internal/services/rate_limit_policy_test.go` — declare it as a `RateLimitAction` constant and give it a policy. A bare string at the call site fails the census, because an unnamed action silently gets the default five-attempts-flat-30-seconds whatever the endpoint needs |
| a row in `password_reset_tokens`, in **either** language | `apps/web/test/unit/reset-token-scopes.test.ts` — `scope` plus `sha256(secret)`, never the secret. The Next half is `apps/web/lib/reset-tokens.ts`; the test reads the Go source, so a scope renamed on one side fails on the other |
| a branch in `forgot-password` that depends on what the lookup found | `apps/api/cmd/server/auth_security_integration_test.go` — a member, a suspended member, a member with no email and a stranger must get a byte-identical answer ([ADR-032](docs/decisions.md)). The three answers this replaced were a membership oracle on an unauthenticated endpoint |
| a **branch that deactivates or deletes a staff or member account** | `apps/web/test/unit/revocation-contract.test.ts` — write the revoke-all marker **inside that transaction**. `status` is read at login and nowhere else, on purpose, so the marker is the *only* thing that takes a dismissed worker's staff token away; the census counts revocations against endings and fails when a fourth ending appears without one |
| a second writer of `token_blacklist`, in **either** language | the same test — it reads `auth_repository.go` and `lib/auth-revocation.ts` and demands the same key, the same upsert and the same derived TTL. A marker written differently on one backend is a token revoked on one surface and live on the other, which is worse than neither checking |
| **anything that erases or expires personal data** | `apps/web/test/routes/identity-integrity.test.ts` and `apps/api/internal/repositories/retention_integration_test.go` — and the audit row must name the **account number and nothing it erased**. `audit_logs` cannot be deleted from ([ADR-033](docs/decisions.md)), so an `oldValue` the way `WORKER_UPDATED` writes one is erasure that preserves what it erased |
| an internal **URL** anywhere in `app/`, `components/` or `lib/` | `apps/web/test/unit/locale-routing.test.ts` — build it with `localePath(locale, path)`. English has no prefix ([ADR-034](docs/decisions.md)), so a hand-written `` `/${locale}/faq` `` produces `/en/faq`, which 301s: a redirect on every internal navigation, and a crawler told the href is not the real URL |
| a **language switch** | the same test — `switchLocalePath(pathname, otherLocale(locale))`, never a `replace` on the pathname. There is no correct spelling with `replace`, because under `as-needed` English has no segment to replace: `localePath('en')` is `/`, so the admin shell's `pathname.replace(localePath(locale), …)` rewrote the **first slash** of `/dashboard/admin` and sent staff to `/bndashboard/admin`, a 404 on the language button of every staff screen |
| **copy written into a component on a public page** | `apps/web/e2e/locale-content.spec.ts` — it reads the rendered page and fails on Bengali an English reader can see. The parity census cannot: a string that was never in a message file has nothing to be compared against, which is how four hardcoded Bengali figures (`১২৫+`, `৳১.৮ লক্ষ+`) sat on the English home page under English captions. Values an admin typed are stripped first, so it never goes red on database content |
| a `system_config` value that is **prose** | give it an `…En` twin and read it through a helper — `org.address`/`org.addressEn`, like `org.name`/`org.nameEn` and `org.description`/`org.descriptionEn`. One box is shown to both audiences, so the foundation's Bengali address rendered under an English "Address" heading on every public page *and* on the English-only letterhead of every generated document ([ADR-012](docs/decisions.md)). `apps/web/test/unit/org-address.test.ts` pins the pairs. **Enumerate the prose keys rather than fixing the reported one** — these three were always the same bug three times, and `org.description` survived the address fix by four months because its only reader is the JSON-LD, which no rendered-page test reads |
| **copy to a page under `app/[locale]/(auth)/`** | `apps/web/test/unit/messages.test.ts` — put it in `messages/{en,bn}.json`. A `locale === 'bn' ? … : …` in a component is invisible to the parity census, the placeholder check *and* the fee-promise search, which is how the Terms of Service promised administrative fees in both languages with every guard green |
| a screen to one staff dashboard | there is no such thing — `components/dashboard/screens/` holds one component per screen and both `app/[locale]/dashboard/{worker,admin}/` re-export it. Add it to `components/dashboard/nav.ts` with the roles that may see it |

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
                                  staff route file is a one-line re-export — edit the screen, not it
apps/web/components/dashboard/    screens/  the worker and admin dashboards, ONE component each. Both
                                  role folders re-export the same file; the screen asks
                                  useDashboardRole() and hides what that role may not do
                                  nav.ts    the single description of what each dashboard contains —
                                  the sidebar and the overview's action cards both render from it
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
apps/web/lib/org-address.ts       the organisation's PROSE settings in the reader's language — the address and
                                  the description. Its own module, not part of
                                  system-config.ts, because the footer is a client component and that file
                                  imports Prisma. org.address is Bengali, org.addressEn is English, exactly
                                  like org.name/org.nameEn — one row shown to both audiences put the
                                  Bengali address under an English heading on every public page
apps/web/lib/server-auth.ts       JWT verify in Next handlers (same JWT_SECRET as Go)
apps/web/lib/documents/           statement, receipt, loan, certificate — English only, vector PDF
apps/web/lib/reset-tokens.ts      the password_reset_tokens contract for the half Next writes: the
                                  scopes and the SHA-256. Must agree with the Go half (ADR-031)
apps/web/lib/auth-revocation.ts   the token_blacklist contract for the half Next reads AND writes.
                                  revokeAllTokens() runs inside the caller's transaction and must
                                  match revokeAllUserTokensSQL row for row; the TTL is derived from
                                  JWT_EXPIRY_SECONDS on this host too (WO-85, WO-91)
apps/web/lib/account-no.ts        ACC-KH-33001 — the ONE identifier a member is given (ADR-023/029).
                                  `users.accountNo`; called memberId before 2026-08-19. The Go half is
                                  apps/api/internal/utils/account_no.go and the two must agree
apps/web/prisma/schema.prisma     the data model
apps/web/public/images/logo/      logo.png lockup · -mark square · -og social · -print PDF
```

## Docs — read only what the task needs

| File | For |
|---|---|
| [docs/changing-things.md](docs/changing-things.md) | **"I want to change ___"** — blast radius, files to touch, how to prove nothing broke. Start here for routine work |
| [docs/traps.md](docs/traps.md) | **every failure that cost a session**, grouped by what you have to be touching to hit one. Read the matching heading before debugging |
| [docs/product.md](docs/product.md) | domain rules, roles, loan/withdrawal/default policy, FR-01…23 |
| [docs/architecture.md](docs/architecture.md) | request flow, auth, which backend owns an endpoint, UI tokens |
| [docs/data-model.md](docs/data-model.md) | schema, invariants, `system_config` keys |
| [docs/api.md](docs/api.md) | endpoint reference |
| [docs/testing.md](docs/testing.md) | where a new test goes, the fixture contract, running each suite, what is deliberately uncovered |
| [docs/setup.md](docs/setup.md) · [deployment.md](docs/deployment.md) | env vars, hosting, **switching the monitoring on**, the host-move plan |
| [docs/decisions.md](docs/decisions.md) | why the code contradicts an old assumption — check before "fixing" one. **Indexed**: read the one row you need |
| [docs/tasks.md](docs/tasks.md) | **everything left to do**, ordered, one session estimate each. Closed rows are deleted, so the numbering has gaps — that is the board working, not a missing task. `do T-09` reads that row and executes it. The only board; **delete a row in the same commit as the work** |
| [docs/go-live.md](docs/go-live.md) | **the cutover procedure** — freeze, clear the fake data, rotate every secret, create the real first admin, launch day |
| [docs/runbook.md](docs/runbook.md) | **the night something breaks** — rollback, a disputed transaction, what to rotate in which host and in what order, restore from backup, where every credential lives, and the steady-state cadences |
| [docs/changelog.md](docs/changelog.md) | what is already done, one line per batch, plus the per-defect record. The only doc that keeps history |

Conventions (Go errors, TS strictness, quoted camelCase SQL, commit format): [CONTRIBUTING.md](CONTRIBUTING.md).

**Docs are not a scratchpad.** `changelog.md` is the only file that keeps
history; `traps.md` is the only file that keeps lessons. Everything else
describes the present, so a finished item is deleted from it rather than struck
through.
