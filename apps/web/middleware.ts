import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from './i18n';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const dashboardPrefix = /^\/(en|bn)\/dashboard(\/|$)/;
  if (dashboardPrefix.test(pathname)) {
    const token = request.cookies.get('hn_access_token')?.value;
    const tokenParts = token?.split('.') ?? [];
    let isExpired = false;
    if (tokenParts.length === 3) {
      try {
        const payloadSegment = tokenParts[1];
        const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const payload = JSON.parse(atob(padded)) as { exp?: number };
        if (typeof payload.exp === 'number') {
          const now = Math.floor(Date.now() / 1000);
          isExpired = payload.exp <= now;
        }
      } catch {
        isExpired = true;
      }
    } else if (token) {
      isExpired = true;
    }

    if (!token || isExpired) {
      const locale = pathname.split('/')[1] || defaultLocale;
      const response = NextResponse.redirect(new URL(`/${locale}/login`, request.url));
      if (token) {
        response.cookies.set('hn_access_token', '', {
          path: '/',
          expires: new Date(0),
        });
      }
      return response;
    }
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
