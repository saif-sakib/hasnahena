import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD, type SeededRole } from './accounts';

/** Where each role lands after signing in. */
export const DASHBOARD: Record<SeededRole, string> = {
  MEMBER: 'dashboard/member',
  WORKER: 'dashboard/worker',
  ADMIN: 'dashboard/admin',
};

/**
 * Sign in through the real login form.
 *
 * Deliberately not a shortcut that writes a token into localStorage. The login
 * page is where the first-login password change, the role redirect and the
 * token handoff all happen, and a fixture that skips it would leave the one
 * screen every member sees untested while making every other spec look covered.
 */
export async function loginAs(page: Page, role: SeededRole, locale: 'en' | 'bn' = 'en'): Promise<void> {
  // English has no prefix since WO-95 — `/en/login` 301s to `/login`, so a
  // literal here would work and cost a redirect on every signed-in spec in the
  // suite.
  await page.goto(locale === 'en' ? '/login' : `/${locale}/login`);
  await page.fill('#identifier', ACCOUNTS[role].phone);
  await page.fill('#password', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(new RegExp(`/${DASHBOARD[role]}`), { timeout: 20_000 });
}

/**
 * Every page a signed-in role can reach, for the sweeps.
 *
 * Dynamic segments are excluded: they need a specific record to exist, so they
 * belong in the journey specs where one has just been created.
 */
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
 * Wait until the page has finished its first data fetch.
 *
 * Two mechanisms, because the dashboards use two patterns. Some render a
 * spinner and then content; others render their cards immediately with
 * placeholders and fill them in.
 *
 * Waiting only for the spinner was not enough, and the gap was instructive: the
 * member dashboard rendered four cards reading "BDT 0" for about 1.5 seconds
 * before the fetch resolved, so a sweep that measured that moment saw a
 * plausible-looking page with a zero balance on it. The fix was to the *page* —
 * it shows a dash while loading now — and this helper waits for the network to
 * settle so a spec is never asserting against a placeholder.
 */
export async function waitForContent(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');

  // Both waits are deliberately short. They are *hints* — every assertion that
  // depends on loaded data uses a retrying matcher, so a page that is still
  // filling in is caught there rather than here. Generous waits multiply: a
  // spec that walks ten admin pages was spending up to 25 s each and blowing the
  // 30 s test timeout, which reads as a broken page rather than a slow one.
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
