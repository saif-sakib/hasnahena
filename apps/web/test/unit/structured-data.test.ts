import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locales, type Locale } from '@/i18n';
import { publicPagePaths, siteOrigin, SITE_NAME_VARIANTS } from '@/lib/seo';
import { faqEntries } from '@/lib/faq';
import { StructuredData } from '@/components/seo/structured-data';
import {
  PUBLIC_PAGE_LABELS,
  organizationSchema,
  pageLabel,
  publicPageGraph,
  serializeJsonLd,
} from '@/lib/structured-data';

/**
 * WO-79 — the structured data the site had none of.
 *
 * `grep -r "application/ld+json"` returned nothing before this order. These
 * tests exist for three separate failure modes, and the third is the one that
 * matters most to this project.
 */

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
    // `/about`, not `/en/about` — English lost its prefix in WO-95, and a
    // breadcrumb pointing at a URL that 301s elsewhere is a breadcrumb a
    // crawler discards.
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
  /**
   * The point of WO-79 that is easy to get wrong: an admin edits `org.*` on the
   * settings screen, and a value hardcoded here would be the second copy —
   * WO-67's failure, except quieter, because nobody reads the JSON-LD to notice
   * it has gone stale.
   */
  it('carries the settings it was given', () => {
    const org = organizationSchema(SETTINGS);

    expect(org.name).toBe('Hasnahena Foundation');
    // The Bengali name comes from the settings; the Latin-script variants are
    // SITE_NAME_VARIANTS, so a crawler attaches "hasna hena foundation" to this
    // entity rather than to an organisation it has never heard of.
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

  it('omits what it does not know instead of claiming an empty value', () => {
    // `"telephone": ""` is a worse claim than no claim, and an address node
    // holding nothing but its own @type is not an address.
    const org = organizationSchema({ 'org.nameEn': 'Hasnahena Foundation' });

    // `alternateName` survives with no settings at all — SITE_NAME_VARIANTS is
    // a fact about how people search, not a value an admin supplies. What must
    // not survive is the Bengali name nobody set.
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
  /**
   * Rule 3 is not only about the code. `FinancialService` and
   * `BankOrCreditUnion` are the types a search engine would suggest for
   * something that lends money, and both carry `interestRate`,
   * `annualPercentageRate` and `feesAndCommissionsSpecification`. Publishing one
   * of them describes this foundation, in the one place a machine reads, as
   * something that charges interest. `NGO` extends `Organization` and is honest.
   */
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
  /**
   * The builders above can be perfect and emit nothing, because nothing calls
   * them. This walks the ten paths in `publicPagePaths` to the page file that
   * serves each one and reads it — the same enumerating shape as
   * `routes.contract.test.ts`, so adding an eleventh public page fails here
   * until it is wired up.
   */
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
