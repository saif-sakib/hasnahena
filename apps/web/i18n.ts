import { getRequestConfig } from 'next-intl/server';

export const locales = ['en', 'bn'] as const;

/** English is the default (WO-94, owner's decision) and gets the unprefixed URLs. */
export const defaultLocale = 'en' as const;

/**
 * The default locale has no prefix: `/faq` English, `/bn/faq` Bengali — for
 * every page, dashboard included (WO-95, ADR-034). `/` is a real English page,
 * never a language redirect.
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
