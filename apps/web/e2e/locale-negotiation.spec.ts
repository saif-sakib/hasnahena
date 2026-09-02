import { test, expect } from '@playwright/test';

/**
 * `/` is an English page. It does not negotiate, and it does not redirect.
 *
 * WO-95. It used to do both: next-intl read `Accept-Language` and 307'd to
 * `/en` or `/bn`. Two things were wrong with that, and only the smaller one was
 * obvious.
 *
 * The obvious one was caching — the redirect was `cache-control: public` with no
 * `Vary`, so a shared cache could hand one visitor's language to the next.
 * Cloudflare sits in front of this site, which made that real. It was fixed with
 * a `Vary` header, and that fix is now **deleted**, because nothing negotiates
 * any more: a `Vary` that is not true splits the CDN cache on the busiest pages
 * the site has in exchange for nothing.
 *
 * The larger one was that a redirect at the root is what produced *"Duplicate,
 * Google chose different canonical than user"* on `/bn`, with a Google-selected
 * canonical of `https://hasnahenafoundation.com/`. Google merges a redirecting
 * root with whatever it lands on and keeps the shorter URL. Flipping the default
 * locale (WO-94) would have moved that report from `/bn` to `/en` and left the
 * cause in place; Google's own guidance is against automatic language redirects
 * for exactly this reason.
 *
 * This lives in the browser suite rather than a unit test because every
 * assertion is about what comes back over HTTP. `proxy.ts` runs as edge
 * middleware and Next can replace what it sets further down the response path —
 * which is the trap that let the un-Varied redirect ship in the first place, and
 * is written up under "Locale routing" in traps.md.
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
    // The reverse of the assertion this file used to make, and deliberately so.
    // `localeDetection: false` means neither `Accept-Language` nor the
    // `NEXT_LOCALE` cookie reaches the locale decision — the path prefix is the
    // only input. Declaring a Vary anyway costs a cache entry per distinct
    // header value, for a correctness property nothing needs.
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
  // Every one of these is a URL that may already be indexed, bookmarked, or
  // linked from somewhere this project does not control.
  //
  // `/login` and `/register` are in the list on purpose: they are session routes,
  // which take a different branch through `withCsp`, and that branch re-issued
  // the response and silently turned the 301 into a 307. A list of marketing
  // pages alone would have passed.
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
  /**
   * Read as paths, not as whole URLs: the origin in the markup comes from
   * `NEXT_PUBLIC_SITE_URL`, which the test stack does not set to the port it
   * serves on. The origin is `lib/seo.ts`'s job and has its own tests; what this
   * spec is about is the path each tag points at.
   *
   * `hrefLang`, capital L: that is what Next emits for `alternates.languages`,
   * and matching the lowercase spelling from the HTML spec silently matches
   * nothing.
   */
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
    // The list used to be written out per locale, so English losing its prefix
    // would have left `/en/login` disallowed — a URL that 301s — and `/login`
    // itself unlisted.
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
    // These were disallowed until 2026-09-02, together with the `noindex` they
    // still carry — which is the combination that does not work. `Disallow`
    // forbids *fetching*, so the crawler never reads the `noindex` it was sent
    // to obey, and `/login` and `/register` are linked from the header of every
    // public page: Bing followed them, was refused, and filed "Blocked by
    // robots.txt" against a site trying to say the opposite.
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
