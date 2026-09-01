import type { Metadata } from 'next';
import { defaultLocale, locales, type Locale } from '@/i18n';
import { localePath } from '@/lib/locale-path';

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

export const SITE_NAME = 'Hasnahena Foundation';

/**
 * Search-engine ownership tokens, from the environment.
 *
 * Google finds this site on its own — the property is verified in Search
 * Console and `docs/go-live.md` has the sitemap step. **Bing does not.** It has
 * never been told the site exists: there is no Webmaster Tools property, so
 * nothing has submitted the sitemap, nothing can see the crawl, and a domain
 * with no inbound links waits months rather than weeks. "It does not rank on
 * Bing" and "Bing has not indexed it" look the same from a search box, and the
 * favicon follows the index — Bing shows the globe for a result it has not
 * fetched the icon for, however correct the `<link rel="icon">` is.
 *
 * Read from the environment rather than written here because the value is
 * issued by the tool to whoever proves they own the domain: it cannot be
 * guessed, and a wrong one is worse than none. Unset, the tag is simply absent,
 * which is exactly what shipped before this existed.
 *
 *   BING_SITE_VERIFICATION    Webmaster Tools → Add site → HTML meta tag,
 *                             the `content` of `msvalidate.01`. Not needed at
 *                             all if the property is imported from Search
 *                             Console, which verifies without a tag.
 *   GOOGLE_SITE_VERIFICATION  The equivalent, for a re-verification that cannot
 *                             use the existing DNS or file method.
 *
 * Both are server-side: they are printed into the HTML either way, but there is
 * no reason to inline them into the client bundle as well.
 */
export type SiteVerificationEnv = {
  BING_SITE_VERIFICATION?: string;
  GOOGLE_SITE_VERIFICATION?: string;
  // The index signature is what lets `process.env` be passed directly. Without
  // it TypeScript's weak-type check rejects the call: every named property here
  // is optional, `ProcessEnv` declares none of them, and a type with no overlap
  // is assumed to be a mistake rather than a subset. `SiteOriginEnv` above gets
  // away without one only because it happens to name `NODE_ENV`.
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
 * The other names people search for.
 *
 * The owner reports that "hasnahena foundation" ranks first, and that the
 * neighbouring spellings — hasnahena, hasanah foundation — are a crowded field.
 * These are published as `alternateName` on the Organization node so a crawler
 * can attach the variants to one entity instead of treating each as a different
 * organisation it has never heard of.
 *
 * The Bengali name is NOT in this list. It comes from `org.name`, which an admin
 * edits, and duplicating it here would be the second copy that goes stale.
 */
export const SITE_NAME_VARIANTS = [
  'Hasnahena',
  'Hasnahena Foundation Jashore',
  'Hasna Hena Foundation',
] as const;

export const SITE_DESCRIPTION =
  'Hasnahena Foundation is an interest-free (Qard al-Hasan) cooperative finance society in Jashore, Bangladesh. Members save together, borrow without interest, guarantee one another and give.';

/**
 * Icons, declared explicitly rather than by Next's `app/icon.*` file convention.
 *
 * **This is what was missing.** `public/favicon.ico` was served — a browser asks
 * for `/favicon.ico` by convention whether anything links to it or not — but no
 * `<link rel="icon">` appeared in the HTML, because Next only emits one for an
 * icon file inside `app/`. Google's favicon crawler reads the home page's `head`
 * and its documented requirement is a square that is a multiple of 48px; with no
 * declared icon it falls back to the generic globe, which is what the search
 * result showed.
 *
 * So: stable paths under `public/`, declared here, with `sizes` stated. Stable
 * matters — Google caches the favicon against its URL, and Next's `app/icon.png`
 * convention appends a content hash that moves whenever the file is edited.
 *
 * `apple-icon.png` is the one that is deliberately **not** transparent. iOS
 * composites a transparent touch icon onto black; the rest are transparent so
 * the tab shows the mark and not a white plate.
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

/**
 * The site's own title, in one place.
 *
 * It was written out three times — the root layout's `createLocalizedMetadata`
 * call, that same layout's `title.default`, and the home page's own
 * `generateMetadata`, which overrides both. They had already drifted: the two in
 * the layout said "Hasnahena Foundation" once `SITE_NAME` changed, while the
 * home page hardcoded the bare "Hasnahena" — and the home page is the one that
 * wins, so the single most-crawled `<title>` on the site did not contain the
 * word people search for.
 *
 * Jashore is in it deliberately. "Hasnahena" is a crowded name; the town is what
 * separates this foundation from the others.
 */
export function siteTitle(locale: Locale): string {
  return locale === 'bn'
    ? `${SITE_NAME_BN} — সুদমুক্ত সমবায় অর্থায়ন, যশোর`
    : `${SITE_NAME} — Interest-Free Cooperative Finance, Jashore`;
}

/**
 * The Bengali name, for the Bengali `<title>` only.
 *
 * Hardcoded here rather than read from `org.name`, unlike everywhere else, and
 * the reason is mechanical: `generateMetadata` for the root layout runs without
 * the settings map, and making it async to fetch one would opt every route out
 * of the prerendering WO-73 established. The organisation's *own* description of
 * itself still comes from `org.name` — that is what the JSON-LD publishes.
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

/**
 * The canonical path for a locale — WO-95.
 *
 * One line, and it delegates: `localePath` in `lib/locale-path.ts` is the same
 * answer the header's links, the login redirect and the language toggle need,
 * and two implementations of "where does this page live" is how a canonical URL
 * comes to disagree with the link that points at it.
 */
export function getLocalizedPath(locale: Locale, path = '/'): string {
  return localePath(locale, path);
}

export function getLocalizedUrl(locale: Locale, path = '/'): string {
  return `${siteOrigin}${getLocalizedPath(locale, path)}`;
}

/**
 * `hreflang` for both locales, plus `x-default`.
 *
 * WO-80. Without `x-default` a reader whose browser asks for neither English
 * nor Bengali — which is most of the crawl traffic that is not from Bangladesh —
 * has no declared entry point, and Google picks one. Pointing it at English
 * makes that choice ours — and since WO-95 that URL is `/`, not `/en`, which is
 * also the canonical of the home page. The three agree, which is the point:
 * `x-default`, the English `hreflang` and the canonical all naming the same URL
 * is what tells a crawler there is one home page rather than three.
 *
 * It is still written out rather than as `defaultLocale`, and the reason has
 * survived the two of them becoming equal (WO-94). They answer different
 * questions: `defaultLocale` is *what this site is primarily in*, `x-default` is
 * *what to serve someone the site was not built for*. They agree today because
 * both answers are English. Collapsing the line would make a future change to
 * one silently change the other, and the failure mode — every unmatched reader
 * in the world sent to a page they cannot read — is invisible from inside
 * Bangladesh.
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
    // On every page, not only the root layout. Google reads the favicon from
    // whichever page it crawled, and a site whose home page is `/bn` and whose
    // English entry point is `/en` has no single page it is guaranteed to see.
    icons: SITE_ICONS,
  };
}
