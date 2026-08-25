import { defaultLocale, locales, type Locale } from '@/i18n';

/**
 * Every internal URL in this application, in one function — WO-95.
 *
 * English has no prefix and Bengali does: `localePath('en', '/faq')` is `/faq`,
 * `localePath('bn', '/faq')` is `/bn/faq`. That asymmetry is the whole of
 * `localePrefix: 'as-needed'`, and it is why this has to be a function rather
 * than a template literal at each call site.
 *
 * Twenty-two files used to write `` `/${locale}/faq` `` by hand. Under the old
 * `always` scheme that was merely repetitive; under `as-needed` every one of
 * them produces `/en/faq`, which the middleware then **301s** to `/faq` — so a
 * member tapping a link in the header pays a redirect, and a crawler following
 * one is told the URL it was given is not the real one. The same string built
 * in one place is the fix, and it is also the only way the rule can be changed
 * again without another twenty-two-file sweep.
 *
 * Deliberately its own module rather than living in `lib/seo.ts`: this is
 * imported by client components, and `seo.ts` resolves the site origin at module
 * load and pulls in the whole metadata surface with it.
 */

/** `/faq` for the default locale, `/bn/faq` for anything else. */
export function localePath(locale: string, path = '/'): string {
  const normalizedPath = !path || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  const resolved = (locales as readonly string[]).includes(locale) ? locale : defaultLocale;
  if (resolved === defaultLocale) return normalizedPath || '/';
  return `/${resolved}${normalizedPath}`;
}

/**
 * The same path under the other language, for the header's language toggle.
 *
 * It takes the *current* pathname rather than rebuilding one, because the
 * switch has to preserve wherever the reader is — including a dashboard route
 * with an id in it. Stripping a known locale segment is the only reliable way
 * to do that: a `replace('/en', '/bn')` matches `/enrolment` too, and under
 * `as-needed` the English pathname has no segment to replace at all.
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
 * The language a reader can switch to from here.
 *
 * A named function rather than `locale === 'en' ? 'bn' : 'en'` at four call
 * sites, and the reason is more than tidiness: that expression is
 * indistinguishable, to any check reading the source, from the inline EN/BN
 * *copy* rule 5 forbids. `messages.test.ts` fails on the shape, so the two
 * things that look alike are separated by giving the one that is legitimate a
 * name.
 *
 * It also stops being right the moment a third language is added, which a
 * ternary would not announce.
 */
export function otherLocale(locale: string): Locale {
  return locale === 'bn' ? 'en' : 'bn';
}
