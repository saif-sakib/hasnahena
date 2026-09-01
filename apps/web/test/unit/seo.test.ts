import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import sitemap from '@/app/sitemap';
import manifest from '@/app/manifest';
import { locales } from '@/i18n';
import {
  createLocalizedMetadata,
  getLocalizedUrl,
  publicPagePaths,
  resolveSiteOrigin,
  siteOrigin,
  siteTitle,
  SITE_ICONS,
  SITE_NAME,
  siteVerification,
} from '@/lib/seo';

/**
 * WO-80 and WO-81 — three correctness defects in the SEO that already existed,
 * and the Open Graph properties that keep a shared link looking like the page it
 * points at.
 *
 * None of these is an enhancement. Each was emitting something specific and
 * wrong to every crawler that asked.
 */

describe('the site origin is resolved, never guessed', () => {
  /**
   * The old fallback was `https://hasnahena.org` — a domain this project does
   * not own. `siteOrigin` is the base of every canonical URL, every `hreflang`,
   * every Open Graph URL, the sitemap and `robots.txt`, so one build with
   * neither variable set told every crawler the real content lives elsewhere.
   */
  it('prefers NEXT_PUBLIC_SITE_URL', () => {
    expect(
      resolveSiteOrigin({
        NEXT_PUBLIC_SITE_URL: 'https://hasnahenafoundation.com',
        NEXT_PUBLIC_APP_URL: 'https://ignored.example',
      }),
    ).toBe('https://hasnahenafoundation.com');
  });

  it('falls back to NEXT_PUBLIC_APP_URL, the older name', () => {
    expect(
      resolveSiteOrigin({ NEXT_PUBLIC_APP_URL: 'https://hasnahenafoundation.com' }),
    ).toBe('https://hasnahenafoundation.com');
  });

  it('adds a scheme and strips a trailing slash', () => {
    expect(
      resolveSiteOrigin({ NEXT_PUBLIC_SITE_URL: 'hasnahenafoundation.com/' }),
    ).toBe('https://hasnahenafoundation.com');
  });

  it('gives a preview deploy its own hostname, not the production domain', () => {
    // A preview that claims the production canonical is asking to be indexed in
    // production's place.
    expect(
      resolveSiteOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'hasnahena-git-wip.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'hasnahenafoundation.com',
        NODE_ENV: 'production',
      }),
    ).toBe('https://hasnahena-git-wip.vercel.app');
  });

  it('uses the stable production domain on a Vercel production build', () => {
    expect(
      resolveSiteOrigin({
        VERCEL_ENV: 'production',
        VERCEL_URL: 'hasnahena-abc123.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'hasnahenafoundation.com',
        NODE_ENV: 'production',
      }),
    ).toBe('https://hasnahenafoundation.com');
  });

  it('needs no configuration outside a production build', () => {
    expect(resolveSiteOrigin({ NODE_ENV: 'development' })).toBe(
      'http://localhost:3000',
    );
    expect(resolveSiteOrigin({ NODE_ENV: 'test' })).toBe(
      'http://localhost:3000',
    );
  });

  it('throws on a production build with nothing set, rather than inventing a domain', () => {
    // A build that fails is a thirty-second fix. A build that succeeds against
    // the wrong origin is found weeks later in Search Console.
    expect(() => resolveSiteOrigin({ NODE_ENV: 'production' })).toThrow(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });

  it('never resolves to a domain the foundation does not own', () => {
    expect(siteOrigin).not.toContain('hasnahena.org');
  });
});

describe('hreflang', () => {
  it('declares x-default, so a reader in neither language is not left to chance', () => {
    const metadata = createLocalizedMetadata({ locale: 'en', path: '/about' });
    const languages = metadata.alternates?.languages ?? {};

    expect(Object.keys(languages).sort()).toEqual(['bn', 'en', 'x-default']);
    expect(languages['x-default']).toBe(getLocalizedUrl('en', '/about'));
  });

  it('points x-default at the same path, not at the homepage', () => {
    for (const path of publicPagePaths) {
      const languages = createLocalizedMetadata({ locale: 'bn', path }).alternates?.languages ?? {};
      expect(languages['x-default'], `x-default on ${path}`).toBe(getLocalizedUrl('en', path));
    }
  });
});

describe('the sitemap tells the truth about when a page changed', () => {
  /**
   * `lastModified: new Date()` made every URL claim to have changed today, on
   * every crawl, forever. A crawler that learns the field is always "now" stops
   * believing it — which costs the signal for the pages that really did change.
   */
  it('claims no modification date it cannot support', () => {
    for (const entry of sitemap()) {
      expect(entry.lastModified, `${entry.url} claims a lastModified`).toBeUndefined();
    }
  });

  it('produces byte-identical output for unchanged content', () => {
    expect(JSON.stringify(sitemap())).toBe(JSON.stringify(sitemap()));
  });

  it('lists every public path in every locale', () => {
    expect(sitemap()).toHaveLength(publicPagePaths.length * locales.length);
  });
});

describe('the social card survives being shared', () => {
  it('gives every public page an absolute Open Graph image', () => {
    for (const path of publicPagePaths) {
      for (const locale of locales) {
        const images = createLocalizedMetadata({ locale, path }).openGraph?.images;
        const url = Array.isArray(images)
          ? (images[0] as { url: string }).url
          : (images as { url: string } | undefined)?.url;

        expect(url, `openGraph image on ${locale}${path}`).toMatch(/^https?:\/\//);
      }
    }
  });

  it('gives every public page an absolute Twitter image and a large card', () => {
    for (const path of publicPagePaths) {
      const twitter = createLocalizedMetadata({ locale: 'en', path }).twitter as
        | { card?: string; images?: string[] }
        | undefined;

      expect(twitter?.card).toBe('summary_large_image');
      expect(twitter?.images?.[0], `twitter image on ${path}`).toMatch(/^https?:\/\//);
    }
  });

  it('tags the card with its own locale and names the other one', () => {
    const en = createLocalizedMetadata({ locale: 'en', path: '/donate' }).openGraph as
      | { locale?: string; alternateLocale?: string[] }
      | undefined;
    const bn = createLocalizedMetadata({ locale: 'bn', path: '/donate' }).openGraph as
      | { locale?: string; alternateLocale?: string[] }
      | undefined;

    expect(en?.locale).toBe('en_US');
    expect(en?.alternateLocale).toEqual(['bn_BD']);
    expect(bn?.locale).toBe('bn_BD');
    expect(bn?.alternateLocale).toEqual(['en_US']);
  });

  it('canonicalises to the locale it was rendered for', () => {
    for (const locale of locales) {
      for (const path of publicPagePaths) {
        const canonical = createLocalizedMetadata({ locale, path }).alternates?.canonical;
        expect(canonical, `canonical on ${locale}${path}`).toBe(getLocalizedUrl(locale, path));
      }
    }
  });
});


// ---------------------------------------------------------------------------
// The favicon, and the name a crawler reads
// ---------------------------------------------------------------------------

/**
 * Reported by the owner: searching "hasnahena foundation" returns this site
 * first, with the generic globe where the logo should be.
 *
 * The cause was not the icon file. `public/favicon.ico` was served — a browser
 * requests `/favicon.ico` by convention whether anything links to it or not —
 * but **no `<link rel="icon">` reached the HTML**, because Next only emits one
 * for an icon inside `app/`. Google's favicon crawler reads the page's `head`,
 * so it found nothing and fell back to the globe.
 *
 * These assertions are about the declaration rather than the pixels. The pixels
 * were the other half of the report ("there is white background") and are a
 * property of the file, which no unit test can usefully read.
 */
describe('the site declares a favicon a crawler can find', () => {
  const icons = SITE_ICONS.icon as Array<{ url: string; sizes?: string }>;

  it('every public page carries the icons, not just the root layout', () => {
    // Google reads the favicon from whichever page it crawled, and this site's
    // entry points are /en and /bn — there is no single page it must see.
    for (const locale of locales) {
      for (const path of publicPagePaths) {
        expect(
          createLocalizedMetadata({ locale, path }).icons,
          `icons on ${locale}${path}`,
        ).toBe(SITE_ICONS);
      }
    }
  });

  it('offers a square that is a multiple of 48px', () => {
    // Google's documented requirement. 48 is inside favicon.ico; 192 is 48x4.
    const declared = icons.flatMap((icon) => (icon.sizes ?? '').split(/\s+/)).filter(Boolean);
    const multiplesOf48 = declared.filter((size) => {
      const [w, h] = size.split('x').map(Number);
      return w === h && w % 48 === 0;
    });
    expect(multiplesOf48.length, `declared sizes: ${declared.join(', ')}`).toBeGreaterThan(0);
  });

  it('uses stable paths, not content-hashed ones', () => {
    // Google caches the favicon against its URL. Next's `app/icon.png`
    // convention appends a hash that moves whenever the file is edited, which
    // is why these live in `public/` and are declared by hand.
    for (const icon of [...icons, ...(SITE_ICONS.apple as Array<{ url: string }>)]) {
      expect(icon.url, `${icon.url} must be a stable absolute path`).toMatch(/^\/[\w.-]+$/);
    }
  });
});

describe('the site is named the same everywhere a crawler looks', () => {
  /**
   * The `<title>` existed three times: the root layout's metadata call, that
   * same layout's `title.default`, and the home page's own `generateMetadata`,
   * which overrides both. They drifted — the layout said "Hasnahena Foundation"
   * while the home page said "Hasnahena", and the home page is the one that
   * wins. `siteTitle()` is the single copy; this refuses a fourth.
   */
  const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');

  function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
      }
    };
    for (const root of ['app', 'components', 'lib']) walk(join(WEB_ROOT, root));
    return out;
  }

  it('the title names the foundation, not the bare word', () => {
    for (const locale of locales) {
      expect(siteTitle(locale).length, `${locale} title`).toBeGreaterThan(10);
    }
    // "Hasnahena" alone is a crowded name; "Foundation" is the half that ranks.
    expect(siteTitle('en')).toContain(SITE_NAME);
    expect(SITE_NAME).toBe('Hasnahena Foundation');
  });

  it('no page writes its own "Hasnahena — …" title string', () => {
    // Title-shaped: a string that STARTS with the site name and carries a
    // spaced separator. Two narrowings, both learned from false positives —
    // a census that cries wolf gets deleted rather than obeyed:
    //
    //   - anchored at the opening quote, so body copy is out ("Learn about
    //     Hasnahena's mission", "interest-free microfinance");
    //   - not preceded by `=`, so a JSX attribute is out. The logo's `alt` is
    //     the site's name with a dash in it and is not a page title.
    const pattern = /(.?)(['"`])\s*(?:Hasnahena|হাসনাহেনা)[\w\s'’]*\s[-—]\s[^'"`\n]{6,}\2/g;
    const hardcodesATitle = (text: string) =>
      [...text.matchAll(pattern)].some((m) => m[1] !== '=');

    const offenders = sourceFiles()
      .filter((file) => !file.endsWith(join('lib', 'seo.ts')))
      .filter((file) => hardcodesATitle(readFileSync(file, 'utf8')))
      .map((file) => relative(WEB_ROOT, file));

    expect(
      offenders,
      'these files hardcode a site title. Call siteTitle(locale) instead — the ' +
        'home page overrides the layout, so a copy here silently becomes the ' +
        'title every crawler reads.',
    ).toEqual([]);
  });
});

describe('the web app manifest', () => {
  const m = manifest();

  it('names the foundation, so it is one more crawlable statement of the name', () => {
    expect(m.name).toBe(SITE_NAME);
  });

  it('stays in the browser rather than hiding the address bar', () => {
    // This is a money application. A member typing a password should be able to
    // see which origin they are typing it into.
    expect(m.display).toBe('browser');
  });

  it('ships a maskable icon, or Android draws its own white plate behind it', () => {
    const purposes = (m.icons ?? []).map((icon) => icon.purpose);
    expect(purposes).toContain('maskable');
  });
});

describe('search-engine ownership tokens', () => {
  /**
   * Bing was never told this site exists — no Webmaster Tools property, so no
   * submitted sitemap and no view of the crawl. The tag is how the property is
   * claimed when the Search Console import is not used.
   */
  it('emits msvalidate.01 for Bing when the token is set', () => {
    expect(siteVerification({ BING_SITE_VERIFICATION: 'ABC123' })).toEqual({
      other: { 'msvalidate.01': 'ABC123' },
    });
  });

  it('emits both when both are set', () => {
    expect(
      siteVerification({ BING_SITE_VERIFICATION: 'ABC123', GOOGLE_SITE_VERIFICATION: 'g-tok' }),
    ).toEqual({ google: 'g-tok', other: { 'msvalidate.01': 'ABC123' } });
  });

  /**
   * Undefined rather than an empty object, and it matters: `verification: {}`
   * is what Next is handed, and an empty `other` is a shape it has no reason to
   * keep behaving well on. Unset must produce exactly the HTML that shipped
   * before the field existed.
   */
  it('is absent when neither is set, and when either is blank', () => {
    expect(siteVerification({})).toBeUndefined();
    expect(siteVerification({ BING_SITE_VERIFICATION: '   ' })).toBeUndefined();
  });
});

describe('the IndexNow key', () => {
  const publicDir = resolve(new URL('.', import.meta.url).pathname, '..', '..', 'public');
  const keyFiles = readdirSync(publicDir).filter((name) => /^[0-9a-f]{8,128}\.txt$/.test(name));

  /**
   * IndexNow authenticates by asking the site to serve its own key: the file
   * must be reachable at `/<key>.txt` and contain the key. A second key file
   * means the submit script cannot tell which one the crawler was told about,
   * and a mismatch between name and contents is a bare 403 that explains
   * nothing. scripts/indexnow-submit.mjs reads the key from the filename, so
   * these two facts are the whole protocol.
   */
  it('is exactly one file in public/', () => {
    expect(keyFiles).toHaveLength(1);
  });

  it('contains the key that names it', () => {
    const [file] = keyFiles;
    expect(readFileSync(join(publicDir, file), 'utf8').trim()).toBe(file.replace(/\.txt$/, ''));
  });
});
