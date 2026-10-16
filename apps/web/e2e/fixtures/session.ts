import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD, type SeededRole } from './accounts';

/** Where each role lands after signing in. */
export const DASHBOARD: Record<SeededRole, string> = {
  MEMBER: 'dashboard/member',
  WORKER: 'dashboard/worker',
  ADMIN: 'dashboard/admin',
};

/** Sign in through the real login form (it does the redirects and token handoff). */
export async function loginAs(page: Page, role: SeededRole, locale: 'en' | 'bn' = 'en'): Promise<void> {
  // English is unprefixed.
  await page.goto(locale === 'en' ? '/login' : `/${locale}/login`);
  await page.fill('#identifier', ACCOUNTS[role].phone);
  await page.fill('#password', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(new RegExp(`/${DASHBOARD[role]}`), { timeout: 20_000 });
}

/** Every page a role can reach, for the sweeps (dynamic segments excluded). */
export const PAGES: Record<'public' | SeededRole, string[]> = {
  public: [
    '',
    'about',
    'activities',
    'contact',
    'donate',
    'faq',
    'gallery',
    'privacy',
    'support',
    'terms',
    'login',
    'register',
    'forgot-password',
  ],
  MEMBER: [
    'dashboard/member',
    'dashboard/member/deposits',
    'dashboard/member/loans',
    'dashboard/member/profile',
    'dashboard/member/transactions',
  ],
  // The worker and admin dashboards render the same screens; the worker's list
  // is the admin's minus the four admin-only management tools.
  WORKER: [
    'dashboard/worker',
    'dashboard/worker/approvals',
    'dashboard/worker/content',
    'dashboard/worker/deposits',
    'dashboard/worker/loans',
    'dashboard/worker/members',
    'dashboard/worker/profile',
    'dashboard/worker/reports',
    'dashboard/worker/transactions',
  ],
  ADMIN: [
    'dashboard/admin',
    'dashboard/admin/approvals',
    'dashboard/admin/audit',
    'dashboard/admin/branches',
    'dashboard/admin/content',
    'dashboard/admin/deposits',
    'dashboard/admin/donations',
    'dashboard/admin/loans',
    'dashboard/admin/members',
    'dashboard/admin/profile',
    'dashboard/admin/reports',
    'dashboard/admin/settings',
    'dashboard/admin/transactions',
    'dashboard/admin/workers',
  ],
};

/**
 * Wait for the first data fetch (spinner, then network). A hint only —
 * assertions use retrying matchers.
 */
export async function waitForContent(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');

  // Short waits: they multiply across a sweep.
  const spinner = page.locator('.animate-spin').first();
  await spinner.waitFor({ state: 'detached', timeout: 6_000 }).catch(() => {
    // Some pages have no spinner at all, and a few keep a decorative one.
  });

  // `networkidle` is discouraged for general use because a page with polling
  // never reaches it — hence the short budget and the catch.
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});

  await expect(page.locator('body')).toBeVisible();
}

/** The document's horizontal overflow, in pixels. Zero on a correct layout. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}
