import { test, expect, type Page } from '@playwright/test';

import { hasDatabase, seedAccounts, disconnect } from './fixtures/accounts';
import { loginAs, PAGES, waitForContent } from './fixtures/session';

/**
 * The English site is in English, and the language toggle goes somewhere real.
 *
 * Both halves are here because both were broken by the same event and neither
 * was visible to any check over the source.
 *
 * Bengali was the default locale until WO-94. While it was, a string written
 * straight into a component in Bengali looked correct on every page anyone
 * opened — so four hardcoded Bengali figures sat on the home page above English
 * captions the moment English became the default, and the parity census in
 * `messages.test.ts` could not see them because they were never in a message
 * file to be compared. The only place that defect is observable is the rendered
 * page, which is why this is an e2e spec and not a unit test.
 *
 * The toggle is the same shape of problem. `pathname.replace(localePath(locale),
 * …)` reads as if it swaps the locale segment; for English `localePath('en')` is
 * `/`, so it replaced the first slash of `/dashboard/admin` and produced
 * `/bndashboard/admin` — a 404 reachable from every staff screen. It typechecks,
 * it renders, and only a click reveals it.
 */

/**
 * Bengali letters and Bengali-Assamese digits — the block, minus one character.
 *
 * `৳` is U+09F3, inside the Bengali block, and it is the **taka sign**: what a
 * Bangladeshi reads a price in whichever language the sentence is written in.
 * `৳25 Lakh+` is correct English here, and the hero's figures count up through
 * intermediate values (`৳12 Lakh+`) that are not settings values and so cannot
 * be stripped like one. Every Bengali *letter* and every Bengali *digit* is
 * still refused, which is what this spec was written for: `১২৫+` under an
 * English caption was the original defect.
 */
const BENGALI = /[\u0980-\u09F2\u09F4-\u09FF]/;

/**
 * Text that is legitimately Bengali on an English page.
 *
 * Only the language toggle: it names the language it switches *to*, in that
 * language, which is what makes it findable by a reader who cannot read the
 * page they are on. Anything else appearing here would be the defect.
 */
const ALLOWED_ON_ENGLISH = ['বাংলা'];

/**
 * Every value an admin can type into Settings, so this spec never fails on one.
 *
 * A cooperative in Jashore will legitimately have Bengali in its own settings —
 * `org.name` *is* Bengali — and a test that goes red because someone edited a
 * database row is a test that gets deleted rather than read. What is being
 * enforced here is narrower and entirely the code's responsibility: **copy
 * written into a component** must come from `messages/en.json` on an English
 * page. Where a setting genuinely needs both scripts it gets a pair, the way
 * `org.name`/`org.nameEn` and `org.address`/`org.addressEn` do; that pairing is
 * asserted in the unit suite, where a database is not required.
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

  // An empty answer is a **broken rig**, not a page with no settings, and the
  // two used to be indistinguishable here: with nothing to strip, this spec
  // silently becomes a check on database content and reports the foundation's
  // own Bengali as copy hardcoded in a component. It happened — a Go suite
  // truncated `system_config` out from under a browser run, and the failure
  // named `৳25 Lakh+`, a settings value, as a defect in the source.
  //
  // Say which it is. A public page always has settings behind it; if it does
  // not, every assertion below is measuring the wrong thing.
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

    // And back. A toggle that only works one way strands a reader who switched
    // by accident — and under `as-needed` the two directions are genuinely
    // different operations: one adds a segment, the other removes one.
    // `exact`, and it matters: Playwright matches an accessible name by
    // substring by default, and the logo's alt text is "Hasnahena Foundation" —
    // which contains "en". Without it this clicked the logo and asserted its way
    // to a passing test that never touched the language button.
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
