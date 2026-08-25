import type { MetadataRoute } from 'next';
import { locales } from '@/i18n';
import { getLocalizedPath, siteOrigin } from '@/lib/seo';

/**
 * The paths a crawler is asked not to index, in every locale.
 *
 * Derived rather than listed, since WO-95. The list used to be
 * `/en/dashboard/`, `/bn/dashboard/`, `/en/login`, … — two hand-written lines
 * per path — and English losing its prefix would have left every English one
 * naming a URL that no longer exists (`/en/login` 301s) while `/login` itself
 * went unlisted. `getLocalizedPath` is the same function the canonical tags and
 * the sitemap use, so the three cannot disagree about where a page lives.
 */
const PRIVATE_PATHS = [
  '/dashboard/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
];

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
