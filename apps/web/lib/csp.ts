/**
 * The Content-Security-Policy this application sends, and the reasoning for
 * every relaxation in it.
 *
 * WO-76. `next.config.js` has set seven security headers since the app was
 * written — HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
 * `Permissions-Policy` and two more. None of them is a CSP. The Go API has one;
 * the Next app, which renders member balances, accepts NID uploads and is the
 * only surface a member's browser actually loads, did not. CSP is the control
 * that turns a successful XSS from account takeover into nothing happening.
 * Every other header on that list is narrower.
 *
 * Why there are two policies and not one
 * --------------------------------------
 * This is the part to read before changing anything here.
 *
 * A nonce-based `script-src` is the strong form: the browser runs an inline
 * script only if it carries a random value the attacker cannot predict. Next
 * injects that nonce into its own script tags **during server-side rendering**,
 * by parsing the `Content-Security-Policy` request header. A page prerendered at
 * build time has no request and therefore no nonce, so a nonce policy on a
 * static page blocks Next's own hydration bootstrap and the page is dead.
 *
 * That collides head-on with WO-73, which made the ten marketing routes static
 * precisely because reading `system_config` on every visit was the largest
 * performance item in the repository. Next's documented escape hatch —
 * `experimental.sri` — was tried and does not help: it adds `integrity` to 8 of
 * the 14 external scripts and leaves all **6 inline RSC payload scripts**
 * untouched, and those are what a strict `script-src` blocks. Their content is
 * the page's own data, so their hashes differ per page and per build and cannot
 * go in a static header either.
 *
 * So the policy is chosen per route, by what the route can defend:
 *
 *   SESSION routes — `/dashboard/**` and the four auth pages. Dynamic by
 *     declaration, so Next injects a nonce. Full strict policy, no
 *     `'unsafe-inline'` in `script-src`. This is every page where money,
 *     credentials or a member's own data appear.
 *
 *   CONTENT routes — the marketing pages. Prerendered, so `script-src` must
 *     tolerate inline scripts. Everything *else* stays strict: scripts can only
 *     be loaded from this origin, forms can only post here, the page cannot be
 *     framed, `base-uri` cannot be rewritten, and `connect-src` and `img-src`
 *     name the only hosts that may receive a request.
 *
 * The residual risk of the second tier, stated plainly: an inline XSS on a
 * marketing page would execute, and the session token lives in `localStorage` on
 * this origin. What holds that risk down is that these pages have almost no XSS
 * sink — there is no `innerHTML` and no `eval` anywhere in `app/`, `components/`
 * or `lib/`, so every admin-controlled string they render goes through React's
 * escaping. `connect-src` and `img-src` then deny the usual exfiltration paths
 * even if one appeared. This is a real tradeoff rather than a free win, and it
 * is the reason it is written down here instead of in a commit message.
 *
 * **"Almost" is WO-79.** Structured data has to be written with
 * `dangerouslySetInnerHTML`: React HTML-escapes a text child, entities are not
 * decoded inside a `<script>` element, and the JSON arrives at the crawler
 * unparseable — Next's own JSON-LD guide specifies the attribute for exactly
 * this reason. So there is now one sink, in
 * `components/seo/structured-data.tsx`. It takes an object rather than a string,
 * builds the graph itself, and serialises through a function that escapes `<`,
 * so an admin who types `</script>` into the organisation name produces inert
 * text. `csp.test.ts` counts the occurrences across all three directories and
 * fails on a second one — the claim in this comment is a test rather than a
 * comment.
 */

/**
 * Routes whose CSP carries a nonce. They must be dynamically rendered.
 *
 * The locale segment is **optional**, and that is WO-95 rather than
 * permissiveness: English lost its prefix, so `/login` and `/dashboard/admin`
 * are now the English forms. The old `/^\/(en|bn)\//` shape matched neither, and
 * the failure would have been silent in both directions — every English session
 * page served the marketing policy, with `'unsafe-inline'` on the two surfaces
 * that hold a token, and no nonce stamped onto the scripts that need one.
 */
export function isSessionRoute(pathname: string): boolean {
  return (
    /^(\/(en|bn))?\/dashboard(\/|$)/.test(pathname) ||
    /^(\/(en|bn))?\/(login|register|forgot-password|reset-password)(\/|$)/.test(pathname)
  );
}

export type CspOptions = {
  /** The per-request nonce. Omitted for the content tier, which has none. */
  nonce?: string;
  /** `NEXT_PUBLIC_API_URL` — the Go API is a different origin in every environment. */
  apiOrigin?: string;
  /** Development needs `'unsafe-eval'`: React uses `eval` to rebuild server stacks. */
  isDev?: boolean;
  /**
   * Whether this policy will be sent as `Content-Security-Policy-Report-Only`.
   *
   * It changes the policy, not just the header name: `upgrade-insecure-requests`
   * does nothing in report-only mode, and Chromium writes a console notice
   * saying so on **every page load**. That notice is indistinguishable from a
   * real violation in a console-scraping test, so a directive that cannot work
   * is omitted rather than left in to be filtered out later.
   */
  reportOnly?: boolean;
};

/**
 * The image host, named once.
 *
 * It appears in two directives that mean different things about the same asset:
 * `img-src` is permission to *render* a member's NID scan, `connect-src` is
 * permission to *read* it into a Blob so it can be saved to the phone. Two
 * spellings of one origin is how those two came to disagree.
 */
const CLOUDINARY_ORIGIN = 'https://res.cloudinary.com';

/**
 * Build the policy for one request.
 *
 * Directives are listed in the order a reviewer reads them: what may execute,
 * what may be fetched, what may be talked to, what may contain or be contained.
 */
export function buildCsp({
  nonce,
  apiOrigin,
  isDev = false,
  reportOnly = false,
}: CspOptions): string {
  const scriptSrc = nonce
    ? // 'strict-dynamic' lets a nonced script load the chunks it needs without
      // every chunk URL being enumerated here — which is the only workable
      // shape for a bundler that emits content-hashed filenames.
      `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : // No nonce is available on a prerendered page; see the note above.
      `'self' 'unsafe-inline'`;

  const directives: Array<[string, string]> = [
    ['default-src', `'self'`],
    ['script-src', isDev ? `${scriptSrc} 'unsafe-eval'` : scriptSrc],
    // Tailwind sets style attributes on elements it animates, and React writes
    // inline styles for anything measured at runtime. This is the one
    // relaxation with no alternative — a nonce cannot reach a style attribute.
    ['style-src', `'self' 'unsafe-inline'`],
    // `next/font/google` downloads and self-hosts at build time, so no font
    // host appears here. If that ever changes this is where it breaks.
    ['font-src', `'self' data:`],
    // data: and blob: are the NID and photo upload previews, drawn from a
    // FileReader before anything is sent. res.cloudinary.com is where they end
    // up; most are served back through /_next/image on this origin, but the raw
    // URL is used in a few places.
    ['img-src', `'self' data: blob: ${CLOUDINARY_ORIGIN}`],
    ['connect-src', connectSrc(apiOrigin, isDev)],
    // Nothing embeds anything, and nothing may embed this. `frame-ancestors`
    // is the modern half of the `X-Frame-Options: DENY` already being sent.
    ['frame-src', `'none'`],
    ['frame-ancestors', `'none'`],
    ['object-src', `'none'`],
    // Without this an injected <base> silently re-points every relative URL on
    // the page, including the ones the app posts to.
    ['base-uri', `'self'`],
    ['form-action', `'self'`],
  ];

  // Enforcing only — see `reportOnly` above.
  if (!reportOnly) {
    directives.push(['upgrade-insecure-requests', '']);
  }

  return directives
    .map(([name, value]) => (value ? `${name} ${value}` : name))
    .join('; ');
}

/**
 * Where the browser is allowed to send a request.
 *
 * The Go API is cross-origin in every environment, so it has to be named. Sentry
 * does **not**: `next.config.js` sets `tunnelRoute: '/monitoring'`, which routes
 * browser error reports through this app's own domain so an ad blocker cannot
 * drop them — and that makes them same-origin, covered by `'self'`. Adding an
 * ingest host here would be dead configuration that looks load-bearing.
 *
 * `res.cloudinary.com` is here for one reason: **saving** a member's NID scan or
 * photograph. `img-src` already allows it, so the approvals and member-detail
 * screens could always *show* the document — and the Download button beside the
 * preview could never work, because `downloadDocumentFile` has to `fetch` the
 * asset to get a Blob before it can name the saved file. The two are separate
 * directives, so the screen looked completely correct while half of it was
 * blocked; the only symptom was a button that did nothing, since the fetch
 * rejects and the caller logs to a console nobody has open on a phone.
 */
function connectSrc(apiOrigin: string | undefined, isDev: boolean): string {
  const sources = [`'self'`, CLOUDINARY_ORIGIN];

  const origin = normalizeOrigin(apiOrigin);
  if (origin) sources.push(origin);

  // `next dev` opens a websocket to itself for hot reload. ws: never reaches
  // production, and leaving it out makes the dev console unusably noisy.
  if (isDev) sources.push('ws:');

  return sources.join(' ');
}

/**
 * `https://api.example.com/` → `https://api.example.com`.
 *
 * A CSP source is an origin, not a URL: a trailing slash or a path turns the
 * source into a path prefix match, which is a subtly different and usually
 * wrong policy. Returns null for anything unparseable rather than emitting a
 * malformed directive — a browser discards the whole policy on a parse error,
 * so one bad value would silently disable every directive above.
 */
function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
