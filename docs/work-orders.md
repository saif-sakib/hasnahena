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
| ~~**R**~~ | ~~Live defects~~ | WO-67 | **Done 2026-08-19** |
| ~~**S**~~ | ~~Database — correctness, constraints, redundancy~~ | WO-68 → 72 | **Done 2026-08-19** |
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

# Blocks R and S — closed 2026-08-19

WO-67 → WO-72 are done. What they contained is one row in
[changelog.md](changelog.md); what they *taught* is in [traps.md](traps.md). Two
things are worth repeating here, because both were found by the work rather than
specified by it:

- **The census found more than the order predicted.** WO-67 was written about
  four undeclared `bank.*` keys. The test that closed it walks every
  `settings['…']` read in `app/` and `components/`, and named **seven** — the
  other three were `contact.email`/`phone`/`address` on the public `/contact`
  page, which showed `contact@example.com` as the foundation's address. Those
  were not declared *or* added: `org.email`/`org.phone`/`org.address` already
  existed, seeded with the real details and printed on every generated document,
  so the fix was to delete the duplicate rather than legitimise it.
- **Two definitions of one table disagreed in exactly the predicted way.** WO-70
  asked for the bootstrap DDL and the migration to be compared before removing
  either. `document_sequences."updatedAt"` was `NOT NULL DEFAULT NOW()` in the
  bootstrap and `NOT NULL` with no default in the migration — the divergence that
  once broke all four money flows at once. And
  `idx_support_messages_thread_created_desc` was a covering index in one and a
  plain one in the other, so the covering variant had **never existed anywhere**:
  same name plus `IF NOT EXISTS` means the second creator is a silent no-op.

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
