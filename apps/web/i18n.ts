import { getRequestConfig } from 'next-intl/server';

export const locales = ['en', 'bn'] as const;
export const defaultLocale = 'bn' as const;

export type Locale = (typeof locales)[number];

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale;
  
  // Ensure the locale is valid
  const finalLocale = locale && locales.includes(locale as Locale) ? locale : defaultLocale;
  
  return {
    locale: finalLocale,
    messages: (await import(`./messages/${finalLocale}.json`)).default,
  };
});
