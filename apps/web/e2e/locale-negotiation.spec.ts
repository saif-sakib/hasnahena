import { test, expect } from '@playwright/test';

/**
 * WO-95: `/` is an English page — no negotiation, no redirect, and no Vary
 * header (a root redirect made Google pick `/` as /bn's canonical). Over HTTP,
 * because Next can replace what proxy.ts sets (traps.md § Locale routing).
 */
test.describe('the root path is English, not a negotiation', () => {
  test('serves English at / whatever language the browser asks for', async ({ request }) => {
    for (const acceptLanguage of ['en-US,en;q=0.9', 'bn-BD,bn;q=0.9', 'fr-FR,fr;q=0.9']) {
      const response = await request.get('/', {
        headers: { 'Accept-Language': acceptLanguage },
        maxRedirects: 0,
      });

      expect(
        response.status(),
        `Accept-Language: ${acceptLanguage} — the root must render, not redirect. ` +
          'A redirecting root is what Search Console reported as a duplicate canonical.',
      ).toBe(200);
      expect(await response.text()).toContain('lang="en"');
    }
  });

  test('does not claim to vary on a header it no longer reads', async ({ request }) => {
    // No Vary: the path prefix is the only input.
    const response = await request.get('/', {
      headers: { 'Accept-Language': 'bn-BD,bn;q=0.9' },
      maxRedirects: 0,
    });
    const vary = (response.headers()['vary'] ?? '').toLowerCase();
    expect(
      vary,
      `/ sent Vary: "${vary}". Nothing about this response depends on Accept-Language.`,
    ).not.toContain('accept-language');
  });

  test('serves Bengali at /bn for every visitor', async ({ request }) => {
    const response = await request.get('/bn', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    expect(response.status()).toBe(200);
    expect(await response.text(), '/bn must serve Bengali whatever the browser asks for')
      .toContain('lang="bn"');
  });
});

test.describe('the /en prefix is gone, permanently', () => {
  // Possibly indexed or bookmarked URLs. /login and /register take the session
  // branch through withCsp, which once turned the 301 into a 307.
  const paths = ['', '/about', '/faq', '/donate', '/gallery', '/login', '/register'];

  for (const path of paths) {
    test(`/en${path || ''} → 301 → ${path || '/'}`, async ({ request }) => {
      const response = await request.get(`/en${path}`, { maxRedirects: 0 });

      expect(
        response.status(),
        'A 307 here is correct for a browser and useless as a canonical signal: ' +
          'Google treats a temporary redirect as reversible and may keep indexing ' +
          'the old URL. It has to be permanent.',
      ).toBe(301);

      const location = response.headers()['location'] ?? '';
      expect(new URL(location, 'http://localhost').pathname).toBe(path || '/');
    });
  }

  test('the redirect survives a query string', async ({ request }) => {
    const response = await request.get('/en/faq?from=search', { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    const location = new URL(response.headers()['location'] ?? '', 'http://localhost');
    expect(location.pathname).toBe('/faq');
    expect(location.search).toBe('?from=search');
  });

  test('a Bengali URL is not redirected anywhere', async ({ request }) => {
    // The other half of the rule. Only the *default* locale loses its prefix.
    const response = await request.get('/bn/faq', { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  });
});

test.describe('the pages point at their own URLs', () => {
  /** Link paths (not origins). Next emits `hrefLang` with a capital L. */
  function linkPaths(body: string, rel: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const tag of body.match(new RegExp(`<link[^>]*rel="${rel}"[^>]*>`, 'g')) ?? []) {
      const href = tag.match(/href="([^"]*)"/)?.[1];
      if (!href) continue;
      const key = tag.match(/hrefLang="([^"]*)"/i)?.[1] ?? rel;
      out[key] = new URL(href, 'http://placeholder').pathname;
    }
    return out;
  }

  test('the canonical of / is / and its hreflang names both locales', async ({ request }) => {
    const body = await (await request.get('/')).text();

    // A canonical pointing at `/en` would re-create by hand the duplicate the
    // redirect used to create by accident.
    expect(linkPaths(body, 'canonical')['canonical']).toBe('/');

    const alternates = linkPaths(body, 'alternate');
    expect(alternates['en']).toBe('/');
    expect(alternates['bn']).toBe('/bn');
    expect(alternates['x-default'], 'x-default is the answer for a reader the site was not built for')
      .toBe('/');
  });

  test('a Bengali page is self-canonical and points back at the unprefixed English', async ({ request }) => {
    const body = await (await request.get('/bn/faq')).text();
    expect(linkPaths(body, 'canonical')['canonical']).toBe('/bn/faq');

    const alternates = linkPaths(body, 'alternate');
    expect(alternates['en']).toBe('/faq');
    expect(alternates['bn']).toBe('/bn/faq');
  });

  test('robots.txt disallows the private paths in both locales', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    // Derived per locale.
    for (const path of ['/dashboard/']) {
      expect(body, `robots.txt does not disallow ${path}`).toContain(`Disallow: ${path}`);
      expect(body, `robots.txt does not disallow /bn${path}`).toContain(`Disallow: /bn${path}`);
    }
    expect(body, 'robots.txt does not disallow /api/').toContain('Disallow: /api/');
    expect(body, 'robots.txt still names URLs that redirect').not.toContain('Disallow: /en');
  });

  test('robots.txt does not disallow the auth pages, which carry noindex instead', async ({
    request,
  }) => {
    // Auth pages are NOT disallowed: Disallow would stop crawlers reading their noindex.
    const body = await (await request.get('/robots.txt')).text();
    for (const path of ['/login', '/register', '/forgot-password', '/reset-password']) {
      expect(body, `robots.txt disallows ${path}, so its noindex is unreadable`).not.toContain(
        `Disallow: ${path}`,
      );
      expect(body, `robots.txt disallows /bn${path}`).not.toContain(`Disallow: /bn${path}`);
    }

    // The other half: refusing to disallow them is only correct while they say
    // noindex themselves.
    for (const path of ['/login', '/register']) {
      const html = await (await request.get(path)).text();
      expect(html, `${path} does not send noindex`).toMatch(/name="robots"[^>]*noindex/);
    }
  });

  test('the sitemap lists no /en URL', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text();
    expect(body).toContain('/bn');
    expect(
      body,
      'A sitemap listing URLs that redirect elsewhere is a sitemap asking to be ignored.',
    ).not.toMatch(/<loc>[^<]*\/en(\/|<)/);
  });
});
