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

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return publicPagePaths.flatMap((path) =>
    locales.map((locale) => ({
      url: `${siteOrigin}/${locale}${path === '/' ? '' : path}`,
      lastModified,
      changeFrequency: getPathChangeFrequency(path),
      priority: getPathPriority(path),
    }))
  );
}
