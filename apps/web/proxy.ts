// next-intl still ships this under /middleware — that is its module path,
// unrelated to Next 16 renaming the file convention to proxy.ts.
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale, localePrefix } from './i18n';
import { localePath, localeFromPath, pathWithoutLocale } from './lib/locale-path';
import { buildCsp, isSessionRoute } from './lib/csp';
import { isJwtExpired, parseJwtPayload } from './lib/utils';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix,
  // WO-95. `/` is a real English page now, not a negotiated redirect, so there
  // is nothing at the root for `Accept-Language` to decide. Leaving detection on
  // would put the old behaviour back through a different door: a visitor whose
  // browser prefers Bengali would be redirected off `/` to `/bn`, and Google
  // would merge the two again exactly as Search Console reported.
  //
  // A reader who wants Bengali chooses it — from the header toggle, or from a
  // `/bn/...` link — and next-intl remembers that in `NEXT_LOCALE`, which is a
  // choice rather than a guess.
  localeDetection: false,
});

/**
 * WO-76. Enforce the CSP, or only report violations?
 *
 * Report-only by default, and that is deliberate rather than timid: a CSP that
 * breaks the dashboard is worse than no CSP, because it gets removed in a hurry
 * instead of fixed. In report-only the browser runs the page exactly as it
 * would have and writes every violation to the console, which is where the
 * Playwright spec reads them from — there is no collector endpoint, so `console`
 * is the collection mechanism and a `report-uri` here would point at nothing.
 *
 * Flip `CSP_ENFORCE=1` (Vercel) once a full browser run reports zero
 * violations. Nothing else changes: the same policy string is sent under the
 * enforcing header name.
 */
const ENFORCE_CSP = process.env.CSP_ENFORCE === '1';

/**
 * A fresh nonce per request. `crypto.randomUUID` is available on the edge
 * runtime and is the value Next's own documentation uses; predictability is the
 * only property that matters and 122 random bits is plenty.
 */
function newNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Which `/dashboard/{section}` a role may open.
 *
 * An admin may work a worker's round — the Go router says the same thing, with
 * WORKER|ADMIN|SUPER_ADMIN on every `/worker/*` route — so `admin` gets both.
 * Nobody else crosses.
 *
 * This is a redirect, not an authorisation check: the token's signature is not
 * verified here (the edge runtime has no secret) and it never needs to be,
 * because every request those screens make is checked again by the API with the
 * same token. What it prevents is a worker who bookmarks
 * `/dashboard/admin/settings` being handed an admin shell whose every fetch
 * 403s — which became worth preventing the day both dashboards started
 * rendering from the same components.
 */
const SECTIONS_BY_ROLE: Record<string, readonly string[]> = {
  MEMBER: ['member'],
  WORKER: ['worker'],
  ADMIN: ['admin', 'worker'],
  SUPER_ADMIN: ['admin', 'worker'],
};

/** The section a role lands on when it has no business where it was going. */
const HOME_SECTION: Record<string, string> = {
  MEMBER: 'member',
  WORKER: 'worker',
  ADMIN: 'admin',
  SUPER_ADMIN: 'admin',
};

/**
 * The prefix the default locale no longer has, permanently — WO-95.
 *
 * Every `/en/...` URL that is already indexed, bookmarked or linked from
 * elsewhere has to keep working, and has to *tell a crawler* that the
 * unprefixed form is the real one. next-intl's own `as-needed` redirect is a
 * **307**: correct for a browser, useless as a canonical signal, and reversible
 * in Google's model. So this runs first and answers **301**.
 *
 * 301 rather than 308 deliberately. These are GET pages; 308's method
 * preservation buys nothing here, and 301 is the status every crawler, cache and
 * ops tool understands without a second thought.
 */
function redirectDefaultLocalePrefix(request: NextRequest, pathname: string): Response | null {
  if (pathname !== `/${defaultLocale}` && !pathname.startsWith(`/${defaultLocale}/`)) {
    return null;
  }
  const url = new URL(request.url);
  url.pathname = pathWithoutLocale(pathname);
  return NextResponse.redirect(url, 301);
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const permanent = redirectDefaultLocalePrefix(request, pathname);
  if (permanent) return withCsp(request, permanent, pathname);

  // `/dashboard/...` (English, unprefixed) or `/bn/dashboard/...`. The old
  // `/^\/(en|bn)\/dashboard/` no longer matches the English form at all, which
  // would have left the whole gate off for every English visitor — the section
  // index moves with the prefix, so both are derived rather than counted.
  const withoutLocale = pathWithoutLocale(pathname);
  if (/^\/dashboard(\/|$)/.test(withoutLocale)) {
    const locale = localeFromPath(pathname);
    const token = request.cookies.get('hn_access_token')?.value;
    const isExpired = !token || isJwtExpired(token);

    if (isExpired) {
      const response = NextResponse.redirect(new URL(localePath(locale, '/login'), request.url));
      if (token) {
        response.cookies.set('hn_access_token', '', {
          path: '/',
          expires: new Date(0),
        });
      }
      return withCsp(request, response, pathname);
    }

    const section = withoutLocale.split('/')[2];
    const role = (parseJwtPayload<{ role?: string }>(token)?.role || '').toUpperCase();
    const allowed = SECTIONS_BY_ROLE[role];
    // An unrecognised role is left alone rather than redirected in a loop: the
    // API will refuse it anyway, and guessing a home for it would be a guess.
    if (allowed && section && !allowed.includes(section)) {
      const home = HOME_SECTION[role];
      const response = NextResponse.redirect(
        new URL(localePath(locale, `/dashboard/${home}`), request.url),
      );
      return withCsp(request, response, pathname);
    }
  }

  return withCsp(request, intlMiddleware(request), pathname);
}

/**
 * Attach the policy to a response, and — on the session routes — the nonce that
 * makes the strict form work.
 *
 * The `x-nonce` and `Content-Security-Policy` *request* headers are not
 * decoration. Next reads the CSP request header during server rendering,
 * extracts `'nonce-…'` from it, and stamps that nonce onto every script tag it
 * emits. Without them the strict policy would block Next's own bootstrap and
 * the page would render and then never hydrate — and because the response is
 * report-only until CSP_ENFORCE is set, that failure would appear only on the
 * day someone enabled enforcement.
 *
 * next-intl returns its own response, so the headers are set on whatever it
 * produced rather than on a fresh one; building a new NextResponse here would
 * drop the locale cookie and the rewrite it just decided on.
 */
/**
 * There is no `Vary: Accept-Language` here any more, and its absence is the
 * point — WO-95.
 *
 * It was added because next-intl read `Accept-Language` at `/` and emitted a
 * 307 with `cache-control: public` and no `Vary`, which let a shared cache hand
 * one visitor's language to the next. That was a real defect and the header was
 * the right fix *for that design*.
 *
 * The design is gone. `localeDetection: false` means neither the header nor the
 * `NEXT_LOCALE` cookie is consulted: the locale comes from the path prefix, and
 * from nothing else. `/` is English for everybody, `/bn` is Bengali for
 * everybody, and no response on this site varies with a request header.
 *
 * Declaring a `Vary` that is not true is not free. It splits the CDN cache on
 * the most-trafficked pages the site has — every distinct `Accept-Language`
 * string is its own cache entry — in exchange for a correctness property
 * nothing needs. The e2e spec asserts the negotiation is really gone, over
 * HTTP, because that is the only place a middleware header can be trusted.
 */

function withCsp(request: NextRequest, response: Response, pathname: string): Response {
  const isDev = process.env.NODE_ENV === 'development';
  // A redirect renders nothing, so there is no script tag for a nonce to be
  // stamped onto and no reason to mint one. It is also the only way to keep the
  // **status**: the nonce path re-issues the response through
  // `NextResponse.redirect(location)`, which defaults to 307 — so WO-95's
  // permanent redirect came back as temporary on exactly the session routes,
  // `/en/login` and `/en/register`. Those are the URLs most likely to be sitting
  // in somebody's bookmarks or in an old email.
  const isRedirect = response.headers.has('location');
  const session = !isRedirect && isSessionRoute(pathname);
  const nonce = session ? newNonce() : undefined;

  const policy = buildCsp({
    nonce,
    apiOrigin: process.env.NEXT_PUBLIC_API_URL,
    isDev,
    reportOnly: !ENFORCE_CSP,
  });

  const headerName = ENFORCE_CSP
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';

  if (!nonce) {
    response.headers.set(headerName, policy);
    return response;
  }

  // The nonce has to reach the renderer, which means re-issuing the response
  // with modified *request* headers. Anything the previous response already
  // decided — cookies, rewrites, redirects — is copied across.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const location = response.headers.get('location');
  const next = location
    ? NextResponse.redirect(new URL(location, request.url))
    : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'location') return;
    next.headers.set(key, value);
  });
  next.headers.set(headerName, policy);
  return next;
}

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
