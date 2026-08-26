/**
 * JSON-LD for the public site — WO-79.
 *
 * `grep -r "application/ld+json"` returned nothing before this. For a registered
 * foundation with a physical address, structured data is the difference between
 * a plain text result and one carrying the organisation's name, logo, address
 * and contact point, so this was the largest single SEO gap.
 *
 * ── Two decisions worth keeping ──────────────────────────────────────────────
 *
 * **The type is `NGO`, never `FinancialService` or `BankOrCreditUnion`.** Those
 * are the types a search engine would suggest for something that lends money,
 * and both carry `feesAndCommissionsSpecification`, `interestRate` and
 * `annualPercentageRate`. This platform charges none of them — that is rule 3,
 * and it is a Shariah requirement rather than a pricing choice. Publishing a
 * type whose vocabulary assumes interest misrepresents the foundation in the one
 * place a machine reads it. `NGO` extends `Organization` and is honest.
 *
 * **Every claim comes from `system_config`.** The admin already edits `org.*` on
 * the settings screen, and a hardcoded address here would be the second copy —
 * the exact failure WO-67 exists to fix, except worse, because nobody reads the
 * JSON-LD to notice it has gone stale. A setting with no value is *omitted*
 * rather than emitted empty: `"telephone": ""` is a worse claim than no claim.
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

/**
 * The foundation itself.
 *
 * `name` is the English name and `alternateName` the Bengali one, in both
 * locales. Mixed-script structured data is more likely to be discarded than to
 * help, and the English name is the one that matches the domain and the
 * letterhead on every generated document.
 */
export function organizationSchema(settings: Settings): JsonLdNode {
  // English, like `name` below and like every generated document: this node is
  // read by crawlers and assistants worldwide, not by one locale's readers.
  //
  // Both of these take the English half of a pair and fall back to the Bengali
  // one. `description` did NOT until 2026-08-25: it read the single
  // `org.description` box, which the foundation had filled in in Bengali, so
  // this node described itself in Bengali on the English page and on the
  // Bengali one — the only untranslated value in a node whose whole contract is
  // that it is English.
  const streetAddress = orgAddress(settings, 'en') || undefined;
  const description = orgDescription(settings, 'en') || SITE_DESCRIPTION;

  // Every name this organisation is searched under, deduplicated and with the
  // primary name removed — `alternateName` means "also called", so repeating
  // `name` inside it is noise. The Bengali name comes from `org.name`, which an
  // admin edits; the Latin-script variants are SITE_NAME_VARIANTS.
  //
  // Through `localizedSettingPair`, like the letterhead: this is the second of
  // the two callers that genuinely want both halves rather than the reader's
  // one, and routing it through the module is what keeps
  // `localized-settings.test.ts` able to see every read of a prose key.
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
    // An ImageObject rather than a bare URL string. Google's logo guidance asks
    // for width and height, and the square mark rather than the wide lockup:
    // a knowledge-panel logo is cropped to a square, and cropping the lockup
    // cuts the wordmark in half.
    logo: {
      '@type': 'ImageObject',
      url: `${siteOrigin}/images/logo/logo-mark-square.png`,
      width: 496,
      height: 496,
      caption: primaryName,
    },
    // The image a crawler shows beside the result, which is the wide lockup —
    // the same asset the Open Graph card uses, so the two agree.
    image: `${siteOrigin}/images/logo/logo-og.png`,
    // The locality, region and country are facts about where the foundation is
    // registered, not settings — there is no admin control for them and there
    // should not be, because moving would be a governance event rather than an
    // edit. `streetAddress` is the English half of the address pair, falling
    // back to `org.address` when nobody has filled the English box in.
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
    // The registration number is what distinguishes this from any other
    // organisation with a similar name, and it is the strongest trust signal a
    // small foundation has.
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

/**
 * Everything one public page should declare, as a single `@graph`.
 *
 * A graph rather than several separate `<script>` blocks so the nodes can
 * reference each other by `@id` — the WebSite names its publisher, and every
 * page then carries one description of the organisation instead of a slightly
 * different one per page.
 */
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
 * Serialise a graph for a `<script type="application/ld+json">` body.
 *
 * The `<` escape is not decoration. `JSON.stringify` will happily emit
 * `</script>` from a setting an admin typed, which closes the element early and
 * turns the rest of the payload into markup — the one XSS sink structured data
 * has. Next's own JSON-LD guide names this escape for this reason. It is
 * applied here, in the only function that produces the string, rather than at
 * the call site where it can be forgotten.
 */
export function serializeJsonLd(graph: JsonLdNode[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
    /</g,
    '\\u003c',
  );
}

/**
 * Breadcrumb labels for the ten public paths.
 *
 * Here rather than in `messages/{en,bn}.json` because the builders above are
 * plain functions: reading a translation needs next-intl's request context, and
 * threading that through would make every schema an async server call for four
 * words. `structured-data.test.ts` enumerates `publicPagePaths` and fails if a
 * path is missing a label in either language, which is the property the messages
 * suite would have given.
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
