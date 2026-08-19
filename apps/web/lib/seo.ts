import type { Metadata } from 'next';
import { defaultLocale, locales, type Locale } from '@/i18n';

/**
 * Where this site lives, according to the environment it is being built for.
 *
 * WO-80. The previous fallback was `https://hasnahena.org` — a domain this
 * project does not own. It was not merely cosmetic: `siteOrigin` is the base of
 * every canonical URL, every `hreflang`, every Open Graph URL, the sitemap and
 * `robots.txt`. One build with neither variable set and the whole site tells
 * every crawler that the real content is somewhere else.
 *
 * So there is no fallback to a domain any more. The order of resolution is:
 *
 *   1. `NEXT_PUBLIC_SITE_URL` — what production should set, explicitly.
 *   2. `NEXT_PUBLIC_APP_URL` — the older name, still read so an environment
 *      that only has this one keeps working.
 *   3. Vercel's own variables. `VERCEL_PROJECT_PRODUCTION_URL` is the stable
 *      production domain; `VERCEL_URL` is this deployment's own hostname, which
 *      is the *correct* answer for a preview — a preview that claims the
 *      production canonical is asking to be indexed in its place.
 *   4. Anything that is not a production build gets localhost, so `next dev`,
 *      vitest and the Playwright stack need no configuration.
 *   5. A production build with none of the above **throws**. A build that fails
 *      is a thirty-second fix; a build that succeeds with the wrong origin is
 *      discovered weeks later in Search Console.
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

/**
 * `hreflang` for both locales, plus `x-default`.
 *
 * WO-80. Without `x-default` a reader whose browser asks for neither English
 * nor Bengali — which is most of the crawl traffic that is not from Bangladesh —
 * has no declared entry point, and Google picks one. Pointing it at `/en` makes
 * that choice ours.
 *
 * `/en` and **not** `defaultLocale`, which is `bn`. The site's default is
 * Bengali because its members are; `x-default` is the opposite question — what
 * to serve someone the site was not built for — and for that English is the
 * answer. Writing `defaultLocale` here reads as the tidier version of the same
 * line and sends every unmatched reader in the world to a page they cannot
 * read, so it is spelled out.
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
      // WO-81. `locale` alone tells a social client what language this card is
      // in; `alternateLocale` tells it the same page exists in the other one, so
      // a Bengali reader shown the English card can be sent to the Bengali page.
      locale: localeToOpenGraphLocale[resolvedLocale],
      alternateLocale: locales
        .filter((locale) => locale !== resolvedLocale)
        .map((locale) => localeToOpenGraphLocale[locale]),
      // Absolute, always. A relative OG image is silently dropped by every
      // social client — no error, no fallback, just a card with no picture —
      // and `metadataBase` only rescues the URLs Next resolves itself.
      // `seo.test.ts` asserts it for every page in `publicPagePaths`.
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
  };
}
