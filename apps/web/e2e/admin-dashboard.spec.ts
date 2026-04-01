import { test, expect } from '@playwright/test';

test('Admin can login and access dashboard admin page', async ({ page }) => {
  await page.goto('http://localhost:3000/en/login');

  await page.fill('input[name="identifier"]', 'admin@hasnahena.local');
  await page.fill('input[name="password"]', 'Admin@12345');

  await page.click('button[type="submit"]');

  await page.waitForURL('**/dashboard/admin');

  expect(page.url()).toContain('/dashboard/admin');
});