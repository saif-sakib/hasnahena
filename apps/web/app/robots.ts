import type { MetadataRoute } from 'next';
import { locales } from '@/i18n';
import { getLocalizedPath, siteOrigin } from '@/lib/seo';

/**
 * Paths a crawler must not FETCH, in every locale. Not the auth pages: they
 * carry noindex, and Disallow would stop crawlers reading it (Bing flagged
 * "Blocked by robots.txt"). Only /api/ and /dashboard/.
 */
const PRIVATE_PATHS = ['/dashboard/'];

export default function robots(): MetadataRoute.Robots {
  const disallow = [
    '/api/',
    ...locales.flatMap((locale) =>
      PRIVATE_PATHS.map((path) => {
        const localized = getLocalizedPath(locale, path.replace(/\/$/, ''));
        return path.endsWith('/') ? `${localized}/` : localized;
      }),
    ),
  ];

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow,
      },
    ],
    sitemap: `${siteOrigin}/sitemap.xml`,
    host: siteOrigin,
  };
}
