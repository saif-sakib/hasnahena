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
| ~~**T**~~ | ~~Performance~~ | WO-73 → 75 | **Done 2026-08-19** |
| ~~**U**~~ | ~~Security~~ | WO-76 → 78 | **Done 2026-08-19** |
| **V** | SEO | WO-79 → 81 | Cheap, independent, and blocked by nothing |
| **W** | Future-proof | WO-82 → 84 | What makes the rest stay true without you watching |

**Each order is independently executable and independently verifiable.** The
remaining blocks can be done in any order.

### Standing rules for every order

- `pnpm typecheck` exits clean, zero errors.
- `pnpm lint` exits 0 with **2 warnings**. **Do not let the count grow.**
  (Was 6 until WO-75 converted the last four raw `<img>` tags. The two left are
  the React compiler skipping the registration form — `watch` from
  react-hook-form is not analysable — and one `window.location.href` in
  `header.tsx`.)
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

# Blocks T and U — closed 2026-08-19

WO-73 → WO-78 are done. What they contained is one row in
[changelog.md](changelog.md); what they *taught* is in [traps.md](traps.md).
Four things are worth repeating here, because all four were found by the work
rather than specified by it:

- **A nonce-based CSP and static rendering cannot both be had.** WO-76 asked for
  a nonce policy; WO-73 had just made ten routes static. Next injects a nonce
  while *rendering a request*, so a prerendered page has none and a nonce policy
  blocks its own hydration. `experimental.sri`, which the Next docs offer as the
  escape hatch, was tried and measured: it adds `integrity` to 8 of 14 external
  scripts and leaves all **6 inline RSC payload scripts** untouched — and those
  are exactly what a strict `script-src` blocks. The resolution is two policies
  chosen per route, argued in full in `apps/web/lib/csp.ts`.

- **Every census in these orders was low.** WO-73 said "the cause is one line" —
  it was eight files plus two `galleryItem` reads. WO-75 said "the one remaining
  raw `<img>`, in `dashboard/admin/gallery`" — there were **four**, in
  `dashboard/admin/approvals` and `dashboard/admin/members/[id]`, and none in
  gallery. Lint went 6 → 2, not 6 → 5. Count before quoting a number.

- **`unstable_cache` serialises, so a `Date` comes back a string.** Typed as
  `Date`, it compiled and then failed the build with
  `item.date.toISOString is not a function` — on a cache *hit*, never a miss, so
  the first render of anything always looked fine. Normalise at the boundary.

- **The pool size is not a correctness constraint, and now that is known rather
  than assumed.** WO-75 asked whether `DB_MAX_CONNS=25` is compatible with Neon.
  The whole integration suite — including the 20-way concurrent-deposit test —
  passes with `pool_max_conns=2`. It can only do that because no repository call
  holds two connections at once, which is the property [ADR-017](decisions.md)
  exists to preserve, so that run is the cheapest available check that it still
  holds.

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

**Four of these six were built by the orders themselves** — a guard written
alongside the change it protects is the one that gets written. What is left is
the last row and the audit that the rest still fail when reverted.

| Gain | Guard | State |
|---|---|---|
| WO-68's indexes | the FK-coverage test from that order | `apps/web/test/unit/foreign-key-indexes.test.ts` |
| WO-73's static pages | parse the build output; fail if a marketing route is dynamic | `apps/web/scripts/assert-static-routes.mjs`, run in CI after `pnpm build`. Reads `.next/prerender-manifest.json` rather than the printed table — the manifest is the machine-readable form of the same answer. Also fails if a **dashboard or auth** route becomes static |
| WO-74's request rate | the Playwright request-count assertion | `apps/web/e2e/dashboard-traffic.spec.ts` |
| WO-76's CSP | header assertion + zero console violations | `apps/web/test/unit/csp.test.ts` and `apps/web/e2e/csp.spec.ts` |
| WO-79/80's SEO | metadata and JSON-LD tests | **still to write** — block V |
| bundle size | record `First Load JS` per route; fail on a >10% regression | **still to write** |

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
