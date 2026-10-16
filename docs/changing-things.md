# Changing Things Safely

A playbook keyed by **"I want to change ___"**: which files to touch, what breaks if you touch the wrong one, and how to prove you did not.

## The blast-radius map

| Layer | Change here and it affects | Safe to change freely? |
|---|---|---|
| `app/[locale]/**/page.tsx` | that page — **and whether it still prerenders** | Mostly. `pnpm build && node scripts/assert-static-routes.mjs` |
| `components/ui/*` | every page using the primitive | Check callers first |
| `app/globals.css` tokens | the whole site, both themes | Deliberate only |
| `messages/{en,bn}.json` | copy everywhere | Yes, **both files** |
| `lib/documents/*` | paperwork members keep | Deliberate only |
| `prisma/schema.prisma` | both backends; needs a migration | Deliberate only |
| `internal/repositories/*_repository.go` | **money** | Read [ADR-015](decisions.md) first |
| `lib/csp.ts`, `proxy.ts` | whether any page's scripts run | Deliberate only — [ADR-024](decisions.md) |
| `lib/seo.ts`, `lib/structured-data.ts` | every canonical, `hreflang`, social card and JSON-LD | `pnpm test:unit` |
| anything a shared component imports | first-load JS on every route rendering it | `pnpm build && pnpm test:bundle` |

**Presentation is cheap to change, persistence is not.**

---

## "I want to redesign the homepage"

Contained: one file, [`app/[locale]/page.tsx`](../apps/web/app/[locale]/page.tsx), imported by nothing. It reads `getPublicSettings()` and `getPublicGalleryItems()` (cached, render without a DB), `messages/{en,bn}.json`, and `components/{layout,ui}`.

1. **Copy lives in `messages/{en,bn}.json`**, both files (`messages.test.ts` fails on unequal keys, untranslated copy-paste, dropped `{placeholder}`).
2. **`hero.*` comes from Content & Media and `org.*` from Settings.** Dropping a key from the design means removing it from `lib/system-config.ts` too — `SYSTEM_CONFIG_KEYS` and its `CONTENT_`/`SETTINGS_` list — or `settings-keys-read.test.ts` flags a dead control.
3. **A prose setting is a PAIR**: `localizedSetting(settings, key, locale)`, never `settings['hero.tagline']` (`LOCALIZED_SETTING_PAIRS` in `lib/localized-settings.ts`; the census reads line by line).
4. **An unset value renders NOTHING**, never a plausible placeholder (`contactDetails()`, `.filter(v => v !== '')`).
5. **Semantic colour classes only** (`bg-primary`, `text-muted-foreground`) — tokens live in `app/globals.css` for light and `.dark`.
6. **Keep `AuthAwareCTA`**: its signed-out form renders on the server so the prerendered page always has "Become a Member".

Prove it: `pnpm typecheck && pnpm lint`, `pnpm --filter @hasnahena/web build`, then read `/` and `/bn` in light and dark.

Site-wide look: HSL values under `:root`/`.dark` in `app/globals.css` (primary emerald `hsl(160 84% 39%)` / `45%` dark, radius `0.625rem`); status badge colours only in [`lib/status-styles.ts`](../apps/web/lib/status-styles.ts).

---

## "I want to change the public site"

- **The menu points at pages**, never home-page anchors: one `navigation` array in [`components/layout/header.tsx`](../apps/web/components/layout/header.tsx). Home-page sections end in a `SectionLink` to their page.
- **Adding a public page** needs all of: the route, `publicPagePaths` in [`lib/seo.ts`](../apps/web/lib/seo.ts), a breadcrumb label in both languages (`PUBLIC_PAGE_LABELS`), a `<StructuredData>` render, `MUST_BE_STATIC` in [`scripts/assert-static-routes.mjs`](../apps/web/scripts/assert-static-routes.mjs), `PAGES.public` in `e2e/fixtures/session.ts`, and — so a human can find it — the `navigation` array.
- **Every page uses `<Header>` and `<Footer>`**; `/privacy` and `/terms` are shells around [`legal-document.tsx`](../apps/web/components/layout/legal-document.tsx) with wording in `legal.*` (inside the fee-promise census).
- **The logo is sized by HEIGHT** ([`logo.tsx`](../apps/web/components/ui/logo.tsx)); never `h-auto w-auto`. The header is `h-24` at the top and `h-16` scrolled; `matrix.spec.ts` asserts `36 ≤ logo ≤ header`.
- **The hero must not depend on a setting**: its four figures are stated `system_config` values counting up via [`count-up.tsx`](../apps/web/components/ui/count-up.tsx), falling back to [`geometric-panel.tsx`](../apps/web/components/ui/geometric-panel.tsx) when all are blank. **Never replace a stated figure with a counted one** — the fund's real numbers are not published ([traps.md](traps.md) § Interface).
- **The hero container needs `w-full`** (a flex item shrinks to its text; `matrix.spec.ts` measures alignment in both languages).
- **Landing copy is seeded**, both halves of every pair, in [`scripts/seed.mjs`](../apps/web/scripts/seed.mjs).

```bash
pnpm test:unit                                          # key, pair and copy censuses
pnpm exec playwright test e2e/matrix.spec.ts            # 412 px + 1280 px, both languages
pnpm exec playwright test e2e/public-content.spec.ts    # an admin edit reaches the visitor
pnpm build && node scripts/assert-static-routes.mjs
```

---

## "I want to add or change a page"

Add a folder under `app/[locale]/`; `sitemap.ts` and `robots.ts` generate from the tree.

- **Public pages** read settings via `getPublicSettings()` and gallery via `getPublicGalleryItems()`, export `revalidate`, and join `MUST_BE_STATIC`. A bare Prisma call in the page or anything it renders makes it dynamic again, and it must render with **no database** (the Docker build has none, [ADR-028](decisions.md)). Also: `publicPagePaths`, a breadcrumb label, `<StructuredData … />`.
- **Dashboard pages** go under `dashboard/{member,worker,admin}/`, role-gated by `proxy.ts` and each role's layout.
- **A staff screen is written once** in `components/dashboard/screens/`, re-exported by both role folders, listed in [`nav.ts`](../apps/web/components/dashboard/nav.ts) with its roles; `useDashboardRole()` hides what a worker may not do — and the endpoints it calls must be mounted for `staff` in [`main.go`](../apps/api/cmd/server/main.go), or a worker gets a 403 and a blank page.

---

## "I want to change a money rule"

Read [product.md](product.md) and [ADR-015](decisions.md) first.

- **A policy number** (minimum deposit, multiplier, instalment cap) is already an admin setting — no code. A **new** policy key: make something read it, seed it, then declare it (see *admin setting* below).
- **How a balance moves** belongs in `apps/api/internal/repositories/`, one transaction, an `audit_logs` row, written **relatively** (`SET "savingsBalance" = "savingsBalance" + $1`). `ledger_integrity_integration_test.go` fails if read-then-write returns.
- **Never** a rate, markup or fee (rule 3) — a requirement that seems to need one is wrong; raise it.
- New arithmetic goes in `internal/money/` (tested without a DB). Prove it: `pnpm test:go`, then the integration suite.

---

## "I want to change the registration form"

[`app/[locale]/(auth)/register/page.tsx`](../apps/web/app/[locale]/(auth)/register/page.tsx): an eight-step form, the only way in, usually filled on a mid-range Android.

**Adding a field is four edits** (the compiler enforces the last): the shape in [`lib/validation/registration.ts`](../apps/web/lib/validation/registration.ts); a label in `fieldLabels` in both languages; the input with `id` equal to the field name (the summary scrolls by id); the name in `STEP_FIELDS`.

1. **Every blocked submit goes through `revealErrorSummary()`** — an off-screen error is no error.
2. **No `overflow-hidden` on ancestors of the sticky nav bar.**
3. **Photos are downscaled in the browser** (`downscaleImageFile`, keep `imageOrientation: 'from-image'`) — four camera shots exceed the 4.5 MB body cap.
4. **The availability check is advisory**; the POST re-checks (409). Never let a failed pre-check block submission.
5. Older copy is inline `locale === 'bn' ? …` ternaries; new copy goes in `messages/` (WO-96), and migrate the `(auth)` folder in one commit, not half.

Prove it: [`e2e/registration.spec.ts`](../apps/web/e2e/registration.spec.ts) (Pixel 7, asserts what is *visible*). Read the node-reuse and `shouldFocusError` entries in [traps.md](traps.md) before touching step navigation.

---

## "I want to change what happens after somebody applies"

| Change | Where | If wrong |
|---|---|---|
| Rejection reasons | [`lib/rejection-reasons.ts`](../apps/web/lib/rejection-reasons.ts) + the allow-list in `dashboard_handler.go` + `rejectionReasonSentence` in `email_service.go` | `rejection-reasons.test.ts` fails; otherwise a dead button or a reasonless email |
| Who owns an email/phone/NID | [`lib/rejected-application.ts`](../apps/web/lib/rejected-application.ts), `RejectedApplicationSQL`, the migration's index predicates | `rejected-application.test.ts` fails |
| The age floor | the setting `membership.minimumAgeYears`, judged only by [`lib/membership-eligibility.ts`](../apps/web/lib/membership-eligibility.ts) | form and API disagree |
| What the applicant is told | approval/rejection builders in `email_service.go`; the register page's confirmation screen | nothing else tells them — an applicant has no account |
| The numbers | `APP-…` at submission (`lib/document-numbers.ts`); `ACC-KH-…` at **approval only** ([ADR-039](decisions.md)); `formNumber` survives approval (it names their document folder) | refusals punch holes in the register |
| What is deleted on refusal | `lib/application-documents.ts` via `POST /api/v1/admin/retention` (approvals screen + nightly sweep), **by folder prefix** | ID photos stay public |

Also: lookups by contact detail exclude rejected applications; never destroy contact details to free a constraint; the email language is the applicant's `preferredLocale`; email failure is reported, never fatal. **Approval returns the account number but never a password** — members without email get one from the staff-assisted reset on their own page ([ADR-036](decisions.md), [ADR-042](decisions.md)).

Prove it: [`e2e/entry-path.spec.ts`](../apps/web/e2e/entry-path.spec.ts) walks the journey at 412 px in both languages (`scripts/test-stack.sh up --serve && eval "$(scripts/test-stack.sh env)"`, then `cd apps/web && npx playwright test e2e/entry-path.spec.ts`).

---

## "I want to add or change an admin setting"

**In this order:** (1) make something read it — a key nothing reads is a note; (2) seed a default in [`scripts/seed.mjs`](../apps/web/scripts/seed.mjs); (3) declare it in [`lib/system-config.ts`](../apps/web/lib/system-config.ts): `SYSTEM_CONFIG_KEYS`, plus `PUBLIC_CONFIG_KEYS` if a public page reads it or `MEMBER_CONFIG_KEYS` if a member's screen does, plus **exactly one** of `CONTENT_CONFIG_KEYS` (Content & Media) or `SETTINGS_CONFIG_KEYS` (identity, policy, money, retention).

- That partition is also the **write** boundary: `PUT /api/v1/settings` takes a worker only for content keys — a money key on Content & Media hands it to every field worker.
- The endpoint rejects the **whole request** on one unknown key, so a form posting an undeclared key breaks every setting on the page (WO-46).
- Zero is usually real (`loan.minDepositForLoan = 0` = no minimum, `loan.guarantorThresholdAmount = 0` = always a guarantor) — parse non-negative, and keep both backends agreeing.
- A public page reading a non-public key renders its fallback forever; a browser call not via `lib/settings-client.ts` silently gets the public subset (WO-77).
- Read by something is the bar, not enforced by something: `loan.noticePeriodDays` gates nothing but two screens show it (ADR-030). A control nothing reads belongs in `UNIMPLEMENTED_CONFIG_KEYS`.

---

## "I want to add a way for staff to move money"

Add a `MoneyAction` to `components/dashboard/money-actions.tsx` — the one implementation of deposit, withdrawal, instalment, loan application and top-up — never a second form (copies drifted on paisa and on refusals). `lib/utils.test.ts` requires `parseWholeTaka` for any posted `amount:`; the balance change itself is the Go API's (rule 2).

## "I want to add an endpoint"

**Does it change a balance?** Yes → Go: route in `main.go`, handler in `dashboard_handler.go`, SQL in the matching repository; admin-only routes go inside the `/admin` group (gated by mounting). No → a Next route handler is fine. Document it in [api.md](api.md) in the same commit. Both surfaces are enumerated, so the build fails until you declare who may call it; a `/support/*` route also needs the Next proxy allow-list.

---

## "I want to move off Vercel and Render onto a VPS"

An infrastructure job, not a code job: Dockerfiles, `docker-compose.yml` and GHCR images exist.

| | Go API | Next web |
|---|---|---|
| Required | `DATABASE_URL`, `JWT_SECRET` (32+ chars) | `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_API_URL` |
| Also | `CORS_ORIGINS`, `ENABLE_HSTS=true`, `TRUSTED_PROXIES`, `METRICS_TOKEN`, `SENTRY_DSN` | Cloudinary keys, `CRON_SECRET` |
| Listens | `API_PORT`/`PORT`, default 8081 | 3000 |
| Health | `GET /v1/health` (liveness), `GET /v1/ready` (DB) | — |

Replace three Render/Vercel-shaped things: **TLS** (Caddy or nginx + certbot; `ENABLE_HSTS` only once HTTPS is permanent); **`TRUSTED_PROXIES`** — count the actual chain, then verify from a real log line (`ip` = the caller), and do not raise it for the support path ([ADR-019](decisions.md), [ADR-021](decisions.md)); **stop grace > `SERVER_SHUTDOWN_TIMEOUT`** (systemd `TimeoutStopSec`, compose `stop_grace_period`). Keep the pool's `timezone=UTC` pin in `main.go` (without it, tokens issued after a password change are born revoked) and the simple-protocol pgx mode. Staged plan: INF-01 → INF-12 in [deployment.md](deployment.md#getting-off-the-free-tiers) (T-30); data cutover: [runbook.md §7](runbook.md).

---

## "I want to change the database schema"

`schema.prisma` is the truth, but the Go API reads the same tables with raw SQL — **grep `apps/api` for a column before renaming it** (`sql_schema_census_test.go` catches it only with a database). `pnpm db:migrate:dev`, then `pnpm db:migrate` in **every** environment; never `db:push` at anything you cannot rebuild ([ADR-014](decisions.md)). Hand-written `INSERT`s set `"createdAt"`/`"updatedAt"` themselves (`@updatedAt` has no DB default), and camelCase columns are quoted (`a."savingsBalance"`) — [data-model.md](data-model.md). The `audit_logs` trigger and CHECK constraints are invisible to Prisma; a `--from-empty` baseline drops them.

## "I want to change a generated document"

`lib/documents/`, **English only** ([ADR-012](decisions.md)). One builder → a renderer-independent model → two renderers (`render/html.ts` print, `render/pdf.ts` download). A new document is a builder plus an export; a new kind of content is a `Block` variant handled in **both** renderers. Amounts print `BDT 1,25,000`; numbers come from `document_sequences` ([ADR-013](decisions.md)).

---

## Before you commit, whatever you changed

```bash
pnpm typecheck        # zero errors (rm -rf apps/web/.next if it reports a missing app/api/**/route.js)
pnpm lint
pnpm test:unit
pnpm test:go
```

- Never commit `apps/web/next-env.d.ts` (generated, untracked).
- Money or SQL → the integration suite on the test stack ([testing.md](testing.md)), which includes the ledger reconciliation.
- Anything a page imports → `pnpm build`, `node apps/web/scripts/assert-static-routes.mjs`, `pnpm test:bundle`.
- Schema → say so in the handover: `pnpm db:migrate` must run in every environment.
