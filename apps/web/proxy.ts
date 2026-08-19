// next-intl still ships this under /middleware — that is its module path,
// unrelated to Next 16 renaming the file convention to proxy.ts.
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from './i18n';
import { buildCsp, isSessionRoute } from './lib/csp';
import { isJwtExpired } from './lib/utils';

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
