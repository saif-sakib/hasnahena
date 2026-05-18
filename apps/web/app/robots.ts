import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/en/dashboard/',
          '/bn/dashboard/',
          '/en/login',
          '/bn/login',
          '/en/register',
          '/bn/register',
          '/en/forgot-password',
          '/bn/forgot-password',
          '/en/reset-password',
          '/bn/reset-password',
        ],
      },
    ],
    sitemap: `${siteOrigin}/sitemap.xml`,
    host: siteOrigin,
  };
}
