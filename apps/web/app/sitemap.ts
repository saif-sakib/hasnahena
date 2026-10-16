import type { MetadataRoute } from 'next';
import { locales } from '@/i18n';
import { getLocalizedPath, publicPagePaths, siteOrigin } from '@/lib/seo';

function getPathPriority(path: string): number {
  if (path === '/') return 1;
  if (path === '/donate') return 0.9;
  if (path === '/about' || path === '/activities' || path === '/contact') return 0.8;
  return 0.7;
}

function getPathChangeFrequency(path: string): MetadataRoute.Sitemap[number]['changeFrequency'] {
  if (path === '/') return 'daily';
  if (path === '/gallery') return 'weekly';
  return 'monthly';
}

/** No lastModified (WO-80): a fake "today" is worse than none, and a real one needs a DB read. */
export default function sitemap(): MetadataRoute.Sitemap {
  return publicPagePaths.flatMap((path) =>
    locales.map((locale) => ({
      // Canonical URLs (English unprefixed), as the canonical tags build them.
      url: `${siteOrigin}${getLocalizedPath(locale, path)}`,
      changeFrequency: getPathChangeFrequency(path),
      priority: getPathPriority(path),
    }))
  );
}
