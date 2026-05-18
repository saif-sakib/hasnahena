import type { Metadata } from 'next';
import { defaultLocale, locales, type Locale } from '@/i18n';

const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim()
  || process.env.NEXT_PUBLIC_APP_URL?.trim()
  || 'https://hasnahena.org';

export const siteOrigin = rawSiteUrl.startsWith('http')
  ? rawSiteUrl.replace(/\/+$/, '')
  : `https://${rawSiteUrl.replace(/\/+$/, '')}`;
export const siteBaseUrl = new URL(siteOrigin);

export const SITE_NAME = 'Hasnahena';
export const SITE_DESCRIPTION =
  'Join our Qard al-Hasan community for ethical, Sharia-compliant loans with zero interest. A community-driven cooperative finance platform.';

export const publicPagePaths = [
  '/',
  '/about',
  '/activities',
  '/contact',
  '/donate',
  '/gallery',
  '/privacy',
  '/terms',
  '/faq',
  '/support',
] as const;

const localeToOpenGraphLocale: Record<Locale, string> = {
  en: 'en_US',
  bn: 'bn_BD',
};

export function normalizeLocale(locale: string): Locale {
  return locales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}

function normalizePath(path: string): string {
  if (!path || path === '/') return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

export function getLocalizedPath(locale: Locale, path = '/'): string {
  const normalizedPath = normalizePath(path);
  return `/${locale}${normalizedPath === '/' ? '' : normalizedPath}`;
}

export function getLocalizedUrl(locale: Locale, path = '/'): string {
  return `${siteOrigin}${getLocalizedPath(locale, path)}`;
}

function getLanguageAlternates(path: string): Record<string, string> {
  return locales.reduce<Record<string, string>>((acc, locale) => {
    acc[locale] = getLocalizedUrl(locale, path);
    return acc;
  }, {});
}

interface CreateLocalizedMetadataInput {
  locale: string;
  path?: string;
  title?: string;
  description?: string;
  noIndex?: boolean;
}

export function createLocalizedMetadata({
  locale,
  path = '/',
  title,
  description = SITE_DESCRIPTION,
  noIndex = false,
}: CreateLocalizedMetadataInput): Metadata {
  const resolvedLocale = normalizeLocale(locale);
  const canonicalUrl = getLocalizedUrl(resolvedLocale, path);
  const resolvedTitle = title || SITE_NAME;

  return {
    title: resolvedTitle,
    description,
    alternates: {
      canonical: canonicalUrl,
      languages: getLanguageAlternates(path),
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          nocache: true,
          googleBot: {
            index: false,
            follow: false,
            noimageindex: true,
          },
        }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
            'max-video-preview': -1,
          },
        },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title: resolvedTitle,
      description,
      url: canonicalUrl,
      locale: localeToOpenGraphLocale[resolvedLocale],
      images: [
        {
          url: `${siteOrigin}/images/logo.png`,
          width: 512,
          height: 512,
          alt: SITE_NAME,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: resolvedTitle,
      description,
      images: [`${siteOrigin}/images/logo.png`],
    },
  };
}
