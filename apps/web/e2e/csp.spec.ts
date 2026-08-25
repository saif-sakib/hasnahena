import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

import { hasDatabase, seedAccounts, disconnect } from './fixtures/accounts';
import { loginAs, PAGES, waitForContent } from './fixtures/session';

/**
 * WO-76 — the CSP is present, and it is not too tight to use.
 *
 * The header assertion is the cheap half and lives in the unit suite. This is
 * the half that cannot be faked: a policy is only correct if a real browser
 * renders every page under it without reporting a violation, and the failure
 * mode a header test cannot see is the one that matters — a directive that
 * blocks the application's own scripts, styles or fetches.
 *
 * Chromium reports every violation to the console, in both enforcing and
 * report-only mode, which is what makes this observable without a collector
 * endpoint. There is no `report-uri` in the policy precisely because there is
 * nowhere to send reports; the console and this spec are the collection.
 *
 * The two tiers are asserted separately, because they are genuinely different
 * policies and a spec that swept them together would pass while one of them was
 * doing nothing. See lib/csp.ts for why there are two.
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

        // `waitForContent`, not `networkidle`. This dashboard polls three
        // endpoints on intervals, so the network is never idle and the wait
        // times out at 30 s — which reads as a broken page rather than a busy
        // one. The fixture already carries that lesson; see WO-74 for the
        // polling itself.
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
    // A nonce reused across requests is not a nonce: an attacker who reads one
    // page's HTML learns the value that will let their injected script run on
    // the next. Nothing in Next guarantees this — the proxy generates it — so
    // it is asserted rather than assumed.
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
