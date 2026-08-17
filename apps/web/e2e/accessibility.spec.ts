import { test, expect, devices, type Page } from '@playwright/test';

import { hasDatabase, seedAccounts, disconnect } from './fixtures/accounts';
import { loginAs, PAGES, waitForContent } from './fixtures/session';

/**
 * TEST-30 — accessibility, checked by hand rather than by an audit library.
 *
 * No `@axe-core/playwright`: adding a dependency to run a generic audit would
 * produce a long list of advisory findings, most of which nobody will action,
 * and none of which is specific to a cooperative whose members are filling in
 * financial forms on a cheap Android in bright sunlight. These four checks are.
 *
 *  1. **Every control has a name.** An input a screen reader announces as
 *     "edit text" is unusable, and it is also the thing most likely to break
 *     silently when a label is moved.
 *  2. **Focus is visible.** Keyboard and switch users cannot use a form whose
 *     focus ring has been removed by a reset.
 *  3. **Errors are announced.** A red border is invisible to a screen reader
 *     and to anyone who cannot distinguish red — the message needs a live region.
 *  4. **A form can be completed without a mouse.** Tab must reach every control
 *     in an order that matches the visual one.
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
      // `next dev` injects a <nextjs-portal> dev-tools overlay that is absent
      // from a production build. It has already cost this project one wasted
      // debugging session by matching a "Next" button locator, so it is
      // excluded explicitly rather than incidentally.
      if (el.closest('nextjs-portal')) continue;
      // Radix's Select renders a native <select aria-hidden tabindex="-1">
      // alongside its own trigger, purely so a plain form submit carries the
      // value. It is deliberately outside the accessibility tree, and flagging
      // it would be a false positive — the kind that teaches people to stop
      // reading this suite.
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
    test(`/en/${path || '(home)'}`, async ({ page }) => {
      await page.goto(`/en/${path}`);
      await waitForContent(page);
      const problems = await unlabelledControls(page);
      expect(
        problems,
        `/en/${path} has controls a screen reader cannot name:\n  ${problems.join('\n  ')}`,
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
      test(`${role} · /en/${path} names every control`, async ({ page }) => {
        // Login plus a first-visit compile under `next dev`.
        test.setTimeout(90_000);
        await loginAs(page, role);
        await page.goto(`/en/${path}`);
        await waitForContent(page);
        const problems = await unlabelledControls(page);
        expect(
          problems,
          `/en/${path} has controls a screen reader cannot name:\n  ${problems.join('\n  ')}`,
        ).toEqual([]);
      });
    }
  }
});

test.describe('keyboard and focus', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the login form is completable with the keyboard alone', async ({ page }) => {
    await page.goto('/en/login');
    await waitForContent(page);

    // Tab until focus lands in the identifier field, then type through the form.
    // A form where Tab skips a required input cannot be filled without a mouse.
    // Start from the field itself rather than tabbing to it: `next dev`'s
    // overlay sits in the tab order and is not present in production, so
    // counting Tab presses would measure the dev server.
    await page.locator('#identifier').focus();
    const reachedIdentifier = await page.evaluate(() => document.activeElement?.id === 'identifier');
    expect(reachedIdentifier, 'the identifier field cannot take focus').toBe(true);

    await page.keyboard.type('01966600001');

    // Tab must *reach* the password field and the submit button, in that order.
    // Not adjacency: "Forgot password?" sits on the same row as the Password
    // label, so it is visually between the two fields and correctly tabbed
    // between them too. Asserting strict adjacency would have demanded a worse
    // layout to satisfy a test.
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
    await page.goto('/en/login');
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
    // The registration bug that started all of this was an error that existed
    // and could not be seen. A screen-reader user has the same problem for a
    // different reason: a message rendered as ordinary text is never announced.
    await page.goto('/en/register');
    await waitForContent(page);

    await page.getByRole('button', { name: 'Next', exact: true }).click();

    const alerts = page.locator('[role="alert"], [aria-live="polite"], [aria-live="assertive"]');
    await expect(alerts.first()).toBeVisible({ timeout: 10_000 });

    const text = (await alerts.first().innerText()).trim();
    expect(text.length, 'the live region is empty, so nothing is announced').toBeGreaterThan(3);
  });

  test('a failed login announces why, rather than only colouring the field', async ({ page }) => {
    await page.goto('/en/login');
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
