/**
 * The two Content-Security-Policies, chosen per route (WO-76, ADR-024):
 *   SESSION routes (dashboard, auth) are dynamic, so Next injects a nonce and
 *     script-src is strict.
 *   CONTENT routes (marketing) are prerendered, so they have no nonce and must
 *     allow inline scripts; everything else stays strict.
 * The only HTML-injection sink is components/seo/structured-data.tsx, which
 * escapes `<`; csp.test.ts fails on a second one.
 */

/**
 * Routes whose CSP carries a nonce (must be dynamically rendered). The locale
 * segment is optional because English is unprefixed (WO-95).
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
   * Sent as Report-Only. Drops upgrade-insecure-requests, which does nothing
   * there and logs a console notice on every page.
   */
  reportOnly?: boolean;
};

/** The image host: img-src renders a document, connect-src downloads it. */
const CLOUDINARY_ORIGIN = 'https://res.cloudinary.com';

/** Build the policy for one request. */
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
    // Tailwind and React write inline styles; a nonce cannot reach them.
    ['style-src', `'self' 'unsafe-inline'`],
    // next/font self-hosts at build time.
    ['font-src', `'self' data:`],
    // data:/blob: are upload previews; Cloudinary is where images live.
    ['img-src', `'self' data: blob: ${CLOUDINARY_ORIGIN}`],
    ['connect-src', connectSrc(apiOrigin, isDev)],
    ['frame-src', `'none'`],
    ['frame-ancestors', `'none'`],
    ['object-src', `'none'`],
    // An injected <base> would re-point every relative URL.
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
 * Where the browser may send requests. Sentry is same-origin via the
 * `/monitoring` tunnel. Cloudinary is here so documents can be fetched as a
 * Blob for download — img-src alone only lets them be shown.
 */
function connectSrc(apiOrigin: string | undefined, isDev: boolean): string {
  const sources = [`'self'`, CLOUDINARY_ORIGIN];

  const origin = normalizeOrigin(apiOrigin);
  if (origin) sources.push(origin);

  // Hot-reload websocket, dev only.
  if (isDev) sources.push('ws:');

  return sources.join(' ');
}

/**
 * Origin only, no path (a path makes it a prefix match). Null on garbage — one
 * bad source makes the browser discard the whole policy.
 */
function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
