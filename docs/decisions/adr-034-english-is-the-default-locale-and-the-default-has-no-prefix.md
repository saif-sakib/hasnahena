# ADR-034 — English is the default locale, and the default has no prefix

**Status:** accepted · owner decision 2026-08-24 · WO-94, WO-95 · supersedes the
`defaultLocale = 'bn'` / `localePrefix: 'always'` scheme.

Owner review: *"You can keep the en as default. Anyone can use bn if he wants.
Also the primary language should be en… do which one is the best practice."*

**What was wrong was not the default; it was the redirect.** `/` 307'd to a
locale chosen from `Accept-Language`. Google merges a redirecting root with
whatever it lands on and keeps the shorter URL, which is exactly what Search
Console reported: *"Duplicate, Google chose different canonical than user"* on
`/bn`, Google-selected canonical `https://hasnahenafoundation.com/`. Flipping
`defaultLocale` on its own would have moved that report from `/bn` to `/en` and
left the cause untouched. Google's own guidance is against automatic language
redirects for this reason.

So `/` is a real, self-canonical English page. `localePrefix: 'as-needed'` with
`localeDetection: false`: the path is the only input to the locale decision, and
`/` does not negotiate at all.

| URL | Serves |
|---|---|
| `/`, `/about`, `/faq`, `/dashboard/admin` | English |
| `/bn`, `/bn/about`, `/bn/dashboard/admin` | Bengali |
| `/en/*` | **301** to the unprefixed form |

**Four decisions inside that, each of which could have gone the other way.**

1. **The dashboard loses its prefix too.** WO-95 offered keeping
   `/en/dashboard/...` prefixed as the smaller change, and it would have been —
   but two URL rules is the shape that drifts, and every URL in the application
   is built by `localePath()`, which has no reason to know whether a page has
   SEO value. One rule, no exceptions.

2. **301, not next-intl's own 307.** next-intl's `as-needed` mode redirects
   `/en/faq` on its own, temporarily. That is correct for a browser and useless
   as a canonical signal — Google treats a temporary redirect as reversible and
   may keep the old URL indexed. `proxy.ts` answers 301 before next-intl runs.
   301 rather than 308 because these are GET pages: method preservation buys
   nothing, and 301 is what every crawler, cache and ops tool reads without a
   second thought.

3. **`localeDetection: false`, so a Bengali browser is not redirected off `/`.**
   Leaving detection on would rebuild the old behaviour through a different
   door. A reader who wants Bengali chooses it — from the header toggle or a
   `/bn` link — which is a choice rather than a guess, and it is what keeps `/`
   a single URL with a single meaning.

4. **`Vary: Accept-Language` was deleted, not kept "just in case".** It was added
   because the negotiating root was cacheable and un-Varied, which was a real
   cache-poisoning defect. Nothing negotiates now, and a `Vary` that is not true
   costs a CDN cache entry per distinct header value on the busiest pages the
   site has. `e2e/locale-negotiation.spec.ts` asserts its absence over HTTP,
   because that is the only place a middleware header can be trusted.

**`x-default` still points at English and is still written out rather than as
`defaultLocale`,** even though the two are now equal. They answer different
questions — *what this site is primarily in* versus *what to serve a reader the
site was not built for* — and collapsing the line would make a future change to
one silently change the other.

**What did not change:** `app/[locale]/` is still the file-system shape, so
`generateStaticParams` still yields both locales and the prerender manifest keys
are still `/en/...`. `localePrefix` is a routing rule, not a directory rule, and
`assert-static-routes.mjs` reads the manifest rather than the public URLs.

---

[← all decisions](../decisions.md)
