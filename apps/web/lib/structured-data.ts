/**
 * JSON-LD for the public site (WO-79). Type is NGO, never FinancialService —
 * those carry interestRate and fee properties (rule 3). Every claim comes from
 * system_config; an empty value is omitted, never emitted blank.
 */

import { defaultLocale, locales, type Locale } from '@/i18n';
import {
  getLocalizedUrl,
  siteOrigin,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_NAME_VARIANTS,
} from '@/lib/seo';
import type { FaqEntry } from '@/lib/faq';
import { localizedSettingPair, orgAddress, orgDescription } from '@/lib/localized-settings';

/** A JSON-LD node. Deliberately loose — the shape is schema.org's, not ours. */
export type JsonLdNode = Record<string, unknown>;

type Settings = Record<string, string>;

/** The site-wide node ids, so `@graph` members can reference each other. */
export const ORGANIZATION_ID = `${siteOrigin}/#organization`;
export const WEBSITE_ID = `${siteOrigin}/#website`;

/** Drops keys whose value is absent or blank, at any depth. */
function compact(node: JsonLdNode): JsonLdNode {
  const out: JsonLdNode = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === 'object') {
      const nested = compact(value as JsonLdNode);
      // A PostalAddress holding nothing but its own @type is not an address.
      if (Object.keys(nested).filter((k) => k !== '@type').length === 0) continue;
      out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

const trimmed = (settings: Settings, key: string): string | undefined => {
  const value = settings[key]?.trim();
  return value ? value : undefined;
};

/** The foundation itself. English name; the Bengali one goes in alternateName. */
export function organizationSchema(settings: Settings): JsonLdNode {
  // English halves, falling back to Bengali: this node is always English.
  const streetAddress = orgAddress(settings, 'en') || undefined;
  const description = orgDescription(settings, 'en') || SITE_DESCRIPTION;

  // Every searched-for name, deduplicated, minus `name`. Via
  // localizedSettingPair so localized-settings.test.ts sees the read.
  const names = localizedSettingPair(settings, 'org.name');
  const primaryName = names.en || SITE_NAME;
  const alternateNames = [
    ...new Set([names.bn, ...SITE_NAME_VARIANTS]),
  ].filter((name): name is string => Boolean(name) && name !== primaryName);

  return compact({
    '@type': 'NGO',
    '@id': ORGANIZATION_ID,
    name: primaryName,
    alternateName: alternateNames,
    description,
    url: siteOrigin,
    // Square mark with dimensions: knowledge panels crop to a square.
    logo: {
      '@type': 'ImageObject',
      url: `${siteOrigin}/images/logo/logo-mark-square.png`,
      width: 496,
      height: 496,
      caption: primaryName,
    },
    // Same wide lockup as the Open Graph card.
    image: `${siteOrigin}/images/logo/logo-og.png`,
    // Locality/region/country are fixed facts, not settings.
    address: {
      '@type': 'PostalAddress',
      streetAddress,
      addressLocality: 'Jashore',
      addressRegion: 'Khulna',
      addressCountry: 'BD',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      telephone: trimmed(settings, 'org.phone'),
      email: trimmed(settings, 'org.email'),
      availableLanguage: ['en', 'bn'],
    },
    // The registration number — the strongest trust signal.
    identifier: trimmed(settings, 'org.regNumber'),
  });
}

/** The site, in both languages, published by the organisation above. */
export function webSiteSchema(): JsonLdNode {
  return compact({
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: siteOrigin,
    name: SITE_NAME,
    alternateName: [...SITE_NAME_VARIANTS],
    description: SITE_DESCRIPTION,
    publisher: { '@id': ORGANIZATION_ID },
    inLanguage: [...locales],
  });
}

/** `Home › About`. One helper rather than ten hand-written lists. */
export function breadcrumbSchema(locale: Locale, path: string, label: string): JsonLdNode {
  const home = {
    '@type': 'ListItem',
    position: 1,
    name: locale === 'bn' ? 'হোম' : 'Home',
    item: getLocalizedUrl(locale, '/'),
  };

  if (path === '/') {
    return { '@type': 'BreadcrumbList', itemListElement: [home] };
  }

  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      home,
      { '@type': 'ListItem', position: 2, name: label, item: getLocalizedUrl(locale, path) },
    ],
  };
}

/** The questions already on `/faq`, in the same words the page shows. */
export function faqSchema(entries: readonly FaqEntry[]): JsonLdNode {
  return {
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.q,
      acceptedAnswer: { '@type': 'Answer', text: entry.a },
    })),
  };
}

export type PageGraphInput = {
  settings: Settings;
  locale: Locale;
  /** One of `publicPagePaths`. */
  path: string;
  /** The page's own name, for the breadcrumb. */
  label: string;
  /** Only `/faq` passes these. */
  faq?: readonly FaqEntry[];
};

/** Everything one public page declares, as a single `@graph` linked by `@id`. */
export function publicPageGraph({ settings, locale, path, label, faq }: PageGraphInput): JsonLdNode[] {
  const graph: JsonLdNode[] = [
    organizationSchema(settings),
    webSiteSchema(),
    breadcrumbSchema(locale, path, label),
  ];
  if (faq?.length) graph.push(faqSchema(faq));
  return graph;
}

/**
 * Serialise a graph for a JSON-LD script body, escaping `<` so an admin-typed
 * `</script>` stays inert. Done here, the only producer of the string.
 */
export function serializeJsonLd(graph: JsonLdNode[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
    /</g,
    '\\u003c',
  );
}

/**
 * Breadcrumb labels for the public paths. Here, not in messages, because the
 * builders are plain functions; structured-data.test.ts checks both languages.
 */
export const PUBLIC_PAGE_LABELS: Record<string, Record<Locale, string>> = {
  '/': { en: 'Home', bn: 'হোম' },
  '/about': { en: 'About', bn: 'পরিচিতি' },
  '/activities': { en: 'Activities', bn: 'কার্যক্রম' },
  '/contact': { en: 'Contact', bn: 'যোগাযোগ' },
  '/donate': { en: 'Donate', bn: 'দান করুন' },
  '/gallery': { en: 'Gallery', bn: 'গ্যালারি' },
  '/privacy': { en: 'Privacy Policy', bn: 'গোপনীয়তা নীতি' },
  '/terms': { en: 'Terms of Service', bn: 'ব্যবহারের শর্তাবলী' },
  '/faq': { en: 'Frequently Asked Questions', bn: 'সাধারণ প্রশ্নাবলী' },
  '/support': { en: 'Support', bn: 'সহায়তা' },
};

export function pageLabel(locale: Locale, path: string): string {
  const labels = PUBLIC_PAGE_LABELS[path];
  if (!labels) {
    // Not reachable from a page in `publicPagePaths`; the test enumerates them.
    return SITE_NAME;
  }
  return labels[locale] ?? labels[defaultLocale];
}
