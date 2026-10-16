import { test, expect, devices, type Page } from '@playwright/test';

import { hasDatabase, disconnect } from './fixtures/accounts';

/**
 * T-11 — an admin's edit reaches the visitor's screen: sign in, PUT settings,
 * reload as a stranger, assert the words arrive in the right language. Catches
 * a missing revalidateTag, a non-public key, or an unread English half. 412px.
 */

const PHONE = devices['Pixel 7'].viewport;

/** A value nothing else on the page could produce, per key and per language. */
const marker = (key: string, locale: string) =>
  locale === 'bn' ? `চিহ্ন-${key}-বাংলা` : `MARKER-${key}-EN`;

/** Each pair and the page that must render it — written out, not derived. */
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
    // Restore the seeded values (system_config is not truncated).
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
      // One PUT, as the admin screen posts — one revalidateTag must cover every page.
      const payload: Record<string, string> = {};
      for (const { key } of RENDERED_PAIRS) {
        payload[key] = marker(key, 'bn');
        payload[`${key}En`] = marker(key, 'en');
      }
      await writeSettings(page, payload);

      for (const { key, path } of RENDERED_PAIRS) {
        await page.goto(url(locale, path));
        const body = page.locator('body');

        // Auto-retrying: /login fetches settings after mount.
        await expect(
          body,
          `${key} did not reach ${url(locale, path)}. Either the page does not read it, ` +
            'the key is outside PUBLIC_CONFIG_KEYS, or the settings PUT no longer ' +
            'revalidates the system-config tag.',
        ).toContainText(marker(key, locale), { timeout: 15_000 });

        // The other language must not be showing.
        await expect(
          body,
          `${key} rendered the ${locale === 'en' ? 'Bengali' : 'English'} half on the ` +
            `${locale} page — one box shown to two audiences (lib/localized-settings.ts).`,
        ).not.toContainText(marker(key, locale === 'en' ? 'bn' : 'en'));
      }
    });
  }

  test('a blank figure removes its card rather than showing a gap', async ({ page }) => {
    // Unset hero figures are absent.
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

/** PUT /api/v1/settings as the Content & Media form does — the invalidation lives in the route. */
async function writeSettings(page: Page, settings: Record<string, string>): Promise<void> {
  const token = await adminToken(page);
  // The body is the bare map (unknown top-level keys are a 400).
  const response = await page.request.put('/api/v1/settings', {
    headers: { Authorization: `Bearer ${token}` },
    data: settings,
  });
  expect(
    response.ok(),
    `PUT /api/v1/settings failed (${response.status()}): ${await response.text()}`,
  ).toBe(true);
}
