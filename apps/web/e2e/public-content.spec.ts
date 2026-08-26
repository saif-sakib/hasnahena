import { test, expect, devices, type Page } from '@playwright/test';

import { hasDatabase, disconnect } from './fixtures/accounts';

/**
 * T-11 — **the admin's edit reaches the visitor's screen.**
 *
 * The task board named this and named why nothing covered it:
 *
 *   > `settings-keys-read.test.ts` enforces the key lists, but nothing yet
 *   > proves the rendered page changes when the value does.
 *
 * The unit censuses either side of this are both source-level. One says every
 * key a page reads is one an admin can write; the other, added with this spec,
 * says every key an admin can write is one something reads. Neither can see the
 * three things that have actually broken this loop in production:
 *
 *  1. **The cache.** The marketing pages are prerendered with `revalidate =
 *     3600`, so an edit is invisible for an hour unless `PUT /api/v1/settings`
 *     calls `revalidateTag`. It does — and an import removed by a refactor would
 *     leave every screen looking correct and the site frozen for an hour, with
 *     nothing red anywhere.
 *  2. **The tier.** A key outside `PUBLIC_CONFIG_KEYS` reads `undefined` on a
 *     public page and the hardcoded fallback renders forever (WO-67).
 *  3. **The language.** A pair whose English half is never read shows Bengali to
 *     an English reader. `locale-content.spec.ts` cannot catch it: it strips
 *     admin-typed values on purpose so it never goes red on real content.
 *
 * So this drives the real loop — sign in as an admin, `PUT` the settings
 * endpoint, reload the page as a stranger — and asserts the words arrive, in the
 * right language, on both.
 *
 * At **412 px** (rule 10). Every one of these values renders inside a card or a
 * heading that has to hold it on a phone.
 */

const PHONE = devices['Pixel 7'].viewport;

/** A value nothing else on the page could produce, per key and per language. */
const marker = (key: string, locale: string) =>
  locale === 'bn' ? `চিহ্ন-${key}-বাংলা` : `MARKER-${key}-EN`;

/**
 * The pairs, and where each one has to appear.
 *
 * `path` is the page that renders it. Written out rather than derived from
 * `LOCALIZED_SETTING_PAIRS`, deliberately: the list in `lib/` says which keys
 * are pairs, and this says which *page* each one is supposed to change. A key
 * that stops being rendered anywhere would still satisfy a derived list.
 */
const RENDERED_PAIRS: Array<{ key: string; path: string }> = [
  { key: 'hero.tagline', path: '' },
  { key: 'features.title', path: '' },
  { key: 'contact.title', path: '' },
  { key: 'donation.title', path: '' },
  { key: 'donation.subtitle', path: '' },
  { key: 'donation.referenceNote', path: '' },
  { key: 'stats.members', path: '' },
  { key: 'stats.deposits', path: '' },
  { key: 'stats.loans', path: '' },
  { key: 'stats.charity', path: '' },
  // The menu label, so it appears on every page carrying the header.
  { key: 'navigation.donate', path: '' },
  { key: 'auth.welcomeBack', path: 'login' },
];

const url = (locale: string, path: string) => {
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return path ? `${prefix}/${path}` : prefix || '/';
};

test.describe('what an admin types is what a visitor reads', () => {
  test.skip(!hasDatabase(), 'DATABASE_URL is not set');
  test.use({ viewport: PHONE });

  /** The values every key had before this file touched them. */
  let original: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    original = await readSettings(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    // Put the seeded values back. This suite writes to `system_config`, which
    // the Go suites do not truncate between tests, so leaving markers behind
    // would show them to every later spec — and to anyone who opens the test
    // stack in a browser afterwards and wonders why the home page says MARKER.
    const page = await browser.newPage();
    const restore: Record<string, string> = {};
    for (const { key } of RENDERED_PAIRS) {
      restore[key] = original[key] ?? '';
      restore[`${key}En`] = original[`${key}En`] ?? '';
    }
    await writeSettings(page, restore);
    await page.close();
    await disconnect();
  });

  for (const locale of ['en', 'bn'] as const) {
    test(`${locale}: every content control changes the page it belongs to`, async ({ page }) => {
      // One PUT for all of them: the endpoint takes the whole map, which is what
      // the admin screen posts, and doing it in one request also exercises the
      // single `revalidateTag` call that has to cover every page.
      const payload: Record<string, string> = {};
      for (const { key } of RENDERED_PAIRS) {
        payload[key] = marker(key, 'bn');
        payload[`${key}En`] = marker(key, 'en');
      }
      await writeSettings(page, payload);

      for (const { key, path } of RENDERED_PAIRS) {
        await page.goto(url(locale, path));
        const body = page.locator('body');

        // An auto-retrying assertion, not `innerText()`. The marketing pages
        // render their settings on the server, but `/login` fetches
        // `/api/v1/settings` from the browser after mount — reading the text
        // once, immediately, tested whether the request had finished rather
        // than whether the value arrives.
        await expect(
          body,
          `${key} did not reach ${url(locale, path)}. Either the page does not read it, ` +
            'the key is outside PUBLIC_CONFIG_KEYS, or the settings PUT no longer ' +
            'revalidates the system-config tag.',
        ).toContainText(marker(key, locale), { timeout: 15_000 });

        // And the *other* language must not be showing. This is the assertion
        // the single-box bug fails: with one row for two audiences, whichever
        // script the admin typed appears here whatever the locale.
        await expect(
          body,
          `${key} rendered the ${locale === 'en' ? 'Bengali' : 'English'} half on the ` +
            `${locale} page — one box shown to two audiences (lib/localized-settings.ts).`,
        ).not.toContainText(marker(key, locale === 'en' ? 'bn' : 'en'));
      }
    });
  }

  test('a blank figure removes its card rather than showing a gap', async ({ page }) => {
    // The owner's rule for the hero figures, and the same one /donate uses for
    // bank details: unset means absent, because a visitor cannot tell an empty
    // card from a foundation with no members.
    const blank: Record<string, string> = {};
    for (const key of ['stats.members', 'stats.deposits', 'stats.loans', 'stats.charity']) {
      blank[key] = '';
      blank[`${key}En`] = '';
    }
    await writeSettings(page, blank);

    await page.goto('/');
    const body = await page.locator('body').innerText();
    // The labels are message-file strings, so their absence is what proves the
    // whole panel is gone rather than four cards showing empty values.
    expect(body).not.toContain('Total Members');
    expect(body).not.toContain('Charitable Fund');
  });
});

// ---------------------------------------------------------------------------
// Talking to the settings endpoint the way the admin screen does
// ---------------------------------------------------------------------------

async function adminToken(page: Page): Promise<string> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
  const identifier = process.env.E2E_ADMIN_IDENTIFIER;
  const password = process.env.E2E_ADMIN_PASSWORD;
  expect(identifier && password, 'Set E2E_ADMIN_IDENTIFIER and E2E_ADMIN_PASSWORD').toBeTruthy();

  const response = await page.request.post(`${apiBase}/v1/auth/login`, {
    data: { identifier, password },
  });
  const body = await response.json();
  expect(body?.data?.accessToken, `admin login failed: ${JSON.stringify(body)}`).toBeTruthy();
  return body.data.accessToken as string;
}

async function readSettings(page: Page): Promise<Record<string, string>> {
  const token = await adminToken(page);
  const response = await page.request.get('/api/v1/settings', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `GET /api/v1/settings failed: ${response.status()}`).toBe(true);
  return (await response.json()) as Record<string, string>;
}

/**
 * `PUT /api/v1/settings` — the same request the Content & Media form makes.
 *
 * Going through the endpoint rather than writing the rows with Prisma is the
 * whole point: the cache invalidation lives in the route handler, so a direct
 * database write would prove the page can render a value while saying nothing
 * about whether an admin pressing Save ever sees it.
 */
async function writeSettings(page: Page, settings: Record<string, string>): Promise<void> {
  const token = await adminToken(page);
  // The body is the map itself, not `{ settings: … }` — the endpoint validates
  // its own top-level keys against SYSTEM_CONFIG_KEYS and 400s on any it does
  // not recognise, which a wrapper object would trip on immediately.
  const response = await page.request.put('/api/v1/settings', {
    headers: { Authorization: `Bearer ${token}` },
    data: settings,
  });
  expect(
    response.ok(),
    `PUT /api/v1/settings failed (${response.status()}): ${await response.text()}`,
  ).toBe(true);
}
