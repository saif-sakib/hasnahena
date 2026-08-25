import { getRequestConfig } from 'next-intl/server';

export const locales = ['en', 'bn'] as const;

/**
 * English — WO-94, and the owner's decision of 2026-08-24: *"You can keep the
 * en as default. Anyone can use bn if he wants. Also the primary language
 * should be en."*
 *
 * This one identifier decides more than it looks like: what `/` serves, the
 * `NEXT_LOCALE` cookie's default, `proxy.ts`'s fallback for a path with no
 * locale segment, next-intl's server fallback, and — since WO-95 — which locale
 * gets the **unprefixed** URLs.
 */
export const defaultLocale = 'en' as const;

/**
 * The default locale has no prefix: `/faq` is English, `/bn/faq` is Bengali.
 *
 * WO-95. `/` used to 307 to a negotiated locale, and a redirect at the root is
 * the reason Search Console reported *"Duplicate, Google chose different
 * canonical than user"* on `/bn` with a Google-selected canonical of `/`.
 * Google merges a redirecting root with whatever it lands on and keeps the
 * shorter URL, which is exactly what happened. Flipping `defaultLocale` alone
 * would have moved that report from `/bn` to `/en` rather than ending it —
 * Google's own guidance is against automatic language redirects for this
 * reason.
 *
 * So `/` is now a real, self-canonical English page. Nothing negotiates there.
 *
 * The prefix rule is **uniform**, dashboard included. Two rules — unprefixed
 * marketing pages beside a prefixed `/en/dashboard` — is the shape that drifts,
 * and every URL is built through `localePath()` anyway, which does not care
 * which kind of page it is being asked about. See [ADR-034](../../docs/decisions.md).
 */
export const localePrefix = 'as-needed' as const;

export type Locale = (typeof locales)[number];

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const finalLocale =
    requested && locales.includes(requested as Locale)
      ? (requested as Locale)
      : defaultLocale;

  return {
    locale: finalLocale,
    messages: (await import(`./messages/${finalLocale}.json`)).default,
  };
});
