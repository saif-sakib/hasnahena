import type { Metadata } from 'next';
import { defaultLocale, locales, type Locale } from '@/i18n';
import { localePath } from '@/lib/locale-path';

/**
 * Where this site lives (WO-80). Resolution: NEXT_PUBLIC_SITE_URL, then
 * NEXT_PUBLIC_APP_URL, then Vercel's VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL
 * (a preview must not claim the production canonical), then localhost outside
 * production. A production build with none of them THROWS.
 */
export type SiteOriginEnv = {
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  NODE_ENV?: string;
};

export function resolveSiteOrigin(env: SiteOriginEnv = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return withScheme(explicit);

  // Vercel sets these itself; neither is ever present anywhere else.
  const vercel =
    env.VERCEL_ENV === 'production'
      ? env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || env.VERCEL_URL?.trim()
      : env.VERCEL_URL?.trim();
  if (vercel) return withScheme(vercel);

  if (env.NODE_ENV !== 'production') return 'http://localhost:3000';

  throw new Error(
    'NEXT_PUBLIC_SITE_URL is not set. It is the base of every canonical URL, ' +
      'hreflang, Open Graph URL, the sitemap and robots.txt, so a production ' +
      'build without it would publish links to the wrong origin. Set it to ' +
      'https://hasnahenafoundation.com in the Vercel project settings.',
  );
}

function withScheme(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
}

export const siteOrigin = resolveSiteOrigin();
export const siteBaseUrl = new URL(siteOrigin);

export const SITE_NAME = 'Hasnahena Foundation';

/**
 * Search-engine ownership tokens; unset means no tag.
 *   BING_SITE_VERIFICATION    Webmaster Tools → HTML meta tag `msvalidate.01`
 *                             (not needed if imported from Search Console)
 *   GOOGLE_SITE_VERIFICATION  only for a re-verification without DNS/file
 */
export type SiteVerificationEnv = {
  BING_SITE_VERIFICATION?: string;
  GOOGLE_SITE_VERIFICATION?: string;
  // Lets `process.env` be passed directly (TS weak-type check).
  [key: string]: string | undefined;
};

export function siteVerification(
  env: SiteVerificationEnv = process.env,
): Metadata['verification'] | undefined {
  const bing = env.BING_SITE_VERIFICATION?.trim();
  const google = env.GOOGLE_SITE_VERIFICATION?.trim();
  if (!bing && !google) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { 'msvalidate.01': bing } } : {}),
  };
}

/**
 * Alternate spellings, published as `alternateName` so crawlers merge them into
 * one entity. The Bengali name comes from `org.name`, not from here.
 */
export const SITE_NAME_VARIANTS = [
  'Hasnahena',
  'Hasnahena Foundation Jashore',
  'Hasna Hena Foundation',
] as const;

export const SITE_DESCRIPTION =
  'Hasnahena Foundation is an interest-free (Qard al-Hasan) cooperative finance society in Jashore, Bangladesh. Members save together, borrow without interest, guarantee one another and give.';

/**
 * Icons declared explicitly at stable public/ paths (Google caches the favicon
 * by URL; the app/icon convention hashes it). Only apple-icon is opaque — iOS
 * composites transparency onto black.
 */
export const SITE_ICONS = {
  icon: [
    { url: '/favicon.ico', sizes: '16x16 32x32 48x48 64x64 128x128 256x256', rel: 'icon' },
    { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
  ],
  shortcut: ['/favicon.ico'],
  apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
} satisfies Metadata['icons'];

/** The site's title, in one place. Jashore is in it to separate it from other "Hasnahena"s. */
export function siteTitle(locale: Locale): string {
  return locale === 'bn'
    ? `${SITE_NAME_BN} — সুদমুক্ত সমবায় অর্থায়ন, যশোর`
    : `${SITE_NAME} — Interest-Free Cooperative Finance, Jashore`;
}

/**
 * The Bengali name for the Bengali `<title>`. Hardcoded: the root layout's
 * metadata has no settings map, and fetching one would break prerendering.
 */
const SITE_NAME_BN = 'হাসনাহেনা ফাউন্ডেশন';

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

/** The canonical path for a locale — delegates to localePath (WO-95). */
export function getLocalizedPath(locale: Locale, path = '/'): string {
  return localePath(locale, path);
}

export function getLocalizedUrl(locale: Locale, path = '/'): string {
  return `${siteOrigin}${getLocalizedPath(locale, path)}`;
}

/**
 * `hreflang` for both locales plus `x-default` (WO-80). x-default is spelled
 * out rather than tied to defaultLocale: they answer different questions and
 * only happen to agree.
 */
const X_DEFAULT_LOCALE: Locale = 'en';

function getLanguageAlternates(path: string): Record<string, string> {
  const alternates = locales.reduce<Record<string, string>>((acc, locale) => {
    acc[locale] = getLocalizedUrl(locale, path);
    return acc;
  }, {});
  alternates['x-default'] = getLocalizedUrl(X_DEFAULT_LOCALE, path);
  return alternates;
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
      // alternateLocale points readers at the other language (WO-81).
      locale: localeToOpenGraphLocale[resolvedLocale],
      alternateLocale: locales
        .filter((locale) => locale !== resolvedLocale)
        .map((locale) => localeToOpenGraphLocale[locale]),
      // Absolute always — clients drop a relative OG image (seo.test.ts).
      images: [
        {
          url: `${siteOrigin}/images/logo/logo-og.png`,
          width: 1200,
          height: 630,
          alt: SITE_NAME,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: resolvedTitle,
      description,
      images: [`${siteOrigin}/images/logo/logo-og.png`],
    },
    // On every page: Google reads the favicon from whichever page it crawled.
    icons: SITE_ICONS,
  };
}
