import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

import { hasDatabase, seedAccounts, disconnect } from './fixtures/accounts';
import { loginAs, PAGES, waitForContent } from './fixtures/session';

/**
 * WO-76 — a real browser renders every page under the CSP without a violation
 * (Chromium logs them to the console; no collector). Both tiers asserted
 * separately (lib/csp.ts).
 */

/** A CSP violation, as Chromium words it. */
function isCspViolation(message: ConsoleMessage): boolean {
  const text = message.text();
  return (
    text.includes('Content Security Policy') ||
    text.includes('Content-Security-Policy') ||
    text.includes('violates the following Content Security Policy directive')
  );
}

/** Collect CSP violations reported while `visit` runs. */
async function violationsDuring(page: Page, visit: () => Promise<void>): Promise<string[]> {
  const violations: string[] = [];
  const listener = (message: ConsoleMessage) => {
    if (isCspViolation(message)) violations.push(message.text());
  };
  page.on('console', listener);
  try {
    await visit();
  } finally {
    page.off('console', listener);
  }
  return violations;
}

test.describe('Content-Security-Policy', () => {
  test.skip(
    !hasDatabase(),
    'Set DATABASE_URL (scripts/test-stack.sh env) — the dashboard sweeps sign in.',
  );

  test.beforeAll(async () => {
    await seedAccounts();
  });
  test.afterAll(async () => {
    await disconnect();
  });

  test('every public page is sent a policy, and reports no violation', async ({ page }) => {
    test.setTimeout(180_000);
    for (const path of PAGES.public) {
      const violations = await violationsDuring(page, async () => {
        const response = await page.goto(`/${path}`);
        expect(response, `no response for /${path}`).not.toBeNull();

        const headers = response!.headers();
        const policy =
          headers['content-security-policy'] ??
          headers['content-security-policy-report-only'];
        expect(policy, `/${path} was served with no CSP at all`).toBeTruthy();
        expect(policy, 'the modern half of X-Frame-Options: DENY').toContain(
          "frame-ancestors 'none'",
        );

        // waitForContent, not networkidle — the dashboard polls.
        await waitForContent(page);
      });

      expect(violations, `CSP violations on /${path}:\n${violations.join('\n')}`).toEqual([]);
    }
  });

  test('the auth pages get the strict, nonce-carrying policy', async ({ page }) => {
    for (const path of ['login', 'register', 'forgot-password']) {
      const response = await page.goto(`/${path}`);
      const headers = response!.headers();
      const policy =
        headers['content-security-policy'] ?? headers['content-security-policy-report-only'];

      expect(policy, `/${path} carries no CSP`).toBeTruthy();
      expect(policy, `/${path} must carry a nonce — it is where a password is typed`).toMatch(
        /script-src [^;]*'nonce-/,
      );
      const scriptSrc = /script-src ([^;]*)/.exec(policy!)?.[1] ?? '';
      expect(
        scriptSrc,
        "'unsafe-inline' in script-src is the thing this policy exists to avoid",
      ).not.toContain("'unsafe-inline'");
    }
  });

  test('a signed-in member browses every dashboard page without a violation', async ({ page }) => {
    test.setTimeout(180_000);
    const violations = await violationsDuring(page, async () => {
      await loginAs(page, 'MEMBER');
      for (const path of PAGES.MEMBER) {
        await page.goto(`/${path}`);
        await waitForContent(page);
      }
    });

    expect(
      violations,
      `CSP violations on the member dashboard:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  test('an admin browses every admin page without a violation', async ({ page }) => {
    test.setTimeout(240_000);
    // The admin screens are where the remaining risk is: image uploads (blob:
    // previews), the Cloudinary URLs they produce, and the settings form.
    const violations = await violationsDuring(page, async () => {
      await loginAs(page, 'ADMIN');
      for (const path of PAGES.ADMIN) {
        await page.goto(`/${path}`);
        await waitForContent(page);
      }
    });

    expect(violations, `CSP violations on the admin dashboard:\n${violations.join('\n')}`).toEqual(
      [],
    );
  });

  test('the dashboard is sent a fresh nonce on every request', async ({ page }) => {
    // A fresh nonce per request.
    const nonces = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const response = await page.goto('/login');
      const policy =
        response!.headers()['content-security-policy'] ??
        response!.headers()['content-security-policy-report-only'];
      const nonce = /'nonce-([^']+)'/.exec(policy ?? '')?.[1];
      expect(nonce, 'no nonce in the policy').toBeTruthy();
      nonces.add(nonce!);
      // Defeat the browser cache; a 304 would legitimately reuse the header.
      await page.goto('about:blank');
    }
    expect(nonces.size, 'the same nonce was served more than once').toBe(3);
  });
});
