// next-intl's module path is still /middleware (Next 16 renamed the file to proxy.ts).
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
  // WO-95: `/` is English, not a negotiated redirect. The locale comes from the
  // path only; a reader who wants Bengali picks it.
  localeDetection: false,
});

/**
 * WO-76: report-only by default — the Playwright spec reads violations from the
 * console (no collector). Set CSP_ENFORCE=1 on Vercel once a full run is clean.
 */
const ENFORCE_CSP = process.env.CSP_ENFORCE === '1';

/** A fresh nonce per request (122 random bits). */
function newNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Which /dashboard/{section} a role may open (admin gets both). A redirect,
 * not authorisation — the API re-checks every request; this just avoids an
 * admin shell whose every fetch 403s.
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
 * 301 from `/en/...` to the unprefixed form (WO-95), before next-intl — whose
 * own as-needed redirect is a 307, useless as a canonical signal.
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

  // `/dashboard/...` or `/bn/dashboard/...` — derived, not counted.
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
    // An unknown role is left alone (no redirect loop); the API refuses it.
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
 * Attach the CSP (and on session routes the nonce, via the x-nonce and CSP
 * REQUEST headers Next reads to stamp its scripts) to next-intl's own response,
 * keeping its cookie and rewrite. No `Vary: Accept-Language` — nothing varies
 * by header since WO-95, and a false Vary splits the CDN cache.
 */

function withCsp(request: NextRequest, response: Response, pathname: string): Response {
  const isDev = process.env.NODE_ENV === 'development';
  // A redirect needs no nonce, and re-issuing it would turn a 301 into a 307.
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

  // Re-issue with modified request headers, copying cookies, rewrites, redirects.
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
