# Work Orders

An execution spec: exact files, exact changes, exact verification, so a session
can act without re-exploring the codebase.

**Prompt with the ID — `do WO-67` — or with a whole block — `do block S`.**

Line numbers are anchors, not guarantees: match on quoted code. The traps that
outlived earlier orders are in [traps.md](traps.md); WO-01 → WO-66 are closed and
compressed in [changelog.md](changelog.md).

---

## The plan, in the order to do it

Six blocks. **The order is not arbitrary** — each is ordered by what it costs to
do later, the same principle as [go-live.md](go-live.md).

| Block | What | Orders | Why here |
|---|---|---|---|
| **R** | Live defects | WO-67 | Public and money-facing. Do it today |
| **S** | Database — correctness, constraints, redundancy | WO-68 → 72 | Every one is a migration now and a migration **plus a backfill** after go-live |
| **T** | Performance | WO-73 → 75 | The dominant cost driver is architectural, not a tuning knob |
| **U** | Security | WO-76 → 78 | One real gap, two known-and-accepted narrowings |
| **V** | SEO | WO-79 → 81 | Cheap, independent, and blocked by nothing |
| **W** | Future-proof | WO-82 → 84 | What makes the rest stay true without you watching |

**Each order is independently executable and independently verifiable.** Blocks
S and T are ordered internally (WO-73 assumes WO-68's indexes exist); the rest
can be done in any order.

### Standing rules for every order

- `pnpm typecheck` exits clean, zero errors.
- `pnpm lint` exits 0 with **6 warnings**. **Do not let the count grow.**
- A regression test must be seen to **fail against the pre-fix code** before it
  is allowed to pass. When a test *cannot* be made to fail, say so in the test.
- Money changes stay in the Go API, one transaction, with an `audit_logs` row.
- Update [tasks.md](tasks.md) and tick the order here in the same commit.

---

# Block R — the live defect

## WO-67 · The donate page shows a bank account nobody can change

**Severity: high. Public, money-facing, and live now.**

`app/[locale]/donate/page.tsx` renders four `bank.*` values with hardcoded
fallbacks, in a large highlighted monospace box:

```tsx
<p className="font-medium text-lg">{settings['bank.name'] || 'Islami Bank Bangladesh PLC'}</p>
<p>… {settings['bank.accountName'] || 'Hasnahena Foundation'}</p>
<p className="font-mono … text-xl …">{settings['bank.accountNo'] || '2050 0000 0000 0000'}</p>
<p>… {settings['bank.branch'] || 'Local Office'}</p>
```

**None of those four keys is in `SYSTEM_CONFIG_KEYS`, none is seeded, and
`PUT /api/v1/settings` rejects the entire request on an unrecognised key.** So
the fallbacks are not fallbacks — they are the only values the page can ever
show, and no admin can change them through any screen. A donor reading that page
is being given a placeholder account number to send money to.

This is the mirror image of the WO-46 defect: there, a control posted keys the
allow-list did not know; here, a page *reads* keys the allow-list will not let
anyone write.

**Do:**

1. Add `bank.name`, `bank.accountName`, `bank.accountNo`, `bank.branch` to
   `SYSTEM_CONFIG_KEYS` in `apps/web/lib/system-config.ts`.
2. Seed them in `apps/web/scripts/seed.mjs` as **empty strings**, not as the
   current placeholders. An empty value must render as "not yet published"
   rather than as a plausible account number — a wrong number is worse than a
   missing one on this page specifically.
3. Give them controls on the admin settings page, in the existing Organisation
   tab.
4. Replace the `|| 'literal'` fallbacks with the empty-state treatment from (2),
   and hide the whole bank card when the account number is unset.

**Prove it:** a unit test that fails when any `settings['…']` literal in
`app/[locale]/**` names a key absent from `SYSTEM_CONFIG_KEYS`. Written as a
census, so the *class* is closed rather than these four keys — walk the page
files for `settings['x']` / `settings["x"]` and diff against the allow-list. It
must be seen red against today's code, naming all four.

**Also check while you are there:** the same census will tell you whether any
other page reads an undeclared key. Fix whatever it names in this order.

**Action for the owner:** the real bank details have to be typed into the admin
settings screen after this ships. Until they are, the card stays hidden — which
is the intended behaviour, not a bug.

---

# Block S — database

Everything here is cheap exactly once. After real member data exists, each is a
migration **plus a backfill plus a plan for rows written in between**.

## WO-68 · Index the five unindexed foreign keys

`Loan.guarantorId` carries the worst of it. It is filtered in nine places
including a **correlated subquery evaluated per row** of the member list:

```sql
EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = u.id AND l.status IN ('APPROVED','ACTIVE'))
```

With no index that is a sequential scan of `loans` for every member rendered.
At today's row counts it is invisible; it degrades as the square of membership,
and the member list is the screen a worker opens most.

| Model | Column | Queried by |
|---|---|---|
| `Loan` | `guarantorId` | `member_repository.go:158,518,672` · `worker_repository.go:310` · `transaction_repository.go:361,1074` · 3 joins |
| `Loan` | `accountId` | `loan_repository.go:392` join |
| `Transaction` | `loanId` | `loan_repository.go:650` — a loan's repayment history |
| `Document` | `userId` | `worker_repository.go:464` · `admin_repository.go:280` — every approval screen |
| `SupportThread` | `processedByUserId` | staff thread filters |
| `SseTicket` | `userId` | ticket issue and cleanup |

**Do:** add `@@index` for each in `schema.prisma`, generate one migration with
`pnpm db:migrate:dev`, apply it.

For `guarantorId` prefer `@@index([guarantorId, status])` — the predicate is
always `guarantorId = ? AND status IN (…)`, so a composite index answers it from
the index alone.

**Prove it:** extend the FK-coverage idea into a test that reads
`schema.prisma`, extracts every `@relation(fields: [...])` scalar, and fails when
one has no index with that column **leading**. That closes the class: the next
foreign key someone adds fails the build until it is indexed. Verify it red by
removing one of the new indexes.

**Note the second reason this matters:** Postgres takes a row lock on the
referenced parent for FK checks, and an unindexed child makes deleting or
updating a parent scan the whole child table. `pnpm db:clear` already feels this.

## WO-69 · Give the database its own opinion about money

**There is not one `CHECK` constraint in the entire schema.** Every money
invariant — no negative balance, no zero-amount posting, no more instalments paid
than exist, no fee — is enforced only in application code, by **two** backends
that write the same tables.

The application enforcement is correct today. That is not the point: the database
is the last line of defence, it is the one both backends must pass through, and
it is the only layer that stays true when someone runs a repair query by hand at
2am.

**Do:** one migration adding constraints. Prisma cannot model `CHECK`, so this is
hand-written SQL in the migration, like the `audit_logs` trigger.

```sql
ALTER TABLE accounts
  ADD CONSTRAINT accounts_savings_non_negative CHECK ("savingsBalance" >= 0),
  ADD CONSTRAINT accounts_loan_non_negative    CHECK ("loanBalance" >= 0);

ALTER TABLE transactions
  ADD CONSTRAINT transactions_amount_positive CHECK (amount > 0);

ALTER TABLE loans
  ADD CONSTRAINT loans_principal_positive   CHECK ("principalAmount" > 0),
  ADD CONSTRAINT loans_remaining_in_range   CHECK ("remainingAmount" >= 0
                                                   AND "remainingAmount" <= "principalAmount"),
  ADD CONSTRAINT loans_installments_in_range CHECK ("paidInstallments" >= 0
                                                    AND "paidInstallments" <= "totalInstallments"),
  -- Rule 3, as a database constraint rather than a convention.
  ADD CONSTRAINT loans_zero_fee CHECK ("applicationFee" = 0);
```

`loans_zero_fee` is the one to be deliberate about. `applicationFee` is already
pinned in both directions by `requirements.test.ts` and
`lifecycle_integration_test.go`, so this adds no new *policy* — it moves the
guarantee from "a test would catch it" to "the write fails". For a Shariah
constraint that is the right place for it.

**`remainingAmount <= principalAmount`** is the one most likely to reject a real
write, because the default waterfall and repayment both touch it. Run the full
integration suite before trusting it, and if a legitimate path violates it, that
path is the finding — report it rather than dropping the constraint.

**Prove it:** an integration test per constraint that attempts the illegal write
with raw SQL and asserts the error. Seen red by running it before the migration.

**Also record** in [data-model.md](data-model.md) that `CHECK` constraints are
invisible to `prisma migrate diff` in the same way the `audit_logs` trigger is —
so a future `--from-empty` baseline drops them silently. That is now two things
in that category, which is worth stating once, loudly.

## WO-70 · One source of truth for the schema

`EnsureSupportSchema` runs `CREATE TABLE IF NOT EXISTS` at **every boot** of the
Go API for `document_sequences`, `support_threads`, `support_messages` and
`sse_tickets` — plus their indexes. All four are **also** modelled in
`schema.prisma` and created by the `0_init` migration.

Two definitions of the same tables, in two languages, with no check that they
agree. This has already cost one production incident: `document_sequences` was
created by this bootstrap **with `DEFAULT NOW()`**, a later `db push` stripped
it, and all four money flows broke at once with a generic 500
([data-model.md](data-model.md)).

`IF NOT EXISTS` is what makes it dangerous rather than obviously broken — on a
migrated database the DDL is a silent no-op, so the divergence is invisible until
the day something creates the table from the wrong definition.

**Do:**

1. Confirm the migrated schema and the bootstrap DDL agree **column for column**
   today. Any difference is a finding: report it before changing anything.
2. Delete the DDL from `EnsureSupportSchema`. Keep the function only if it still
   does something else; if it is now empty, remove it and its call in `main.go`.
3. Migrations become the only path. `pnpm db:migrate` already runs everywhere.

**Prove it:** `wiring_test.go` already reads `main()`'s AST — extend it to fail
if any repository method issues `CREATE TABLE`, `CREATE INDEX` or `ALTER TABLE`.
Seen red against today's code.

**Why this is worth a whole order:** it is the structural form of the trap that
has bitten this repository twice — *two backends over one schema drift*. Every
other instance was a fix applied to one side and not the other. This one is a
whole schema defined on both sides.

## WO-71 · Collapse the legacy `LoanStatus` values

`LoanStatus` carries `PENDING` and `APPROVED` beside the spec-aligned
`PENDING_GUARANTOR` / `PENDING_APPROVAL`. **`PENDING` is still the schema
default**, so new rows keep being written into the legacy vocabulary.

It has already cost one bug: the guarantor panel filtered `PENDING` while
applications create `PENDING_GUARANTOR`, so a guarantor never saw their request.
Live queries still name the legacy values —
`WHERE l.status IN ('APPROVED','ACTIVE')` appears in four repositories.

**Postgres will not drop an enum label any row still references**, which is why
this is a Block S item and not a Block W one.

**Do:**

1. Map every legacy value: `PENDING → PENDING_APPROVAL`, `APPROVED → ACTIVE`.
   Confirm that mapping against `product.md`'s lifecycle before writing it — if
   it is wrong the migration is unrecoverable after real loans exist.
2. Migration: `UPDATE loans SET status = …` for both, then change the column
   default to `PENDING_GUARANTOR`, then drop the two labels.
3. Grep **both** backends for the literals and update every one. `IN
   ('APPROVED','ACTIVE')` becomes `IN ('ACTIVE')`.
4. Update `data-model.md`'s enum list.

**Prove it:** `lifecycle_integration_test.go` already walks all nine
`LoanStatus` values — it will fail until the table matches. Add an assertion
that the enum has exactly the seven spec values, so the labels cannot come back.

## WO-72 · Two more redundancies, and one asymmetry

Smaller than WO-67 → 71, and grouped because each is a five-line change.

**1. `Branch` is a dead model.** Nothing reads or writes the `branches` table
except `db:clear` deleting from it. Meanwhile `User.assignedBranch` is a **free
string** with no relation to it, written by the admin worker form as
`assignedArea`. A table modelling branches and a string column modelling
branches, unconnected — the same shape as the `accountNumber` duplication
([ADR-023](decisions.md)).

Decide one way and write it down: either make `assignedBranch` a real FK to
`Branch` and give branches an admin screen, or **drop the `Branch` model** and
keep the string. For a single-branch foundation in Vekutia, dropping it is
almost certainly right — but that is the owner's call, so ask before dropping a
table.

**2. The two 1-1 address relations point in opposite directions.**
`permanentAddress` puts the foreign key on `Address` (`userPermanentId`);
`presentAddress` puts it on `User` (`presentAddressId`). Same cardinality, same
lifecycle, two shapes — so every query and every cascade rule has to be written
twice and one of them is always the surprising one. Pick the `Address`-side
form for both (it cascades correctly on user deletion) and migrate.

**3. `Transaction` carries both `accountId` and `userId`; `Loan` carries both
`accountId` and `borrowerId`.** Since [ADR-023](decisions.md) made
`accounts.userId` unique, each pair is two paths to one fact and they can
disagree. Do **not** drop the columns — they are load-bearing for query shape.
Instead add the constraint that they cannot diverge, as a trigger or a composite
FK, and a reconciliation assertion in WO-82's job.

**Prove it:** for (3), an integration test that writes a transaction whose
`userId` is not the account's owner and asserts it is refused. Seen red first.

---

# Block T — performance

## WO-73 · Every public page hits the database on every visit

`next build` reports **50 of 52 routes as `ƒ` (server-rendered on demand)**.
Only `/_not-found`, `/robots.txt` and `/sitemap.xml` are static. That includes
`/about`, `/faq`, `/privacy`, `/terms`, `/activities`, `/contact` — pages whose
content changes when an admin edits a setting, which is to say almost never.

The cause is one line, repeated in every page:

```ts
const settingsResult = await prisma.systemConfig.findMany();
```

No `select`, no `where`, no cache. So every visit to `/en/privacy` opens a Neon
connection and reads every column of every config row — on a free tier, behind a
Render instance that sleeps.

**This is the single largest performance item in the repository**, and it is also
an SEO item: TTFB feeds Core Web Vitals, and a cold Neon read is the whole of
this page's TTFB.

The invalidation machinery already exists — `PUT /api/v1/settings` already calls
`revalidatePath('/')` and three more. Only the read side is missing.

**Do:**

1. One cached accessor in `lib/system-config.ts`:
   `getPublicSettings()`, wrapped in `unstable_cache` with the tag
   `system-config`, selecting **only the keys the public pages read** rather
   than `findMany()`.
2. Replace every `prisma.systemConfig.findMany()` in `app/[locale]/**` with it.
3. `revalidateTag('system-config')` in the settings `PUT`, beside the existing
   `revalidatePath` calls.
4. Add `export const revalidate` where a page can be static, and confirm the
   build output flips those routes from `ƒ` to `○`/ISR.

**Prove it:** assert on the build output. A test — or a CI step — that parses
`next build`'s route table and fails if a named list of marketing routes is
dynamic. Seen red against today's build, where every one of them is.

**Watch for:** the gallery and homepage read `galleryItem` too, so they need the
same treatment or they stay dynamic and this looks half-done. And **do not cache
anything under `dashboard/`** — those reads are per-member.

## WO-74 · The dashboard makes 26 requests a minute, per tab, forever

`components/layout/dashboard-layout.tsx` runs three `setInterval` polls in the
shell that wraps **every** dashboard page:

| Interval | What | Rate |
|---|---|---|
| 20 s | notifications | 3/min |
| 10 s | support signals | 6/min |
| 7 s | support threads **+ messages for the open thread** | 8.5–17/min |

That is **~26 requests per minute for every open dashboard tab**, whether or not
anything has changed, for as long as the tab is open. One full browser suite run
measured 288 requests to `/v1/dashboard/notifications` and 144 to
`/v1/dashboard/support/threads` — that measurement is this code.

At twenty concurrent members it is ~500 requests/minute against a free Render
instance and a free Neon compute, for data that changes a few times an hour.

**The replacement already exists and is unused.** `GET
/v1/dashboard/support/stream` is a live, authenticated SSE endpoint with a
60-second ticket endpoint beside it for `EventSource`, which cannot set an
`Authorization` header. `EventSource` appears nowhere in `apps/web`.

**Do:**

1. A `useServerEvents` hook: fetch a ticket, open `EventSource`, reconnect with
   a **fresh** ticket every time (they are single-use and 60 s), and fall back to
   the current polling if the stream fails to open twice.
2. Move support threads and messages onto it. Keep a slow poll — 60 s, not 7 s —
   as the backstop.
3. Notifications: if the stream does not carry them, widen the interval to 60 s.
   Nothing about a notification needs 20-second latency.
4. `document.hidden` → suspend. A backgrounded tab should poll at zero.

**Prove it:** a Playwright spec that opens a dashboard, waits 60 s, and asserts
the request count to `/notifications` and `/support/threads` is under a
threshold. Seen red against today's code, which will be at roughly 26.

**The `document.hidden` half is worth doing even if the SSE work stalls** — it is
a dozen lines and removes most of the traffic on its own, because most open tabs
are not the focused tab.

## WO-75 · Payload and query hygiene

Smaller wins, grouped. Each is independently verifiable; do them together
because they share a verification step.

- **`findMany()` with no `select`** — after WO-73 the config reads are cached,
  but the same pattern appears in the dashboard routes where caching is not an
  option. Select the columns each caller uses.
- **`<img>` in `dashboard/admin/gallery`** — the one remaining raw tag. It is an
  admin screen so the LCP impact is small; convert it for consistency and to
  take the lint warning count from 6 to 5. **Then lower the expected count in
  `work-orders.md` and CI** in the same commit, or the next order is confused by
  a stale number.
- **The Go pool** — `DB_MAX_CONNS` defaults to 25 against Neon's free-tier
  connection ceiling. Confirm the two are compatible under the concurrency the
  integration suite drives, and write the reasoning next to the default.

**Prove it:** the existing query-count tests already assert list reads are flat.
Extend them to assert the *column* count on the hottest reads, so a `SELECT *`
creeping back in fails.

---

# Block U — security

## WO-76 · The web app has no Content-Security-Policy

`next.config.js` sets seven security headers — HSTS, `X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy`, `Permissions-Policy`, and two more. **There is no
`Content-Security-Policy`.**

The Go API has one (`default-src 'self'; frame-ancestors 'none'`). The Next app —
which renders member balances, accepts NID uploads, and is the only surface a
member's browser actually loads — does not.

CSP is the control that turns a successful XSS from *account takeover* into
*nothing happens*. Every other header on that list is narrower.

**Do:** add a CSP, nonce-based rather than `'unsafe-inline'`. Next supports this
through the proxy: generate a nonce per request, set it on the header and read it
back in the layout.

The allowances this app genuinely needs, and no more:

| Directive | Needs | Why |
|---|---|---|
| `img-src` | `'self' data: blob: res.cloudinary.com` | member photos and NID scans |
| `connect-src` | `'self'` + `NEXT_PUBLIC_API_URL` + Sentry ingest | the Go API is cross-origin; Sentry only once its DSN is set |
| `script-src` | `'self' 'nonce-…' 'strict-dynamic'` | no CDN scripts are used |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind injects style attributes; this is the one unavoidable relaxation |
| `frame-ancestors` | `'none'` | matches `X-Frame-Options` |
| `form-action` | `'self'` | |

**Ship it behind `Content-Security-Policy-Report-Only` first.** A CSP that breaks
the dashboard is worse than no CSP, because it will be removed in a hurry rather
than fixed. Run the full browser suite in report-only, collect violations,
tighten, then switch to enforcing in a second commit.

**Prove it:** a route test asserting the header is present and contains
`frame-ancestors 'none'` and no `'unsafe-inline'` in `script-src`. Plus a
Playwright spec asserting zero console CSP violations across the dashboards —
which is the part that catches a policy too tight to use.

## WO-77 · Split the settings allow-list (SEC-12)

`GET /api/v1/settings` is unauthenticated, deliberately — the marketing pages and
the login screen read branding from it before anyone signs in. It no longer
returns `SELECT *`, only the declared keys. But the declared set still includes
the whole loan policy: `minDepositForLoan`, `maxLoanMultiplier`,
`maxInstallmentMonths`, `guarantorThresholdAmount`.

**Low, and genuinely low** — that policy is published to members anyway. It is
here so the *narrowing* already done is not mistaken for the *split*.

**Do:** partition `SYSTEM_CONFIG_KEYS` into `PUBLIC_CONFIG_KEYS` and the
admin-only remainder. `GET` returns the public subset to an anonymous caller and
everything to an authenticated admin. `PUT` keeps validating against the union.

**Prove it:** a route test asserting an anonymous `GET` contains `org.name` and
does **not** contain `loan.maxLoanMultiplier`, and that an admin `GET` contains
both. Seen red first.

**Do this after WO-67**, which adds four keys to the same list — otherwise you
partition it twice.

## WO-78 · Key the rate limiter on the member (RUN-09)

Every request through the support proxy reaches the Go limiter from **Vercel's**
address, so all of it shares one bucket. WO-64 capped each member at 60
mutations a minute on the Next side, which means it now takes several abusive
members rather than one to exhaust that shared bucket — an improvement, not a
fix.

[ADR-021](decisions.md) records why forwarding a header cannot solve this: the
arithmetic of `TRUSTED_PROXIES` does not admit a value correct for both the
direct and the proxied path. **Do not retry that.**

**Do:** verify the JWT inside the middleware stack and key the limiter on the
user id, falling back to the address for unauthenticated routes.

The obstacle is ordering, and it is the whole difficulty: the limiter is global
middleware and runs before auth, and keying on an **unverified** token lets an
attacker mint a fresh bucket per request by sending garbage. So the token must be
*verified* — signature and expiry — in the limiter, before the handler's own
auth runs. That means the verification happens twice per request, or the result
is carried in the context the way `RequestClientIP` carries the address.

Prefer the context, and follow [ADR-019](decisions.md)'s shape exactly: one place
decides, everything else reads it back.

**Prove it:** drive the real middleware stack — the same harness that caught
SEC-14 — with two tokens for two members from one address, and assert they get
separate buckets. Then with garbage tokens from one address, and assert they
share one.

**Low priority, and say so.** Support is chat, not money; the money routes are
reached directly, where the limiter already keys correctly.

---

# Block V — SEO

The foundation is in good shape: `sitemap.ts` and `robots.ts` exist, every one of
the ten public pages has `generateMetadata`, and `lib/seo.ts` already emits
canonical URLs and `en`/`bn` alternates. These three orders close what is missing.

## WO-79 · There is no structured data anywhere

`grep -r "application/ld+json"` returns nothing. For a registered foundation with
a physical address in Jessore, that is the largest single SEO gap: it is the
difference between a text result and a rich result with the organisation's name,
logo, address and contact point.

**Do:** JSON-LD emitted from `lib/seo.ts`, built from the **`org.*` settings**
rather than hardcoded — the admin already edits those, and hardcoding them
creates exactly the two-sources-of-truth problem WO-67 exists to fix.

| Schema | Page | Fields |
|---|---|---|
| `NGO` (extends `Organization`) | site-wide, in `[locale]/layout.tsx` | name, `alternateName` for the Bengali name, url, logo, `address` (PostalAddress), `contactPoint`, `sameAs` |
| `FAQPage` | `/faq` | every question and answer already on the page |
| `WebSite` | root | with `inLanguage` for both locales |
| `BreadcrumbList` | every public page | via a helper, not hand-written per page |

**Two things specific to this project.** Do **not** emit `FinancialService` or
`BankOrCreditUnion` — the platform is an interest-free cooperative, and those
types carry `feesAndCommissionsSpecification` and interest-rate properties that
misrepresent it. `NGO` is the honest type. And keep the JSON-LD English-only for
name and address unless the Bengali is genuinely the registered form; mixed-script
structured data is more likely to be ignored than to help.

**Prove it:** a unit test that renders the JSON-LD for each page type and
validates it parses, has `@context` and `@type`, and — importantly — that every
value it claims comes from settings actually resolves rather than emitting
`undefined`.

## WO-80 · Three correctness bugs in what is already there

Small, and each is a real defect rather than an enhancement.

**1. The default site origin is the wrong domain.**

```ts
process.env.NEXT_PUBLIC_SITE_URL?.trim()
  || process.env.NEXT_PUBLIC_APP_URL?.trim()
  || 'https://hasnahena.org'
```

The site is `hasnahenafoundation.com`. If both variables are ever unset — a
preview deploy, a misconfigured environment — every canonical URL, every
`hreflang`, the sitemap and `robots.txt` all point at a domain this project does
not own. Fix the fallback, and make the build **fail loudly** in production when
neither variable is set rather than falling back at all.

**2. No `x-default` hreflang.** `getLanguageAlternates` emits `en` and `bn` and
nothing else. Google uses `x-default` for users whose language matches neither.
Point it at `/en`.

**3. `sitemap.ts` sets `lastModified: new Date()`** — every URL claims to have
changed today, on every crawl, forever. That is not merely useless, it actively
devalues the signal. Use the `updatedAt` of the settings and gallery rows the
page depends on, or drop `lastModified` entirely. Dropping it is better than
lying.

**Prove it:** unit tests on `lib/seo.ts` for the alternates map (must contain
`x-default`) and on the sitemap (two consecutive calls must not produce two
different `lastModified` values for unchanged content). Both seen red first.

## WO-81 · Open Graph and the social card

`logo-og.png` exists (1200×630 on white, per [ADR-011](decisions.md)) and is
wired as the default. What is missing is per-page differentiation and the checks
that keep it working.

**Do:**

1. Confirm `openGraph.images` and `twitter.card` resolve to absolute URLs on
   every public page — a relative OG image is silently dropped by every social
   client.
2. `openGraph.locale` / `alternateLocale` from the locale, so a shared Bengali
   page previews as Bengali.
3. Consider `opengraph-image.tsx` for `/donate` and `/about` only. Not for all
   ten — a generated image per page is a build cost for pages nobody shares.

**Prove it:** extend the metadata test to assert every public page's OG image URL
is absolute and its `alternates.canonical` matches the locale it was rendered for.

---

# Block W — future-proof

The three things that make everything above **stay** true without you watching.

## WO-82 · The reconciliation job (OPS-07)

**The strongest guard a ledger can have**, and the one control that would have
caught LEDGER-01 the night it landed rather than in an audit months later: sum
the transactions, compare to the account balances, alert on drift.

A wrong balance looks exactly like a correct balance until someone adds it up.
That is why this outranks every other item in this block, and why
[go-live.md](go-live.md) promotes it into Stage 1.

**Do:** a Go job on the existing scheduler — the same loop `wiring_test.go`
already guards — that for every account asserts:

- `savingsBalance` equals the sum of `CONFIRMED` deposits minus `CONFIRMED`
  withdrawals. **Filter on status**: a `PENDING` withdrawal is a notice, not
  money that moved ([ADR-016](decisions.md)).
- `loanBalance` equals the sum of active loans' `remainingAmount`.
- Each loan's `remainingAmount` equals principal minus `CONFIRMED` repayments.
- Every `savingsAfter` snapshot equals the running total at that row — this is
  the one that catches a lost update *retrospectively*, because the snapshots are
  what a reprinted passbook is built from.
- WO-72's pairs agree: no transaction whose `userId` differs from its account's
  owner.

On drift: an `audit_logs` row, a `slog` error, and a `/metrics` gauge the
existing Monitor workflow can alert on. **It must never correct anything
automatically** — an automated correction to a ledger is a second defect on top
of the first.

**Prove it:** an integration test that plants a deliberate drift with raw SQL and
asserts the job reports it, plus one asserting a clean database reports nothing.

## WO-83 · Make the wins from blocks S–V unable to regress

Every block above is a one-time improvement that quietly decays. This order turns
each into a build failure.

| Gain | Guard |
|---|---|
| WO-68's indexes | the FK-coverage test from that order |
| WO-73's static pages | parse `next build`'s route table; fail if a marketing route is `ƒ` |
| WO-74's request rate | the Playwright request-count assertion |
| WO-76's CSP | header assertion + zero console violations |
| WO-79/80's SEO | metadata and JSON-LD tests |
| bundle size | record `First Load JS` per route; fail on a >10% regression |

**Follow the repo's existing shape: enumerate, do not list.** A guard that checks
a hardcoded set of routes goes stale the moment a route is added — derive the set
from the filesystem the way `routes.contract.test.ts` does.

**Prove it:** each guard seen red by reverting the improvement it protects.

## WO-84 · The bus factor (OPS-01, OPS-06)

Not code, and the reason this whole plan is worth less than it looks if it is
skipped. **One person can currently deploy this**, and that person is also the one
who would be unavailable in the scenario where it matters.

**Do:** one runbook file covering, in the order someone panicking needs them:

1. API down · database unreachable · bad deploy → rollback
2. A disputed transaction: how to correct it, given the audit log is append-only
3. A suspected credential leak: what to rotate, in which host, in what order
   (`JWT_SECRET` in Vercel and Render **together**, or every session breaks)
4. Restore from backup — pointing at `scripts/restore-check.sh`, which is a
   procedure that executes rather than a document that rots
5. Where every credential lives, and who can reach it

Then **rehearse item 4 against a Neon branch** and record the date. A restore you
have not performed is a rumour.

---

# Two things closed orders left behind

Both tracked in [production-readiness.md](production-readiness.md), neither a
code change anyone can make today:

- **DATA-06** — no backup of the Cloudinary assets. Buildable only against a real
  account with real credentials; [ADR-020](decisions.md) accepts the exposure
  until the first real member document exists and names that document as the
  trigger.
- **CI-09** — branch protection on `main`. Needs a paid plan on a private repo;
  `.githooks/pre-push` is the free stand-in and is active.
