import type { MetadataRoute } from 'next';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo';

/**
 * The web app manifest.
 *
 * Two reasons it exists, neither of them "make this installable":
 *
 *  - **The icon a phone shows.** A member who adds the dashboard to their home
 *    screen gets the maskable mark rather than a screenshot of the page. Both
 *    entries point at the same square PNG; `purpose: 'maskable'` tells Android
 *    it may crop to whatever shape the launcher uses, which is safe because the
 *    mark is centred with margin around it.
 *  - **It is a crawlable statement of the site's name.** `name` and
 *    `short_name` are one more place a search engine can attach "Hasnahena
 *    Foundation" to this origin.
 *
 * `display: 'browser'`, deliberately. A standalone window hides the address bar,
 * and this is a money application where a member should be able to see the
 * origin they are typing a password into.
 *
 * No `start_url` locale, and since WO-95 that is the *canonical* URL rather than
 * a redirect: `/` is the English home page ([ADR-034](../../../docs/decisions.md)).
 * A Bengali reader installs from `/bn` and gets `/bn` in their own manifest
 * scope; hardcoding either here would decide for everybody.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: 'Hasnahena',
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#059669',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
