import { test, expect, type Page } from '@playwright/test';

import { hasDatabase, seedAccounts, disconnect } from './fixtures/accounts';
import { loginAs, PAGES, waitForContent } from './fixtures/session';

/**
 * The English site is in English (hardcoded component copy is only visible on
 * the rendered page) and the language toggle goes somewhere real (string
 * surgery once produced /bndashboard/admin).
 */

/** Bengali letters and digits — minus ৳ (U+09F3), the taka sign, correct in English too. */
const BENGALI = /[\u0980-\u09F2\u09F4-\u09FF]/;

/** Legitimately Bengali on an English page: only the language toggle. */
const ALLOWED_ON_ENGLISH = ['বাংলা'];

/**
 * Every admin-typed settings value, stripped first: this enforces COMPONENT
 * copy, not database content (pairs are checked in the unit suite).
 */
async function settingsValues(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/v1/settings');
  const body = response.ok()
    ? ((await response.json()) as { data?: Record<string, string> } | Record<string, string>)
    : {};
  const map = (body as { data?: Record<string, string> }).data ?? (body as Record<string, string>);
  const values = Object.values(map)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  // No settings means a broken rig (e.g. truncated by a Go suite), not a page
  // without settings — fail loudly rather than measure the wrong thing.
  expect(
    values.length,
    'GET /api/v1/settings returned nothing, so there is no admin-typed text to ' +
      'strip and this spec would report database content as hardcoded copy. ' +
      'Re-seed: `scripts/test-stack.sh down && scripts/test-stack.sh up --serve`. ' +
      'The Go integration suite truncates every table, so it must not run ' +
      'alongside the browser suite.',
  ).toBeGreaterThan(0);

  return values;
}

/** What a reader actually sees, minus the sanctioned Bengali and admin data. */
async function visibleText(page: Page): Promise<string> {
  const text = await page.evaluate(() => document.body.innerText);
  const strip = [...ALLOWED_ON_ENGLISH, ...(await settingsValues(page))];
  return strip.reduce((acc, value) => acc.split(value).join(''), text);
}

/** The Bengali fragments left over, with enough context to find them in source. */
function bengaliFragments(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => BENGALI.test(line));
}

test.describe('an English page shows no Bengali', () => {
  for (const path of PAGES.public) {
    test(`/${path || '(home)'}`, async ({ page }) => {
      await page.goto(`/${path}`);
      await waitForContent(page);

      const fragments = bengaliFragments(await visibleText(page));
      expect(
        fragments,
        `/${path} renders Bengali to an English reader. These strings are ` +
          'hardcoded in a component rather than read from messages/en.json ' +
          '(rule 5) — move them into both message files:\n  ' +
          fragments.join('\n  '),
      ).toEqual([]);
    });
  }
});

test.describe('the language toggle', () => {
  test('goes to the same page in the other language, from a public page', async ({ page }) => {
    await page.goto('/faq');
    await waitForContent(page);

    await page.getByRole('link', { name: 'বাংলা', exact: true }).first().click();
    await page.waitForURL('**/bn/faq');
    expect(new URL(page.url()).pathname).toBe('/bn/faq');

    // And back. `exact`: the logo's alt "Hasnahena Foundation" contains "en".
    await page.getByRole('link', { name: 'EN', exact: true }).first().click();
    await page.waitForURL((url) => url.pathname === '/faq');
    expect(new URL(page.url()).pathname).toBe('/faq');
  });

  test.describe('signed in', () => {
    test.skip(!hasDatabase(), 'Set DATABASE_URL (scripts/test-stack.sh env) to sign in.');

    test.beforeAll(async () => {
      await seedAccounts();
    });
    test.afterAll(async () => {
      await disconnect();
    });

    test('keeps a staff user on the screen they were reading', async ({ page }) => {
      test.setTimeout(90_000);
      await loginAs(page, 'ADMIN');
      await page.goto('/dashboard/admin');
      await waitForContent(page);

      // This is the exact click that produced `/bndashboard/admin`.
      await page.getByRole('link', { name: 'BN', exact: true }).first().click();
      await page.waitForURL('**/bn/dashboard/admin');
      expect(new URL(page.url()).pathname).toBe('/bn/dashboard/admin');
      // A 404 renders; asserting the URL alone would have passed on the bug's
      // *successor* if the path were merely wrong rather than malformed.
      await expect(page.getByRole('link', { name: 'EN', exact: true }).first()).toBeVisible();

      await page.getByRole('link', { name: 'EN', exact: true }).first().click();
      await page.waitForURL((url) => url.pathname === '/dashboard/admin');
      expect(new URL(page.url()).pathname).toBe('/dashboard/admin');
    });
  });
});
