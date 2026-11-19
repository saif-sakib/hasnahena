import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locales, type Locale } from '@/i18n';
import { publicPagePaths, siteOrigin, SITE_DESCRIPTION, SITE_NAME_VARIANTS } from '@/lib/seo';
import { faqEntries } from '@/lib/faq';
import { ORG_SAME_AS } from '@/lib/contact-details';
import { StructuredData } from '@/components/seo/structured-data';
import {
  ORGANIZATION_ID,
  PUBLIC_PAGE_LABELS,
  WEBSITE_ID,
  organizationSchema,
  pageLabel,
  publicPageGraph,
  serializeJsonLd,
} from '@/lib/structured-data';

/** WO-79 — the site's JSON-LD. */

/** The `org.*` rows as a seeded database actually holds them. */
const SETTINGS: Record<string, string> = {
  'org.name': 'হাসনাহেনা ফাউন্ডেশন',
  'org.nameEn': 'Hasnahena Foundation',
  'org.address': 'Jashore Sadar, Jashore',
  'org.phone': '+8801700000000',
  'org.email': 'info@hasnahenafoundation.com',
  'org.regNumber': 'JES-1234',
  'org.description': 'An interest-free cooperative.',
};

const parse = (locale: Locale, path: string, settings = SETTINGS) => {
  const element = StructuredData({ locale, path, settings });
  const html = (element.props as { dangerouslySetInnerHTML: { __html: string } })
    .dangerouslySetInnerHTML.__html;
  return { html, json: JSON.parse(html) as { '@context': string; '@graph': Record<string, unknown>[] } };
};

const typesIn = (graph: Record<string, unknown>[]) => graph.map((node) => node['@type']);

describe('every public page emits parseable JSON-LD', () => {
  for (const path of publicPagePaths) {
    for (const locale of locales) {
      it(`${locale}${path}`, () => {
        const { json } = parse(locale, path);

        expect(json['@context']).toBe('https://schema.org');
        expect(Array.isArray(json['@graph'])).toBe(true);
        for (const node of json['@graph']) {
          expect(node['@type'], `a node on ${locale}${path} has no @type`).toBeTruthy();
        }
      });
    }
  }

  it('gives the FAQ page an FAQPage and no other page one', () => {
    expect(typesIn(parse('en', '/faq').json['@graph'])).toContain('FAQPage');
    for (const path of publicPagePaths.filter((p) => p !== '/faq')) {
      expect(typesIn(parse('en', path).json['@graph']), `${path}`).not.toContain('FAQPage');
    }
  });

  it('answers the FAQ in the same words the page shows', () => {
    // A rich result whose answer differs from the page is a policy violation,
    // not a typo — which is why lib/faq.ts is the single source for both.
    const faq = parse('bn', '/faq').json['@graph'].find((n) => n['@type'] === 'FAQPage');
    const questions = (faq?.mainEntity as { name: string; acceptedAnswer: { text: string } }[]) ?? [];

    expect(questions.map((q) => q.name)).toEqual(faqEntries('bn').map((e) => e.q));
    expect(questions.map((q) => q.acceptedAnswer.text)).toEqual(faqEntries('bn').map((e) => e.a));
  });

  it('breadcrumbs the homepage as one item and every other page as two', () => {
    const home = parse('en', '/').json['@graph'].find((n) => n['@type'] === 'BreadcrumbList');
    expect((home?.itemListElement as unknown[]).length).toBe(1);

    const about = parse('en', '/about').json['@graph'].find((n) => n['@type'] === 'BreadcrumbList');
    const items = about?.itemListElement as { name: string; item: string }[];
    expect(items).toHaveLength(2);
    // Canonical (unprefixed English) URLs.
    expect(items[1].item).toBe(`${siteOrigin}/about`);
    expect(items[1].name).toBe('About');
  });

  it('names every public path in both languages', () => {
    // Enumerated, so a new public page fails here rather than shipping a
    // breadcrumb labelled "Hasnahena".
    for (const path of publicPagePaths) {
      expect(PUBLIC_PAGE_LABELS[path], `no breadcrumb label for ${path}`).toBeDefined();
      for (const locale of locales) {
        expect(pageLabel(locale, path), `${locale} label for ${path}`).toBeTruthy();
      }
    }
  });
});

describe('the organisation is described from settings, never hardcoded', () => {
  /** Claims come from settings, never hardcoded. */
  it('carries the settings it was given', () => {
    const org = organizationSchema(SETTINGS);

    expect(org.name).toBe('Hasnahena Foundation');
    // Bengali name from settings; Latin variants from SITE_NAME_VARIANTS.
    expect(org.alternateName).toContain('হাসনাহেনা ফাউন্ডেশন');
    expect(org.alternateName).toEqual(expect.arrayContaining([...SITE_NAME_VARIANTS]));
    // `alternateName` means "also called". Repeating `name` inside it is noise.
    expect(org.alternateName).not.toContain(org.name);
    expect(org.description).toBe('An interest-free cooperative.');
    expect(org.identifier).toBe('JES-1234');
    expect((org.address as Record<string, string>).streetAddress).toBe('Jashore Sadar, Jashore');
    expect((org.contactPoint as Record<string, string>).telephone).toBe('+8801700000000');
    expect((org.contactPoint as Record<string, string>).email).toBe('info@hasnahenafoundation.com');
  });

  it('describes the foundation in English, falling back to Bengali only if it must', () => {
    // English description in the English node, never the Bengali box.
    const bengali = 'একটি কর্দ আল-হাসান সমবায় সংস্থা';
    const english = 'An interest-free cooperative finance society in Jashore.';

    // Both boxes filled: English wins, whichever locale the page is.
    expect(organizationSchema({ 'org.description': bengali, 'org.descriptionEn': english }).description)
      .toBe(english);

    // Only Bengali filled: still this foundation's own words.
    expect(organizationSchema({ 'org.description': bengali }).description).toBe(bengali);

    // Neither: the site's own copy, not an empty string.
    expect(organizationSchema({}).description).toBe(SITE_DESCRIPTION);
  });

  it('omits what it does not know instead of claiming an empty value', () => {
    // `"telephone": ""` is a worse claim than no claim, and an address node
    // holding nothing but its own @type is not an address.
    const org = organizationSchema({ 'org.nameEn': 'Hasnahena Foundation' });

    // No settings: the variants stay; no invented Bengali name.
    expect(org.alternateName).toEqual([...SITE_NAME_VARIANTS]);
    expect(org).not.toHaveProperty('identifier');
    expect(org).not.toHaveProperty('contactPoint.telephone');
    expect(JSON.stringify(org)).not.toContain('undefined');
    expect(JSON.stringify(org)).not.toContain('""');
  });

  it('treats a blank setting as absent, not as a value', () => {
    const org = organizationSchema({ ...SETTINGS, 'org.phone': '   ', 'org.regNumber': '' });

    expect(org).not.toHaveProperty('identifier');
    expect(org.contactPoint).not.toHaveProperty('telephone');
  });

  it('emits no `undefined` on any page, in either language, with an empty database', () => {
    // The state a fresh install is in, and the state the Docker build prerenders
    // in. See lib/system-config.ts.
    for (const path of publicPagePaths) {
      for (const locale of locales) {
        const { html } = parse(locale, path, {});
        expect(html, `${locale}${path} with no settings`).not.toContain('undefined');
        expect(() => JSON.parse(html)).not.toThrow();
      }
    }
  });
});

describe('the schema type does not misrepresent an interest-free cooperative', () => {
  /** Never a FinancialService-style type — they carry interestRate and fees (rule 3). */
  const FORBIDDEN_TYPES = ['FinancialService', 'BankOrCreditUnion', 'LoanOrCredit', 'Bank'];
  const FORBIDDEN_PROPERTIES = [
    'interestRate',
    'annualPercentageRate',
    'feesAndCommissionsSpecification',
    'loanTerm',
  ];

  it('describes the foundation as an NGO', () => {
    expect(organizationSchema(SETTINGS)['@type']).toBe('NGO');
  });

  it('names no type that implies interest or fees', () => {
    for (const path of publicPagePaths) {
      const { html } = parse('en', path);
      for (const type of FORBIDDEN_TYPES) {
        expect(html, `${path} declares ${type}`).not.toContain(`"${type}"`);
      }
    }
  });

  it('names no property that implies interest or fees', () => {
    for (const path of publicPagePaths) {
      const { html } = parse('en', path);
      for (const property of FORBIDDEN_PROPERTIES) {
        expect(html, `${path} emits ${property}`).not.toContain(`"${property}"`);
      }
    }
  });
});

describe('the payload cannot break out of its own script tag', () => {
  it('escapes `<` so an admin cannot close the element', () => {
    const html = serializeJsonLd(
      publicPageGraph({
        settings: { ...SETTINGS, 'org.nameEn': '</script><img src=x onerror=alert(1)>' },
        locale: 'en',
        path: '/',
        label: 'Home',
      }),
    );

    expect(html).not.toContain('</script>');
    expect(html).toContain('\\u003c/script');
    // Still valid JSON — escaping must not corrupt the payload it protects.
    expect(() => JSON.parse(html)).not.toThrow();
  });

  it('escapes it in the component too, not only when called directly', () => {
    const { html } = parse('en', '/', { ...SETTINGS, 'org.name': '</script>' });
    expect(html).not.toContain('</script>');
  });
});

describe('every public page actually renders it', () => {
  /** Every public page actually renders the structured data. */
  const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
  const pageFile = (path: string) =>
    path === '/' ? 'app/[locale]/page.tsx' : `app/[locale]${path}/page.tsx`;

  for (const path of publicPagePaths) {
    it(`${pageFile(path)} renders <StructuredData>`, () => {
      const source = readFileSync(resolve(WEB_ROOT, pageFile(path)), 'utf8');

      expect(source, 'no <StructuredData> on this page').toContain('<StructuredData');
      expect(source, `renders a different path than ${path}`).toContain(`path="${path}"`);
    });
  }
});

describe('rich organization, page-specific, and FAQ structured data', () => {
  it('enriches organizationSchema with sameAs, areaServed, knowsAbout, slogan, and E.164 phone normalization', () => {
    const org = organizationSchema({ ...SETTINGS, 'org.phone': '01786101204' });

    expect(org.sameAs).toEqual([...ORG_SAME_AS]);
    expect(org.slogan).toBeTruthy();
    expect(org.knowsAbout).toContain('Qard al-Hasan');
    expect(JSON.stringify(org.areaServed)).toContain('Jashore District');
    expect(JSON.stringify(org.areaServed)).toContain('Jessore');
    expect(org.telephone).toBe('+8801786101204');
    expect((org.contactPoint as Record<string, string>).telephone).toBe('+8801786101204');
  });

  it('emits semantic WebPage subtypes and DonateAction linked by @id', () => {
    const checkType = (path: string, expectedType: string) => {
      const graph = publicPageGraph({
        settings: SETTINGS,
        locale: 'en',
        path,
        label: pageLabel('en', path),
      });
      const pageNode = graph.find((node) => node['@type'] === expectedType);
      expect(pageNode, `${path} missing ${expectedType}`).toBeDefined();
      expect(pageNode?.isPartOf).toEqual({ '@id': WEBSITE_ID });
      expect(pageNode?.about).toEqual({ '@id': ORGANIZATION_ID });
      return pageNode;
    };

    expect(checkType('/', 'WebPage')?.mainEntity).toEqual({ '@id': ORGANIZATION_ID });
    expect(checkType('/about', 'AboutPage')?.mainEntity).toEqual({ '@id': ORGANIZATION_ID });
    expect(checkType('/contact', 'ContactPage')?.mainEntity).toEqual({ '@id': ORGANIZATION_ID });
    checkType('/activities', 'CollectionPage');
    checkType('/gallery', 'ImageGallery');
    const donateNode = checkType('/donate', 'WebPage');
    expect((donateNode?.potentialAction as Record<string, unknown>)?.['@type']).toBe('DonateAction');
  });

  it('emits Article + HowTo on Qard al-Hasan, ItemList on Activities, and ImageObjects on Gallery', () => {
    const qardGraph = publicPageGraph({
      settings: SETTINGS,
      locale: 'en',
      path: '/qard-al-hasan',
      label: pageLabel('en', '/qard-al-hasan'),
      article: {
        headline: 'What is Qard al-Hasan?',
        description: 'Interest-free loan guide',
      },
      howTo: {
        name: 'How to get Qard al-Hasan',
        description: 'Step by step process',
        steps: [
          { name: 'Become a member', text: 'Register online.' },
          { name: 'Build savings', text: 'Deposit regularly.' },
        ],
      },
    });
    expect(typesIn(qardGraph)).toContain('Article');
    expect(typesIn(qardGraph)).toContain('HowTo');

    const activitiesGraph = publicPageGraph({
      settings: SETTINGS,
      locale: 'en',
      path: '/activities',
      label: pageLabel('en', '/activities'),
      activityItems: [{ name: 'Interest-Free Finance', description: 'Zero-interest loans' }],
    });
    expect(typesIn(activitiesGraph)).toContain('ItemList');

    const galleryGraph = publicPageGraph({
      settings: SETTINGS,
      locale: 'en',
      path: '/gallery',
      label: pageLabel('en', '/gallery'),
      galleryItems: [
        {
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          caption: 'Health camp in Jashore',
          date: '2026-08-27T00:00:00.000Z',
        },
        {
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/sample2.jpg',
          caption: '',
        },
      ],
    });
    const galleryNode = galleryGraph.find((node) => node['@type'] === 'ImageGallery');
    const parts = galleryNode?.hasPart as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(2);
    expect(parts[0]['@type']).toBe('ImageObject');
    expect(parts[1]).not.toHaveProperty('caption');
  });

  it('publishes expanded bilingual FAQ entries and interpolates noticePeriodDays', () => {
    for (const locale of locales) {
      const entries = faqEntries(locale, 90);
      expect(entries.length).toBeGreaterThanOrEqual(10);
      expect(entries.some((e) => e.a.includes('90'))).toBe(true);
      expect(faqEntries(locale, 0).some((e) => e.a.includes('90'))).toBe(false);
    }
  });
});
