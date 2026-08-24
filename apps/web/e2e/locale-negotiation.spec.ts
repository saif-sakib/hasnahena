import { test, expect } from '@playwright/test';

/**
 * `/` picks a language from the visitor's browser, and that has to be declared.
 *
 * next-intl's middleware reads `Accept-Language` to decide whether `/` sends
 * someone to `/bn` or `/en`, and emits a 307 with `cache-control: public`. It
 * does **not** emit a `Vary` header of its own — so as shipped, a shared cache
 * was entitled to store the redirect computed for one visitor and hand it to
 * the next. Cloudflare sits in front of this site in production, which makes
 * that a real cache rather than a hypothetical one, and the symptom is a member
 * in Jashore landing on the English site because an English-speaking visitor
 * asked first.
 *
 * It is also what a crawler reads to tell a *negotiated* entry point from a
 * fixed alias. Without it, `/` looks like a permanent stand-in for whichever
 * locale Googlebot happened to be served, which is not what `/` is.
 *
 * This lives in the browser suite rather than in a unit test because the defect
 * only exists at runtime: `proxy.ts` runs as edge middleware, and the header it
 * sets can be replaced by the framework further down the response path. The
 * only honest check is what actually comes back over HTTP.
 */
test.describe('the root path negotiates a language', () => {
  test('sends an English browser to /en and a Bengali one to /bn', async ({ request }) => {
    const en = await request.get('/', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      maxRedirects: 0,
    });
    const bn = await request.get('/', {
      headers: { 'Accept-Language': 'bn-BD,bn;q=0.9' },
      maxRedirects: 0,
    });

    expect(en.status(), 'the root must redirect, not render').toBe(307);
    expect(bn.status(), 'the root must redirect, not render').toBe(307);
    expect(en.headers()['location']).toContain('/en');
    expect(bn.headers()['location']).toContain('/bn');
  });

  test('declares that the redirect depends on Accept-Language', async ({ request }) => {
    // The assertion the defect was about. A response whose Location changes
    // with a request header and says nothing about it is cache-poisonable by
    // any intermediary that obeys `cache-control: public`.
    const response = await request.get('/', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      maxRedirects: 0,
    });

    const vary = response.headers()['vary'] ?? '';
    expect(
      vary.toLowerCase(),
      `the root redirect sent Vary: "${vary}". It varies on Accept-Language and must say so, ` +
        'or a shared cache may serve one visitor\'s language to another.',
    ).toContain('accept-language');
  });

  test('a locale URL needs no such declaration', async ({ request }) => {
    // The other half, and the reason this is not simply "set Vary everywhere":
    // /bn is Bengali for every visitor because the locale is in the path. Its
    // content does not depend on the header, so claiming it does would split
    // the cache for nothing on the pages that actually get traffic.
    const withEnglish = await request.get('/bn', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    expect(withEnglish.status()).toBe(200);
    const body = await withEnglish.text();
    expect(body, '/bn must serve Bengali whatever the browser asks for').toContain('lang="bn"');
  });
});
