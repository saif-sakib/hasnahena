import { test, expect } from '@playwright/test';

/** Admin credentials from the environment; skips without them. */
const ADMIN_IDENTIFIER = process.env.E2E_ADMIN_IDENTIFIER;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.describe('admin login', () => {
  test.skip(
    !ADMIN_IDENTIFIER || !ADMIN_PASSWORD,
    'Set E2E_ADMIN_IDENTIFIER and E2E_ADMIN_PASSWORD to run the end-to-end specs.'
  );

  test('an admin can sign in and land on the admin dashboard', async ({ page }) => {
    await page.goto('/login');

    await page.fill('input[name="identifier"]', ADMIN_IDENTIFIER!);
    await page.fill('input[name="password"]', ADMIN_PASSWORD!);
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard/admin');
    await expect(page).toHaveURL(/\/dashboard\/admin/);
  });
});
