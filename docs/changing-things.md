# Changing Things Safely

A playbook keyed by **"I want to change ___"**. Each entry says which files to
touch, what will break if you touch the wrong one, and how to prove you did not
break it.

The organising idea: this codebase has a small number of places where a change
is *contained*, and a small number where a change *leaks*. Knowing which is
which is most of what makes a change safe.

## The blast-radius map

| Layer | Change here and it affects | Safe to change freely? |
|---|---|---|
| `app/[locale]/**/page.tsx` | that one page — **plus whether it can still be prerendered** | Mostly. `pnpm build && node scripts/assert-static-routes.mjs` |
| `components/ui/*` | every page using that primitive | Check callers first |
| `app/globals.css` tokens | the whole site, both themes | Deliberate only |
| `messages/{en,bn}.json` | copy everywhere | Yes, **but both files** |
| `lib/documents/*` | printed paperwork members keep | Deliberate only |
| `prisma/schema.prisma` | both backends, needs a migration | Deliberate only |
| `internal/repositories/*_repository.go` | **money** | Read [ADR-015](decisions.md) first |
| `lib/csp.ts`, `proxy.ts` | whether every page's scripts run at all | Deliberate only — [ADR-024](decisions.md) |
| `lib/seo.ts`, `lib/structured-data.ts` | every canonical URL, `hreflang`, social card and the JSON-LD on all ten public pages | Check `pnpm test:unit` — the guards are specific |
| anything imported by a shared component | **first-load JavaScript on every route that renders it** | `pnpm build && pnpm test:bundle` |

Rule of thumb: **presentation is cheap to change, persistence is not.** Anything
under `app/[locale]/` that is not a `route.ts` can be rewritten freely.

---

## "I want to redesign the homepage"

**This is a contained change.** The homepage is one file —
[`app/[locale]/page.tsx`](../apps/web/app/[locale]/page.tsx), ~580 lines, eight
`<section>` blocks. Nothing else imports it. Rewriting it entirely cannot break
the dashboards, the API, or anyone's balance.

**What it reads, and therefore what you must keep supplying:**

```
page.tsx
├── prisma.galleryItem.findMany()   → the gallery strip
├── prisma.systemConfig.findMany()  → org.* and hero.* values
├── messages/{en,bn}.json           → every string
└── components/{layout,ui}          → Header, Footer, Button, Card, Gallery, AuthAwareCTA
```

**The four things that will bite you:**

1. **Copy lives in `messages/{en,bn}.json`, never in the component.** A hardcoded
   English string is invisible until a Bengali member reads it. Add the key to
   *both* files — `test/unit/messages.test.ts` fails on an unequal key set, on a
   long untranslated copy-paste, and on a dropped `{placeholder}`.
2. **`hero.*` and `org.*` come from the admin settings page,** not from code. If
   your new design drops `hero.backgroundImage`, remove the key from
   [`lib/system-config.ts`](../apps/web/lib/system-config.ts) too, or you leave a
   setting an admin can still edit that does nothing.
3. **Use semantic colour classes** — `bg-primary`, `text-muted-foreground`,
   `border-border` — not hex, and not raw `emerald-600`. The tokens are defined
   once in `app/globals.css` for light and `.dark`. A hardcoded colour is the one
   change that looks fine to you and broken to a member on dark mode.
4. **`AuthAwareCTA` changes based on login state.** If you replace the hero
   button, keep it, or a signed-in member gets shown "Register".

**Prove it:**
```bash
pnpm typecheck && pnpm lint
pnpm --filter @hasnahena/web build       # catches server/client boundary errors
pnpm dev                                 # then read /en AND /bn, light AND dark
```
Both locales and both themes, every time. That is the whole checklist.

**Changing the look everywhere instead of on one page:** edit the HSL values in
`app/globals.css` under `:root` and `.dark`. Brand primary is emerald
`hsl(160 84% 39%)` / `45%` dark, radius `0.625rem`. Status badge colours are
centralised in [`lib/status-styles.ts`](../apps/web/lib/status-styles.ts) —
extend that, never inline a badge colour.

---

## "I want to add or change a page"

Add a folder under `app/[locale]/`. It is picked up automatically; `sitemap.ts`
and `robots.ts` generate from the route tree.

- Public pages go beside `about/`, `faq/`, `contact/`. **Read settings through
  `getPublicSettings()` and gallery items through `getPublicGalleryItems()`**
  (both in `lib/`), give the page an `export const revalidate`, and add it to
  `MUST_BE_STATIC` in `scripts/assert-static-routes.mjs`. A bare
  `prisma.something.findMany()` in a page — or in anything it renders — makes the
  route dynamic again, which means a database connection on every visit; that was
  the state of all fifty routes before WO-73. It also has to render **without a
  database at all**, because prerendering happens during the Docker image build,
  which has none ([ADR-028](decisions.md)) — the two accessors above already
  handle that; a new one must too.
- A new public page also needs three things or a test will say so: an entry in
  `publicPagePaths` (`lib/seo.ts`), a breadcrumb label in both languages
  (`PUBLIC_PAGE_LABELS` in `lib/structured-data.ts`), and
  `<StructuredData locale={…} path="/its-path" settings={settings} />` in its
  JSX. Without them it is a page search engines read as belonging to nobody.
- Dashboard pages go under `dashboard/{member,worker,admin}/`. These are
  **already role-gated** by `proxy.ts` (redirects on missing/expired token) and
  by the layout in each role folder. The gate is where the file lives.
- Every locale string in `messages/{en,bn}.json`.

---

## "I want to change a money rule"

Stop and read [`docs/product.md`](product.md) first, then
[ADR-015](decisions.md).

**If it is a *policy number*** — minimum deposit, loan multiplier, installment
cap — it is already configurable. Change it in the admin settings page. No code.
Adding a *new* policy key is three steps, in this order: make something read it,
seed a default in `scripts/seed.mjs`, then declare it in `lib/system-config.ts`.
The allow-list entry is last, because a key nothing reads is a note.

**If it changes how a balance moves**, it belongs in
`apps/api/internal/repositories/`, in one transaction, with an `audit_logs` row,
and the balance must be written *relatively*:

```sql
SET "savingsBalance" = "savingsBalance" + $1   -- correct
```

Never read the balance and write back a total. See [ADR-015](decisions.md) — that
bug was live in `transaction_repository.go` until 2026-08-17 and it destroyed
money: twenty concurrent deposits left one deposit's worth. Concurrency tests in
`ledger_integrity_integration_test.go` now fail if it comes back.

**Never** add a rate, markup, or fee. Zero interest is a Shariah constraint, not
a configurable default. If a requirement seems to need one, that requirement is
wrong; raise it.

**Prove it:** `pnpm test:go`, then the integration suite against a real database
(command in [CLAUDE.md](../CLAUDE.md)). Pure arithmetic belongs in
`internal/money/`, which is tested without a database — put new maths there, not
inline in SQL.

---

## "I want to change the registration form"

[`app/[locale]/(auth)/register/page.tsx`](../apps/web/app/[locale]/(auth)/register/page.tsx)
is one file, four steps, and the only way a member ever joins. It is also the
page most likely to be filled in on a mid-range Android over a patchy
connection, which is what most of its non-obvious code is for.

**Adding a field is four edits, and the compiler enforces the fourth:**

1. The shape in [`lib/validation/registration.ts`](../apps/web/lib/validation/registration.ts).
2. A label in `fieldLabels` — **both languages**. Without it the error summary
   tells a member to fix `permanentPoliceStation`.
3. The input, with an `id` equal to the field name. The error summary scrolls by
   `getElementById`, so a mismatched id silently stops working.
4. The field name in `STEP_FIELDS`. Miss it and `tsc` fails naming the field —
   this assertion exists because `childrenCount` was missing, so a cross-field
   rule could block submission from a step the form would never navigate to.

**Five things that will bite you:**

1. **An error nobody can see is the same as no error.** Every blocked submit
   goes through `revealErrorSummary()`, which scrolls the summary into view and
   focuses it. The submit button is at the bottom of a long form and the summary
   is at the top; without the scroll, pressing submit looks like nothing
   happening. That was the bug.
2. **`overflow-hidden` on an ancestor kills `position: sticky`,** and the
   navigation bar is sticky so Next stays reachable one-handed. The `Card`
   deliberately does not set it.
3. **Photos are downscaled in the browser** (`downscaleImageFile`) before
   upload. Four phone-camera shots are 12–32 MB and the serverless request-body
   cap is 4.5 MB, so without it an honest submission cannot be sent at all. Keep
   `imageOrientation: 'from-image'` — EXIF rotation is not in the pixels, and a
   canvas discards it.
4. **The availability check is advisory.** The POST re-checks and answers 409.
   Never let a failed pre-check block submission; a rate limit once stranded
   people who had done nothing wrong.
5. **The whole page uses `locale === 'bn' ? … : …` rather than `messages/`.**
   This matches the login page beside it. It is the one place the copy rule
   (rule 5 in [CLAUDE.md](../CLAUDE.md)) is not followed; if you migrate it, do
   the whole `(auth)` folder in one commit rather than half of it.

**Prove it:** the specs in
[`e2e/registration.spec.ts`](../apps/web/e2e/registration.spec.ts) run on a
Pixel 7 viewport and assert what is *visible*, not what is in the DOM. Three of
them exist because of one reported bug — read the React node-reuse and
`shouldFocusError` entries in [traps.md](traps.md) before touching the step
navigation or the error summary.

```bash
pnpm dev
cd apps/web && npx playwright test e2e/registration.spec.ts
```

---

## "I want to add or change an admin setting"

Three steps, **in this order**:

1. **Make something read it.** A key nothing reads is a note, not a setting.
2. Seed a default in [`scripts/seed.mjs`](../apps/web/scripts/seed.mjs).
3. Declare it in [`lib/system-config.ts`](../apps/web/lib/system-config.ts) —
   in `SYSTEM_CONFIG_KEYS`, **and in `PUBLIC_CONFIG_KEYS` if a public page reads
   it, or `MEMBER_CONFIG_KEYS` if a signed-in member's own screen does**. Then
   give it a control.

The allow-list entry is last for a reason, and the ordering is not pedantry:
`PUT /api/v1/settings` rejects the **entire request** on one unrecognised key,
so a control posting a key the list does not know breaks *every other setting on
the page at the same time*. That happened — see WO-46. Whenever you touch either
side, diff what the form posts against `SYSTEM_CONFIG_KEYS`; reviewing the two
halves separately is how they drifted.

Zero is usually a real value, not a missing one. `loan.minDepositForLoan = 0`
means "no minimum" and `loan.guarantorThresholdAmount = 0` means "always require
a guarantor" — parse those with a non-negative check, and make sure **both
backends agree**, since the Go API reads the same rows through its own helpers.

**Which tier it goes in decides who can see it.** `GET /api/v1/settings` serves
the public subset to a stranger, that plus loan policy to any signed-in caller,
and everything to an admin ([ADR-024's neighbours](decisions.md), WO-77). Two
consequences worth knowing before you debug either: a public page reading a key
that is declared but not *public* renders its `|| 'fallback'` literal forever,
and a browser call that does not go through `lib/settings-client.ts` sends no
token and silently gets the public subset. Both are enforced by
`test/unit/settings-keys-read.test.ts`.

**Every declared key is read by something.** That was not always true —
`loan.noticePeriodMonths` and `loan.missedPaymentsForDefault` were editable and
enforced by nothing, so the screen reported policy the system did not apply. Both
are enforced now ([ADR-016](decisions.md)). If you add a key, search the
*enforcement* surface to check it stays that way; matching the settings page
proves only that the key exists.

---

## "I want to add an endpoint"

One question decides the backend: **does it change a balance?**

- **Yes → Go.** Route in `cmd/server/main.go`, HTTP shape in
  `dashboard_handler.go`, SQL in the matching `*_repository.go`. Mount it inside
  the `/admin` group if it is admin-only — that group is gated at the router, so
  a new handler is protected by *where it is mounted* rather than by remembering
  a check.
- **No → a Next route handler is fine.** Registration intake, CMS, settings,
  status transitions.

Then document it in [`api.md`](api.md) in the same commit — an audit once found
seven Next handlers with no caller because that step was skipped in both
directions; five were deleted and the rest got their UI.

Both route surfaces are **enumerated**, so a new route fails the build until you
declare who may call it: `chi.Walk` for Go, a filesystem walk for Next. A
`/support/*` route additionally needs adding to the Next proxy's allow-list.

---

## "I want to move off Vercel and Render onto a VPS"

The application is already portable; this is an infrastructure job, not a code
job. Both apps have Dockerfiles, `docker-compose.yml` runs the full stack, and
CI publishes images to GHCR tagged by commit SHA.

**What the app needs from any host** — this is the entire contract:

| | Go API | Next web |
|---|---|---|
| Required | `DATABASE_URL`, `JWT_SECRET` (32+ chars) | `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_API_URL` |
| Also set | `CORS_ORIGINS`, `ENABLE_HSTS=true`, `TRUSTED_PROXIES`, `METRICS_TOKEN` | Cloudinary keys |
| Listens on | `API_PORT` / `PORT`, default 8081 | 3000 |
| Health | `GET /v1/health` (liveness), `GET /v1/ready` (pings DB) | — |

Full list: [`.env.render.example`](../.env.render.example) and
[`.env.vercel.example`](../.env.vercel.example). They are separate stores — a
variable added to one is missing from the other, and `JWT_SECRET` **must be
identical in both** or every login fails with a correct password.

**Three things that are Vercel/Render-shaped and must be replaced:**

1. **TLS termination.** Render does it. On a VPS use Caddy (automatic Let's
   Encrypt) or nginx + certbot. `ENABLE_HSTS=true` only once HTTPS is permanent —
   browsers remember it for the whole `max-age`.
2. **`TRUSTED_PROXIES`** counts the reverse proxies in front of the API and
   decides which `X-Forwarded-For` entry is trusted. Render is `1`. Set it to
   match your proxy chain: too low and the rate limiter, the access log, the
   login lockout and the audit rows all key on a value the caller controls; too
   high and a forged entry is treated as infrastructure's. One knob, four
   consumers, both failure directions silent ([ADR-019](decisions.md)).
   **It stays at 1 even though Vercel proxies the support routes** — that path is
   one hop deeper, and there is no value correct for both, which is why the
   support proxy limits per member on its own side instead
   ([ADR-021](decisions.md)). Do not raise it to 2.
3. **The stop grace period must exceed `SERVER_SHUTDOWN_TIMEOUT`** (30s default)
   or a deploy `SIGKILL`s the API mid-transaction. On Render this is a dashboard
   setting; in systemd it is `TimeoutStopSec`; in compose it is
   `stop_grace_period`.

**Two things that are genuinely UTC-shaped.** Neon defaults to UTC and a VPS may
not. The pool pins `timezone=UTC` on every connection
([main.go](../apps/api/cmd/server/main.go)) — **do not remove that line**; without
it, timestamp comparisons drift by your server's offset and every token issued
after a password change is born revoked. And `pgx` runs in
`QueryExecModeSimpleProtocol` for Neon's pooler; that is harmless on a plain
Postgres, so leave it.

The staged plan with the cutover runbook is INF-01 → INF-12 in
[`production-readiness.md`](production-readiness.md). Do it only once everything
else is quiet.

---

## "I want to change the database schema"

`prisma/schema.prisma` is the source of truth; the Go API reads the same tables
with raw SQL, so a rename breaks Go silently at runtime rather than at compile
time. Grep `apps/api` for the column name before renaming anything.

```bash
pnpm db:migrate:dev     # generate the migration locally
pnpm db:migrate         # apply it — in EVERY environment
```

Never `db:push` at anything you cannot rebuild ([ADR-014](decisions.md)) — it
diffs against the live database and will drop a column to make it match.

**Two traps that have already cost production incidents**, both documented in
[`data-model.md`](data-model.md): an `@updatedAt` column gets **no database
default**, so hand-written `INSERT`s must set `"createdAt"` and `"updatedAt"`
themselves; and column names are camelCase and **must be quoted** in raw SQL
(`a."savingsBalance"`).

`audit_logs` has a `BEFORE UPDATE OR DELETE` trigger that Prisma cannot model.
A `--from-empty` baseline would drop it — the warning is in `schema.prisma` above
`model AuditLog`.

---

## "I want to change a generated document"

Statements, receipts, loan agreements, certificates: `lib/documents/`. They are
**English only** by decision ([ADR-012](decisions.md)) — do not add Bengali; the
PDF's standard fonts cannot shape conjuncts, and the last attempt is why these
were screenshots for a while.

One builder produces a renderer-independent model; two renderers consume it
(`render/html.ts` for print, `render/pdf.ts` for download) so the two outputs
cannot drift. Adding a document is one builder plus one export line. Adding a
*kind of* content is a new `Block` variant handled in **both** renderers.

Amounts print as `BDT 1,25,000` — the `৳` sign cannot be encoded. Document
numbers come from `document_sequences`, never from a random or a timestamp
([ADR-013](decisions.md)).

---

## Before you commit, whatever you changed

```bash
pnpm typecheck        # must be zero errors; rm -rf apps/web/.next if it
                      # reports a missing app/api/**/route.js
pnpm lint
pnpm test:unit        # web, ~1s
pnpm test:go          # Go, no database needed
```

**`apps/web/next-env.d.ts` is generated and untracked.** If you see it in
`git status`, something re-added it — do not commit it. `next dev` writes
imports pointing at `.next/dev/types` and `next build` writes `.next/types`, so
a tracked copy is dirtied by whichever one you ran last. Next documents it as an
implementation detail that must be gitignored.

If you touched money or SQL, also run the integration suite against the test
stack ([testing.md](testing.md)). It is the only thing that tests what the
database actually does — and a green suite only bounds the cases it contains.
It now includes the ledger reconciliation, which sums the whole thing and
compares it to the stored balances; if a change of yours makes a balance and its
transactions disagree, that suite is where you find out.

If you touched anything a page imports, run `pnpm build` and then
`node apps/web/scripts/assert-static-routes.mjs` and `pnpm test:bundle`. Both
read what the build emitted, because whether a route is static and how much
JavaScript it ships are conclusions the bundler draws after following every
import — no test over the source can reach either.

If you touched the schema, say so in your handover: `pnpm db:migrate` has to run
in every environment, and nothing runs it for you.
