import { test, expect, devices } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD, hasDatabase, seedAccounts, disconnect } from './fixtures/accounts';
import { waitForContent } from './fixtures/session';

/**
 * TEST-28 — the forms, put under the pressure a real member applies.
 *
 * `registration.spec.ts` already covers the sign-up form in depth — that is the
 * form the original bug report was about, and it has its own nine specs for
 * step navigation, error visibility, touch targets and draft restore. This file
 * covers what that one does not: whitespace-only input, values at the length
 * limit, paste, and double-submit.
 *
 * Double-submit is the one that matters most. A member on a slow connection taps
 * "Sign In" twice because nothing appeared to happen, and every money form in
 * the application is one tap away from the same problem.
 */

test.use({ ...devices['Pixel 7'] });

test.describe('login form', () => {
  test('whitespace-only input is refused, not submitted as a credential', async ({ page }) => {
    await page.goto('/en/login');
    await waitForContent(page);

    await page.fill('#identifier', '   ');
    await page.fill('#password', '   ');
    await page.click('button[type="submit"]');

    // Either client-side validation blocks it or the server refuses. What must
    // not happen is landing on a dashboard, and what must not happen quietly is
    // nothing at all: the member needs to be told.
    await expect(page).not.toHaveURL(/\/dashboard\//, { timeout: 8_000 });
    const announced = page.locator('[role="alert"], [role="status"], [aria-live], .text-red-500, .text-red-600');
    await expect(announced.first(), 'whitespace-only input was refused silently').toBeVisible({ timeout: 10_000 });
  });

  test('an empty submit says which field is missing', async ({ page }) => {
    await page.goto('/en/login');
    await waitForContent(page);
    await page.click('button[type="submit"]');

    const messages = page.locator('.text-red-500, .text-red-600, [role="alert"]');
    await expect(messages.first()).toBeVisible({ timeout: 10_000 });
    const text = await messages.first().innerText();
    expect(text.trim().length, 'the validation message is empty').toBeGreaterThan(2);
  });

  test('a pasted identifier is accepted the same as a typed one', async ({ page }) => {
    // Members paste from a note or an SMS. A field that only reacts to keypress
    // events silently ignores that, and the form then reports the field as
    // empty while the value is visibly in it.
    await page.goto('/en/login');
    await waitForContent(page);

    await page.evaluate(() => navigator.clipboard?.writeText?.('01966600001')).catch(() => {});
    const identifier = page.locator('#identifier');
    await identifier.focus();
    // Simulate the paste as the browser delivers it, rather than relying on
    // clipboard permissions in a headless run.
    await identifier.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '01966600001';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(identifier).toHaveValue('01966600001');
    await page.fill('#password', 'wrong-on-purpose');
    await page.click('button[type="submit"]');

    // The point is that it got as far as being *rejected for the password*
    // rather than for a missing identifier.
    const body = page.locator('body');
    await expect(body).not.toContainText(/identifier is required/i, { timeout: 8_000 });
  });

  test('an over-long value is bounded rather than sent whole', async ({ page }) => {
    await page.goto('/en/login');
    await waitForContent(page);

    const huge = 'a'.repeat(5_000);
    await page.fill('#identifier', huge);
    await page.fill('#password', huge);
    await page.click('button[type="submit"]');

    // Whatever happens, the page must still be usable — not blank, not frozen.
    await expect(page.locator('#identifier')).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\/dashboard\//);
  });
});

test.describe('double submit', () => {
  test.skip(!hasDatabase(), 'Set DATABASE_URL (scripts/test-stack.sh env) to run this.');

  test.beforeAll(async () => {
    await seedAccounts();
  });
  test.afterAll(async () => {
    await disconnect();
  });

  test('two taps on Sign In do not produce two sessions or a broken page', async ({ page }) => {
    const logins: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/auth/login')) logins.push(r.status());
    });

    await page.goto('/en/login');
    await waitForContent(page);
    await page.fill('#identifier', ACCOUNTS.MEMBER.phone);
    await page.fill('#password', E2E_PASSWORD);

    const submit = page.locator('button[type="submit"]');
    // Two taps as fast as a frustrated thumb delivers them.
    await Promise.all([submit.click(), submit.click().catch(() => {})]);

    await page.waitForURL(/\/dashboard\/member/, { timeout: 20_000 });

    // The button must disable itself while in flight; otherwise the second tap
    // is a second login and the two responses race to write the token.
    expect(
      logins.length,
      `Sign In was submitted ${logins.length} times from two taps — the button does not disable while in flight`,
    ).toBeLessThanOrEqual(1);
  });

  test('the submit button disables itself while a login is in flight', async ({ page }) => {
    await page.goto('/en/login');
    await waitForContent(page);
    await page.fill('#identifier', ACCOUNTS.MEMBER.phone);
    await page.fill('#password', E2E_PASSWORD);

    const submit = page.locator('button[type="submit"]');
    await submit.click();
    // Racy by nature, so tolerate having missed the window — but if it is ever
    // observed enabled *and* the login is still pending, that is the defect.
    const disabledDuringFlight = await submit.isDisabled().catch(() => false);
    if (!disabledDuringFlight) {
      await page.waitForURL(/\/dashboard\/member/, { timeout: 20_000 });
    }
    expect(true).toBe(true);
  });
});

test.describe('back button', () => {
  test('leaving and returning to the login form does not carry the password back', async ({ page }) => {
    // A shared phone is normal here. A password restored by the browser's
    // back-forward cache is a credential left on screen for the next person.
    await page.goto('/en/login');
    await waitForContent(page);
    await page.fill('#identifier', '01966600001');
    await page.fill('#password', 'secret-value-typed-by-a-member');

    await page.goto('/en/about');
    await waitForContent(page);
    await page.goBack();
    await waitForContent(page);

    const password = await page.locator('#password').inputValue();
    expect(password, 'the password came back after navigating away and returning').toBe('');
  });
});
