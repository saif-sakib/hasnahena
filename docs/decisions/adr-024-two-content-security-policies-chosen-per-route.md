# ADR-024 — Two Content-Security-Policies, chosen per route

**Status:** accepted · 2026-08-19 · closes WO-76 (SEC) · shipped report-only behind `CSP_ENFORCE`.

The web app had seven security headers and no CSP, while the Go API — which no
member's browser loads — had one. CSP is the control that turns a successful XSS
from account takeover into nothing happening; every other header on that list is
narrower.

WO-76 asked for a nonce-based policy. **A nonce-based policy and a prerendered
page are mutually exclusive**, and that is a property of Next rather than a
configuration mistake: Next stamps the nonce onto its script tags while
*rendering a request*, by parsing the `Content-Security-Policy` request header. A
page generated at build time has no request, so it has no nonce, and a strict
`script-src` then blocks its own hydration bootstrap.

That collides directly with [WO-73](../changelog.md), which had just made ten
marketing routes static because reading `system_config` on every visit was the
largest performance item in the repository.

**The documented escape hatch does not work here, and it was measured rather than
reasoned about.** Next offers `experimental.sri` as the way to keep static
generation under a strict CSP. Enabled against this app it added `integrity` to
**8 of 14** external scripts and left all **6 inline scripts** untouched — and
those six are the RSC flight payload, which is what a strict `script-src`
actually blocks. Their content is the page's own data, so their hashes differ per
page and per build and cannot go in a global header either.

**The decision:** the policy is chosen per route by what the route can defend.

| Tier | Routes | `script-src` |
|---|---|---|
| session | `/dashboard/**` and the four auth pages | `'self' 'nonce-…' 'strict-dynamic'` |
| content | the ten marketing routes | `'self' 'unsafe-inline'` |

Every other directive is **identical** between them, and a test asserts that:
`connect-src` names only this origin and the Go API, `img-src` only
`res.cloudinary.com` plus `data:`/`blob:`, and `frame-ancestors`, `object-src`,
`base-uri` and `form-action` are locked in both.

The auth pages were moved to `force-dynamic` for this. They are where a password
is typed and where a session begins, so they belong in the strict tier; the cost
is four `noindex` routes that read no database rendering per request.

**The residual risk, stated plainly rather than buried.** An inline XSS on a
marketing page would execute, and the session token is in `localStorage` on the
same origin. What holds that down is that those pages have almost no XSS sink —
there is no `innerHTML` and no `eval` anywhere in `app/`, `components/` or
`lib/`, so every admin-controlled string they render goes through React's
escaping — and `connect-src`/`img-src` deny the usual exfiltration paths even if
one appeared. This is a real tradeoff, not a free win, and the day Next can nonce
a prerendered page it should be revisited.

**"Almost" is WO-79.** Structured data cannot be written as a text child: React
HTML-escapes it, entities are not decoded inside a `<script>` element, and the
JSON reaches the crawler unparseable — Next's own JSON-LD guide specifies
`dangerouslySetInnerHTML` for exactly this reason. So there is now one sink, in
`components/seo/structured-data.tsx`. It takes an object rather than a string,
builds the graph itself, and serialises through a function that escapes `<`, so
an admin who types `</script>` into the organisation name produces inert text.
`test/unit/csp.test.ts` counts the occurrences across all three directories and
fails on a second one — the claim in this paragraph is a test, not a sentence.

**Rollout.** Report-only by default; `CSP_ENFORCE=1` on Vercel switches the
header name and nothing else. A policy that breaks the dashboard gets removed in
a hurry rather than fixed, so the enforcing form was verified first: a real
browser, a production build, zero violations and zero hydration failures across
every public page and both dashboards.

**One directive is dropped in report-only mode**: `upgrade-insecure-requests`
does nothing there and Chromium says so in the console on every page load, which
a console-scraping test cannot distinguish from a violation.

---

[← all decisions](../decisions.md)
