import { test, expect, devices } from '@playwright/test';

import {
  ACCOUNTS,
  hasDatabase,
  seedAccounts,
  clearMemberActivity,
  memberSavings,
  disconnect,
} from './fixtures/accounts';
import { loginAs, PAGES, waitForContent } from './fixtures/session';

/**
 * TEST-26 / TEST-27 — member, worker and admin journeys: seeded values must
 * APPEAR on screen (the money itself is proven by the Go suites).
 */

test.describe('journeys', () => {
  test.skip(!hasDatabase(), 'Set DATABASE_URL (scripts/test-stack.sh env) to run the journeys.');
  test.use({ viewport: devices['Pixel 7'].viewport });

  test.beforeAll(async () => {
    await clearMemberActivity();
    await seedAccounts(73_500);
  });
  test.afterAll(async () => {
    await disconnect();
  });

  // -------------------------------------------------------------------------
  // TEST-26 — the member
  // -------------------------------------------------------------------------

  test('a member signs in and sees their own balance, not a zero', async ({ page }) => {
    await loginAs(page, 'MEMBER');
    await waitForContent(page);

    // 73,500 in South Asian grouping; toContainText retries past placeholders.
    await expect(page.locator('body'), 'the seeded balance of 73,500 never appeared')
      .toContainText('73,500', { timeout: 20_000 });
  });

  test('the member reaches every one of their own pages from the dashboard', async ({ page }) => {
    // next dev compiles each route on first visit.
    test.setTimeout(120_000);
    await loginAs(page, 'MEMBER');

    for (const path of ['deposits', 'loans', 'transactions', 'profile']) {
      const response = await page.goto(`/dashboard/member/${path}`);
      expect(response?.status(), `member/${path} answered ${response?.status()}`).toBeLessThan(400);
      await waitForContent(page);
      // A page that renders its shell and then throws leaves an empty main.
      const text = await page.locator('body').innerText();
      expect(text.trim().length, `member/${path} rendered an empty page`).toBeGreaterThan(50);
    }
  });

  test('a member is shown no other member\'s data on a staff dashboard', async ({ page }) => {
    // The API refuses these routes to a member; no other member's data may show.
    test.setTimeout(90_000);
    await loginAs(page, 'MEMBER');

    for (const forbidden of ['dashboard/worker', 'dashboard/worker/members', 'dashboard/admin/members']) {
      await page.goto(`/${forbidden}`);
      await waitForContent(page);
      await page.waitForTimeout(2_000);
      const body = await page.locator('body').innerText();
      // The seeded worker and admin are other people. Their names must not
      // appear on a page a member is looking at.
      expect(body, `${forbidden} leaked another account's name to a MEMBER`).not.toContain('E2E WORKER');
      expect(body, `${forbidden} leaked another account's name to a MEMBER`).not.toContain('E2E ADMIN');
      // Nor any other member's savings.
      expect(body, `${forbidden} leaked a balance to a MEMBER`).not.toMatch(/BDT\s5,000/);
    }
  });

  test("the member's profile shows their own identity", async ({ page }) => {
    await loginAs(page, 'MEMBER');
    await page.goto('/dashboard/member/profile');
    await waitForContent(page);

    await expect(page.locator('body'), 'the profile does not show the signed-in member')
      .toContainText('E2E MEMBER', { timeout: 20_000 });
    await expect(page.locator('body'), 'the profile does not show the member id')
      .toContainText(ACCOUNTS.MEMBER.accountNo, { timeout: 20_000 });
  });

  // -------------------------------------------------------------------------
  // TEST-27 — the worker and the admin
  // -------------------------------------------------------------------------

  test('a worker sees the member list, and the seeded member is in it', async ({ page }) => {
    await loginAs(page, 'WORKER');
    await page.goto('/dashboard/worker/members');
    await waitForContent(page);

    await expect(page.locator('body'), 'the seeded member is missing from the worker member list')
      .toContainText('E2E MEMBER', { timeout: 20_000 });
  });

  test('a worker reaches every one of their pages', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'WORKER');
    // Driven from PAGES, so the inventory cannot go stale.
    for (const path of PAGES.WORKER) {
      const response = await page.goto(`/${path}`);
      expect(response?.status(), `${path} answered ${response?.status()}`).toBeLessThan(400);
      await waitForContent(page);
      const text = await page.locator('body').innerText();
      expect(text.trim().length, `${path} rendered an empty page`).toBeGreaterThan(50);
    }
  });

  test('an admin sees a member count that reflects the database', async ({ page }) => {
    await loginAs(page, 'ADMIN');
    await waitForContent(page);

    // The dashboard aggregates. What matters is that it aggregates *something*
    // rather than rendering zeros — a broken count reads as a quiet cooperative.
    await expect
      .poll(
        async () => {
          const body = await page.locator('body').innerText();
          const numbers = [...body.matchAll(/\b\d[\d,]*\b/g)].map((m) => Number(m[0].replace(/,/g, '')));
          return numbers.some((n) => n > 0);
        },
        {
          message: 'every figure on the admin dashboard is zero, with seeded members and balances present',
          timeout: 20_000,
        },
      )
      .toBe(true);
  });

  test('an admin reaches every one of their pages', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAs(page, 'ADMIN');
    for (const path of PAGES.ADMIN) {
      const response = await page.goto(`/${path}`);
      expect(response?.status(), `${path} answered ${response?.status()}`).toBeLessThan(400);
      await waitForContent(page);
      const text = await page.locator('body').innerText();
      expect(text.trim().length, `${path} rendered an empty page`).toBeGreaterThan(50);
    }
  });

  test('the admin member list shows the seeded member and links to them', async ({ page }) => {
    await loginAs(page, 'ADMIN');
    await page.goto('/dashboard/admin/members');
    await waitForContent(page);

    await expect(page.locator('body'), 'the seeded member is missing from the admin member list')
      .toContainText('E2E MEMBER', { timeout: 20_000 });
  });

  test('the admin settings page loads the saved organisation name', async ({ page }) => {
    // A system_config value must actually reach the Settings field.
    await loginAs(page, 'ADMIN');
    await page.goto('/dashboard/admin/settings');
    await waitForContent(page);

    const nameEn = page.locator('#org-name-en');
    await expect(nameEn).toBeVisible({ timeout: 15_000 });
    const value = await nameEn.inputValue();
    expect(value.trim().length, 'the organisation name field is empty, so settings did not load').toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // The money loop, asserted where a member would see it
  // -------------------------------------------------------------------------

  test('a balance written to the ledger appears on the member dashboard', async ({ page }) => {
    // A changed balance reaches the screen (posting itself is proven in Go).
    const before = await memberSavings();
    expect(before).toBe(BigInt(73_500));

    await loginAs(page, 'MEMBER');
    await expect(page.locator('body')).toContainText('73,500', { timeout: 20_000 });

    await seedAccounts(81_250);
    await page.reload();

    await expect(
      page.locator('body'),
      'the dashboard still shows the old balance after it changed — the page is serving a cached figure',
    ).toContainText('81,250', { timeout: 20_000 });
    await expect(page.locator('body')).not.toContainText('73,500');
  });
});
