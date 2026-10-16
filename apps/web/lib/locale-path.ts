import { defaultLocale, locales, type Locale } from '@/i18n';

/**
 * Every internal URL, in one function (WO-95): English unprefixed (`/faq`),
 * Bengali `/bn/faq`. Hand-built `/${locale}/…` links 301. Its own module so
 * client components can import it without lib/seo.ts.
 */

/** `/faq` for the default locale, `/bn/faq` for anything else. */
export function localePath(locale: string, path = '/'): string {
  const normalizedPath = !path || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  const resolved = (locales as readonly string[]).includes(locale) ? locale : defaultLocale;
  if (resolved === defaultLocale) return normalizedPath || '/';
  return `/${resolved}${normalizedPath}`;
}

/**
 * The current path without its locale segment, for the language toggle
 * (preserves dashboard ids; a naive replace would match `/enrolment`).
 */
export function pathWithoutLocale(pathname: string): string {
  const segments = pathname.split('/');
  if ((locales as readonly string[]).includes(segments[1])) {
    const rest = segments.slice(2).join('/');
    return rest ? `/${rest}` : '/';
  }
  return pathname || '/';
}

/** Which locale a pathname is already in. */
export function localeFromPath(pathname: string): Locale {
  const segment = pathname.split('/')[1];
  return (locales as readonly string[]).includes(segment) ? (segment as Locale) : defaultLocale;
}

/** `/bn/faq` ⇄ `/faq`, keeping the reader where they were. */
export function switchLocalePath(pathname: string, target: string): string {
  return localePath(target, pathWithoutLocale(pathname));
}

/**
 * The language a reader can switch to. Named, because the inline EN/BN ternary
 * is the shape messages.test.ts forbids for copy.
 */
export function otherLocale(locale: string): Locale {
  return locale === 'bn' ? 'en' : 'bn';
}
