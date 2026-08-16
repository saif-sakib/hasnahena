// next-intl still ships this under /middleware — that is its module path,
// unrelated to Next 16 renaming the file convention to proxy.ts.
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from './i18n';
import { isJwtExpired } from './lib/utils';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

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
