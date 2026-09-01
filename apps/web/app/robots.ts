import type { MetadataRoute } from 'next';
import { locales } from '@/i18n';
import { getLocalizedPath, siteOrigin } from '@/lib/seo';

/**
 * The paths a crawler is asked not to *fetch*, in every locale.
 *
 * Derived rather than listed, since WO-95. The list used to be
 * `/en/dashboard/`, `/bn/dashboard/`, `/en/login`, … — two hand-written lines
 * per path — and English losing its prefix would have left every English one
 * naming a URL that no longer exists (`/en/login` 301s) while `/login` itself
 * went unlisted. `getLocalizedPath` is the same function the canonical tags and
 * the sitemap use, so the three cannot disagree about where a page lives.
 *
 * **The auth pages are deliberately not here any more.** They were, and they
 * also carry `noindex, nofollow` from `app/[locale]/(auth)/layout.tsx` — which
 * is the combination that does not work. `Disallow` forbids *fetching*, so a
 * crawler never reads the `noindex` it was sent to obey; and `/login` and
 * `/register` are linked from the header of every public page, so Bing follows
 * them, is refused, and files "Blocked by robots.txt" against a site that was
 * trying to say the opposite. Reported from Bing Webmaster Tools, 2026-09-02.
 *
 * `noindex` is also the stronger of the two: `Disallow` leaves a URL eligible
 * to be listed from inbound links with no description under it, whereas a page
 * a crawler is allowed to fetch and told not to index is removed outright.
 *
 * So what remains here is only what must never be fetched: `/api/`, which is
 * JSON and nothing links to, and `/dashboard/`, which needs a session and would
 * cost a crawler a redirect per URL to discover that.
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
