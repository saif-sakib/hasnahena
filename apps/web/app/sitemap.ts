import type { MetadataRoute } from 'next';
import { locales } from '@/i18n';
import { publicPagePaths, siteOrigin } from '@/lib/seo';

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

/**
 * WO-80. `lastModified` used to be `new Date()`, evaluated as the sitemap was
 * generated — so every URL claimed to have changed today, on every crawl,
 * forever. That is worse than omitting it: a crawler that learns the field is
 * always "now" stops believing it, and it is one of the few signals a small
 * site has for saying which pages actually moved.
 *
 * The honest values are the `updatedAt` of the `system_config` and `galleryItem`
 * rows each page renders from. This route is prerendered, and after the Docker
 * build broke on exactly that (see lib/system-config.ts) it is not worth adding
 * a second database read here to publish a date that changes when an admin edits
 * a phone number. Omitted is the truthful option, and it is what this does.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return publicPagePaths.flatMap((path) =>
    locales.map((locale) => ({
      url: `${siteOrigin}/${locale}${path === '/' ? '' : path}`,
      changeFrequency: getPathChangeFrequency(path),
      priority: getPathPriority(path),
    }))
  );
}
