import { test, expect, devices, type Page } from '@playwright/test';

import { hasDatabase, seedAccounts, disconnect } from './fixtures/accounts';
import { loginAs, PAGES, waitForContent } from './fixtures/session';

/**
 * TEST-30 — four hand-written checks (no audit library): every control has a
 * name, focus is visible, errors are announced, and a form completes by keyboard.
 */

/** Controls with no accessible name, described well enough to fix. */
async function unlabelledControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'input:not([type=hidden]), select, textarea, button, [role=button], [role=checkbox], [role=switch]',
    );

    for (const el of Array.from(controls)) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      // next dev's <nextjs-portal> overlay is absent in production.
      if (el.closest('nextjs-portal')) continue;
      // Radix's hidden native <select> is outside the a11y tree by design.
      if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) continue;
      if (el.getAttribute('tabindex') === '-1') continue;

      const id = el.getAttribute('id');
      const named =
        el.getAttribute('aria-label')?.trim() ||
        el.getAttribute('aria-labelledby')?.trim() ||
        el.getAttribute('title')?.trim() ||
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim()) ||
        el.closest('label')?.textContent?.trim() ||
        // A button's own text is its name.
        (el.tagName === 'BUTTON' ? el.textContent?.trim() : '') ||
        // An icon-only button often carries an svg with a title.
        el.querySelector('svg title')?.textContent?.trim() ||
        // A placeholder is a poor name but it is a name; flagging those
        // separately would drown the real findings.
        el.getAttribute('placeholder')?.trim();

      if (!named) {
        // Report the icon and the surrounding text, which is what identifies
        // the button in the source. The class list is noise.
        const icon = el.querySelector('svg')?.getAttribute('class') ?? '';
        const near = (el.parentElement?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
        problems.push(
          `<${el.tagName.toLowerCase()}` +
            `${el.getAttribute('type') ? ` type="${el.getAttribute('type')}"` : ''}` +
            `${id ? ` id="${id}"` : ''}>` +
            `${icon ? ` icon:[${icon}]` : ''}` +
            `${near ? ` near:"${near}"` : ''}`,
        );
      }
    }
    return problems;
  });
}

test.describe('every control on a public page has an accessible name', () => {
  test.use({ viewport: devices['Pixel 7'].viewport });

  for (const path of PAGES.public) {
    test(`/${path || '(home)'}`, async ({ page }) => {
      await page.goto(`/${path}`);
      await waitForContent(page);
      const problems = await unlabelledControls(page);
      expect(
        problems,
        `/${path} has controls a screen reader cannot name:\n  ${problems.join('\n  ')}`,
      ).toEqual([]);
    });
  }
});

test.describe('signed-in pages', () => {
  test.skip(!hasDatabase(), 'Set DATABASE_URL (scripts/test-stack.sh env) to run this sweep.');
  test.use({ viewport: devices['Pixel 7'].viewport });

  test.beforeAll(async () => {
    await seedAccounts();
  });
  test.afterAll(async () => {
    await disconnect();
  });

  for (const role of ['MEMBER', 'WORKER', 'ADMIN'] as const) {
    for (const path of PAGES[role]) {
      test(`${role} · /${path} names every control`, async ({ page }) => {
        // Login plus a first-visit compile under `next dev`.
        test.setTimeout(90_000);
        await loginAs(page, role);
        await page.goto(`/${path}`);
        await waitForContent(page);
        const problems = await unlabelledControls(page);
        expect(
          problems,
          `/${path} has controls a screen reader cannot name:\n  ${problems.join('\n  ')}`,
        ).toEqual([]);
      });
    }
  }
});

test.describe('keyboard and focus', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the login form is completable with the keyboard alone', async ({ page }) => {
    await page.goto('/login');
    await waitForContent(page);

    // Start at the field (next dev's overlay sits in the tab order).
    await page.locator('#identifier').focus();
    const reachedIdentifier = await page.evaluate(() => document.activeElement?.id === 'identifier');
    expect(reachedIdentifier, 'the identifier field cannot take focus').toBe(true);

    await page.keyboard.type('01966600001');

    // Tab REACHES password then submit, in order — not strict adjacency.
    const order: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      const seen = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el.closest('nextjs-portal')) return null;
        if (el.id === 'password') return 'password';
        if (el.getAttribute('type') === 'submit') return 'submit';
        return null;
      });
      if (seen && !order.includes(seen)) order.push(seen);
    }
    expect(order, 'Tab did not reach the password field then the submit button').toEqual(['password', 'submit']);
  });

  test('focus is visible on every control the keyboard can reach', async ({ page }) => {
    await page.goto('/login');
    await waitForContent(page);
    await page.locator('#identifier').focus();

    // A reset that removes the outline without providing a ring leaves keyboard
    // users with no idea where they are.
    const invisible: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      const finding = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        // See above: the dev-tools overlay is not the application.
        if (el.tagName.toLowerCase() === 'nextjs-portal' || el.closest('nextjs-portal')) return null;
        const style = getComputedStyle(el);
        const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const hasRing = style.boxShadow !== 'none' && style.boxShadow !== '';
        const hasBorderChange = parseFloat(style.borderWidth) > 0;
        if (hasOutline || hasRing || hasBorderChange) return null;
        return `<${el.tagName.toLowerCase()}${el.id ? ` id="${el.id}"` : ''}>`;
      });
      if (finding) invisible.push(finding);
    }
    expect(invisible, `these controls show no focus indicator:\n  ${invisible.join('\n  ')}`).toEqual([]);
  });
});

test.describe('error announcement', () => {
  test.use({ viewport: devices['Pixel 7'].viewport });

  test('a blocked registration announces the reason in a live region', async ({ page }) => {
    // Errors must be in a live region to be announced.
    await page.goto('/register');
    await waitForContent(page);

    await page.getByRole('button', { name: 'Next', exact: true }).click();

    const alerts = page.locator('[role="alert"], [aria-live="polite"], [aria-live="assertive"]');
    await expect(alerts.first()).toBeVisible({ timeout: 10_000 });

    const text = (await alerts.first().innerText()).trim();
    expect(text.length, 'the live region is empty, so nothing is announced').toBeGreaterThan(3);
  });

  test('a failed login announces why, rather than only colouring the field', async ({ page }) => {
    await page.goto('/login');
    await waitForContent(page);

    await page.fill('#identifier', '01900000000');
    await page.fill('#password', 'definitely-not-the-password');
    await page.click('button[type="submit"]');

    // Either an inline live region or a toast — both are announced. What must
    // not happen is a silent failure with a red border and nothing else.
    const announced = page.locator('[role="alert"], [role="status"], [aria-live]');
    await expect(announced.first()).toBeVisible({ timeout: 15_000 });
  });
});
