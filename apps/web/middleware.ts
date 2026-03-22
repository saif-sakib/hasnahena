import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from './i18n';

export default createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

export const config = {
  matcher: [
    // Match root
    '/',
    // Match locale prefixed paths
    '/(bn|en)/:path*',
    // Match all paths except static files and API
    '/((?!api|_next|_vercel|favicon\\.ico|images|.*\\..*).*)',
  ],
};
