import { describe, it, expect } from 'vitest';
import sitemap from '@/app/sitemap';
import { locales } from '@/i18n';
import {
  createLocalizedMetadata,
  getLocalizedUrl,
  publicPagePaths,
  resolveSiteOrigin,
  siteOrigin,
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
