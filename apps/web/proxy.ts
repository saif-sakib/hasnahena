// next-intl still ships this under /middleware — that is its module path,
// unrelated to Next 16 renaming the file convention to proxy.ts.
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from './i18n';
import { buildCsp, isSessionRoute } from './lib/csp';
import { isJwtExpired, parseJwtPayload } from './lib/utils';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
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

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const dashboardPrefix = /^\/(en|bn)\/dashboard(\/|$)/;
  if (dashboardPrefix.test(pathname)) {
    const token = request.cookies.get('hn_access_token')?.value;
    const isExpired = !token || isJwtExpired(token);

    if (isExpired) {
      const locale = pathname.split('/')[1] || defaultLocale;
      const response = NextResponse.redirect(new URL(`/${locale}/login`, request.url));
      if (token) {
        response.cookies.set('hn_access_token', '', {
          path: '/',
          expires: new Date(0),
        });
      }
      return withCsp(request, response, pathname);
    }

    const locale = pathname.split('/')[1] || defaultLocale;
    const section = pathname.split('/')[3];
    const role = (parseJwtPayload<{ role?: string }>(token)?.role || '').toUpperCase();
    const allowed = SECTIONS_BY_ROLE[role];
    // An unrecognised role is left alone rather than redirected in a loop: the
    // API will refuse it anyway, and guessing a home for it would be a guess.
    if (allowed && section && !allowed.includes(section)) {
      const home = HOME_SECTION[role];
      const response = NextResponse.redirect(new URL(`/${locale}/dashboard/${home}`, request.url));
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
 * Declare that a locale-negotiated response depends on `Accept-Language`.
 *
 * next-intl's middleware reads `Accept-Language` to decide where `/` sends a
 * visitor — `/bn` for a Bengali browser, `/en` for an English one — and emits a
 * 307 with `cache-control: public` and **no `Vary`**. That combination is a
 * cache-poisoning bug in the ordinary sense of the word: a shared cache is
 * entitled to serve the redirect it stored for one visitor to the next, so a
 * Bengali speaker can be sent to `/en` because an English speaker asked first.
 * Cloudflare sits in front of this site, which makes the shared cache real
 * rather than theoretical.
 *
 * `must-revalidate` limits the blast radius today; it does not make the header
 * correct, and the response is `public`.
 *
 * It is also what tells a crawler that `/` is a negotiated entry point rather
 * than a fixed alias of whichever locale it happened to receive. That is the
 * honest description of what `/` is, and it is the reverse of the claim an
 * un-Varied redirect makes.
 *
 * Applied to every response rather than only to redirects: next-intl also
 * *rewrites* on the locale it detected, and a rewritten page body depends on
 * the same header.
 */
function varyOnLanguage(response: Response): void {
  const existing = response.headers.get('vary');
  if (existing?.toLowerCase().split(',').some((part) => part.trim() === 'accept-language')) {
    return;
  }
  response.headers.set('vary', existing ? `${existing}, Accept-Language` : 'Accept-Language');
}

function withCsp(request: NextRequest, response: Response, pathname: string): Response {
  const isDev = process.env.NODE_ENV === 'development';
  const session = isSessionRoute(pathname);
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
    varyOnLanguage(response);
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
  varyOnLanguage(next);
  return next;
}

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
