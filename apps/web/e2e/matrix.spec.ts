import { test, expect, devices } from '@playwright/test';

import { hasDatabase, seedAccounts, disconnect } from './fixtures/accounts';
import { loginAs, PAGES, waitForContent, horizontalOverflow } from './fixtures/session';

/**
 * TEST-29 — every page, on a phone and a desktop, in English and Bengali.
 *
 * Bengali is materially longer than English for the same words — "Withdrawal"
 * is "টাকা উত্তোলন" — and its glyphs are taller, so a row that fits in `en`
 * can overflow in `bn` on a 360 px screen. Nobody notices, because nobody
 * develops in Bengali. This is the sweep that would.
 *
 * The assertions are the ones a member would notice, in order of severity:
 *
 *  1. the page renders at all (no error boundary, no blank body)
 *  2. nothing forces sideways scrolling
 *  3. no untranslated message key is showing
 *  4. no text is clipped out of its container
 *
 * Every failure names the page, the locale and the viewport, because "a test
 * failed" for a 76-cell matrix is not a bug report.
 */

const VIEWPORTS = [
  // The handset this cooperative's members carry.
  { name: 'phone', size: devices['Pixel 7'].viewport },
  // What the office uses.
  { name: 'desktop', size: { width: 1280, height: 800 } },
] as const;

const LOCALES = ['en', 'bn'] as const;

/**
 * The public URL for a locale — WO-95 / [ADR-034](../../../docs/decisions.md).
 * English has no prefix, Bengali does. Written out here rather than imported
 * from `lib/locale-path.ts` because a Playwright spec is the one place that
 * should be describing the URLs a *visitor* types, not sharing the application's
 * idea of them.
 */
const url = (locale: string, path: string) => {
  const prefix = locale === 'en' ? '' : `/${locale}`;
  // No trailing slash on the home page of a locale: Next 308s `/bn/` to `/bn`,
  // so building one would have this suite navigating through a redirect on the
  // two most-visited URLs it covers.
  return path ? `${prefix}/${path}` : prefix || '/';
};

/**
 * A message key that reached the screen instead of its translation.
 *
 * next-intl renders the key itself when a lookup misses, so `dashboard.member.title`
 * appears as body text. Matching that shape is how a missing key becomes visible
 * without diffing two JSON files — and the JSON files already agree (283 keys
 * each), so what this catches is a *component* asking for a key nobody defined.
 */
const LOOKS_LIKE_A_KEY = /\b[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){2,}\b/;

/** Text that is legitimately dotted and must not be mistaken for a key. */
const ALLOWED_DOTTED = [
  /hasnahenafoundation\.com/,
  /\w+@\w+\.\w+/,
  /\d+\.\d+/,
  /node_modules/,
  /\.js\b|\.ts\b|\.png\b|\.pdf\b/,
];

async function untranslatedKeys(page: import('@playwright/test').Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText || '');
  const found = new Set<string>();
  for (const line of text.split('\n')) {
    const match = line.match(LOOKS_LIKE_A_KEY);
    if (!match) continue;
    if (ALLOWED_DOTTED.some((allowed) => allowed.test(match[0]))) continue;
    found.add(match[0]);
  }
  return [...found];
}

/**
 * Elements whose content is wider than they are and clipped by `overflow:hidden`.
 *
 * Scrollable containers are excluded — a table that scrolls sideways inside its
 * own box is correct, and the page-level check above already catches the case
 * where the *document* scrolls.
 */
async function clippedElements(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(el);
      if (style.overflowX !== 'hidden' && style.overflow !== 'hidden') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      // Screen-reader-only text is a 1x1 clipping box **by construction** —
      // that is how `sr-only` hides it from the eye while leaving it in the
      // accessibility tree. Reporting it as clipped text is reporting the
      // technique. The hero's counting figures put four of these on the home
      // page, which is when this detector first met one on a public page.
      if (style.clip === 'rect(0px, 0px, 0px, 0px)' || el.classList.contains('sr-only')) continue;
      // Ignore decorative boxes with no text of their own.
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? '').trim())
        .join('');
      if (ownText.length < 3) continue;
      // 2 px of tolerance: sub-pixel rounding is not a clipped label.
      if (el.scrollWidth - el.clientWidth > 2) {
        bad.push(`<${el.tagName.toLowerCase()} class="${el.className}"> "${ownText.slice(0, 40)}"`);
      }
    }
    return bad;
  });
}

/**
 * The logo fits inside the header it is in — T-10.
 *
 * `components/ui/logo.tsx` computed a width from its `size` prop and handed it
 * to `next/image`, and then set `h-auto w-auto` in the className, which
 * overrides both. A replaced element sized `auto`/`auto` renders at its
 * intrinsic dimensions, so **every call site got the same picture**: `sm` and
 * `md` both measured 192 × 108 inside a 64 px header. At 412 px the leaf spilled
 * over the hero and covered the tagline badge; the privacy page's own header
 * grew to 141 px because it had no fixed height to spill out of.
 *
 * Nothing caught it. The page does not scroll sideways, no text is clipped, and
 * an oversized image is not a missing translation — the three things the matrix
 * above looks for. This is the assertion that would have.
 *
 * Measured rather than screenshotted on purpose: the failure is a number, and a
 * number names itself in the report.
 */
for (const viewport of VIEWPORTS) {
  test.describe(`the logo fits its header · ${viewport.name}`, () => {
    test.use({ viewport: viewport.size });

    for (const path of ['', 'privacy', 'terms', 'login', 'register']) {
      test(`${url('en', path) || '/'}`, async ({ page }) => {
        await page.goto(url('en', path));
        await waitForContent(page);

        const measured = await page.evaluate(() => {
          // The lockup, wherever it is. On the marketing pages it sits in the
          // site header; the auth pages put it inside the card instead, so
          // `header` is null there and only the width bound applies.
          const logo = document.querySelector<HTMLImageElement>('img[src*="logo"]');
          if (!logo) return null;
          const header = logo.closest('header');
          return {
            header: header ? Math.round(header.getBoundingClientRect().height) : null,
            logo: Math.round(logo.getBoundingClientRect().height),
            width: Math.round(logo.getBoundingClientRect().width),
          };
        });

        expect(measured, `no logo image found on ${url('en', path)}`).not.toBeNull();

        if (measured!.header !== null) {
          expect(
            measured!.logo,
            `the logo is ${measured!.logo}px tall inside a ${measured!.header}px header on ` +
              `${url('en', path)} — it is overflowing onto the page below it`,
          ).toBeLessThanOrEqual(measured!.header);
        }

        // **And a floor**, which is the other half of the same story. The first
        // fix for the overflow shrank the lockup to 40 px, and at that size the
        // two lines of Bengali tagline beneath হাসনাহেনা are about eight pixels
        // each — unreadable on the cheap Android in sunlight this site is built
        // for. A number is the only way to state "legible"; 36 px is below every
        // size the header actually uses, including the shrunk-on-scroll one.
        expect(
          measured!.logo,
          `the logo is only ${measured!.logo}px tall on ${url('en', path)} — the wordmark ` +
            'and its tagline cannot be read at that size',
        ).toBeGreaterThanOrEqual(36);

        // An uploaded `branding.logo` of an unexpected shape must not push the
        // language switcher off a 412 px screen either. This is the bound that
        // applies on the auth pages, where the lockup is inside the card.
        expect(
          measured!.width,
          `the logo is ${measured!.width}px wide on a ${viewport.size.width}px screen`,
        ).toBeLessThan(viewport.size.width * 0.7);
      });
    }
  });
}

for (const viewport of VIEWPORTS) {
  for (const locale of LOCALES) {
    test.describe(`public pages · ${viewport.name} · ${locale}`, () => {
      test.use({ viewport: viewport.size });

      for (const path of PAGES.public) {
        test(`${url(locale, path) || '/'} renders without breaking its layout`, async ({ page }) => {
          const response = await page.goto(url(locale, path));
          expect(response?.status(), `${url(locale, path)} returned ${response?.status()}`).toBeLessThan(400);
          await waitForContent(page);

          const overflow = await horizontalOverflow(page);
          expect(
            overflow,
            `${url(locale, path)} at ${viewport.size.width}px scrolls ${overflow}px sideways`,
          ).toBeLessThanOrEqual(1);

          const keys = await untranslatedKeys(page);
          expect(keys, `${url(locale, path)} shows untranslated keys: ${keys.join(', ')}`).toEqual([]);

          const clipped = await clippedElements(page);
          expect(clipped, `${url(locale, path)} clips text:\n  ${clipped.join('\n  ')}`).toEqual([]);
        });
      }
    });
  }
}

/**
 * The home page's content column must line up with the rest of the site — and
 * must be in the *same* place in both languages.
 *
 * The hero section is `flex items-center`, which centres it vertically and
 * silently makes its `container-wide` a **flex item**. A flex item with no
 * width shrinks to fit its contents, so `max-w-7xl` and the auto margins never
 * applied: the hero's width was whatever its own text measured. The headline
 * started at a different x from the logo above it and from every section below
 * it, and it **moved with the language**, because Bengali is the wider script.
 * It moved again whenever the copy or the figures changed length.
 *
 * Nothing over the source could see this. There is no overflow — the page does
 * not scroll sideways — no text is clipped, and each language looks
 * self-consistent until you put the two side by side. So it is measured, in a
 * browser, at a width where the hero is two columns, in both languages, against
 * a fixed part of the page.
 */
test.describe('the hero is aligned with the rest of the page', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const locale of LOCALES) {
    test(`${locale}: the headline starts where the logo does`, async ({ page }) => {
      await page.goto(url(locale, ''));
      await waitForContent(page);

      const edges = await page.evaluate(() => {
        const left = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().left) : null);
        const right = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().right) : null);
        // The hero's own content column, and a section further down that
        // renders from the same `container-wide`. These are the two boxes that
        // must agree; the logo is the human-legible way of saying so.
        const hero = document.querySelector('main section:first-of-type .container-wide');
        const below = document.querySelector('#about .container-wide');
        return {
          logo: left(document.querySelector('header img[src*="logo"]')),
          headline: left(document.querySelector('main h1')),
          heroLeft: left(hero),
          heroRight: right(hero),
          belowLeft: left(below),
          belowRight: right(below),
        };
      });

      expect(edges.logo, 'no logo found in the header').not.toBeNull();
      expect(edges.headline, 'no h1 found on the home page').not.toBeNull();

      // Two pixels of slack for sub-pixel rounding, and no more: the failure
      // this catches was ~200px.
      expect(
        Math.abs(edges.headline! - edges.logo!),
        `the headline starts at ${edges.headline} and the logo at ${edges.logo}. ` +
          'The hero is not sharing the site\'s content column — check that its ' +
          'container has `w-full`, because the section is a flex container and a ' +
          'flex item shrinks to its contents.',
      ).toBeLessThanOrEqual(2);

      // And the exact form of the same statement: the hero's container and the
      // container of a section below it are the same box.
      expect(
        { left: edges.heroLeft, right: edges.heroRight },
        'the hero\'s content column is not the same box as the section below it',
      ).toEqual({ left: edges.belowLeft, right: edges.belowRight });
    });
  }

  test('and is in the same place in both languages', async ({ page }) => {
    const measure = async (locale: string) => {
      await page.goto(url(locale, ''));
      await waitForContent(page);
      return page.evaluate(() => {
        // The container's box, not the headline's. A glyph's own left side
        // bearing differs between scripts — Bengali starts a pixel earlier
        // inside the same box — and that is typography, not layout. What must
        // not vary is the box.
        const c = document
          .querySelector('main section:first-of-type .container-wide')
          ?.getBoundingClientRect();
        return {
          left: Math.round(c?.left ?? -1),
          width: Math.round(c?.width ?? -1),
        };
      });
    };

    const en = await measure('en');
    const bn = await measure('bn');

    expect(
      bn,
      `the hero is laid out differently in Bengali (${JSON.stringify(bn)}) than in ` +
        `English (${JSON.stringify(en)}). Its width is being decided by its own text.`,
    ).toEqual(en);
  });
});

test.describe('dashboard pages · phone · bn', () => {
  test.skip(!hasDatabase(), 'Set DATABASE_URL (scripts/test-stack.sh env) to run the dashboard sweep.');
  test.use({ viewport: devices['Pixel 7'].viewport });

  test.beforeAll(async () => {
    await seedAccounts();
  });
  test.afterAll(async () => {
    await disconnect();
  });

  // Bengali on a phone is the hardest combination and the one every member
  // actually uses, so it gets the dashboard sweep. English on desktop is the
  // combination the pages were written in and is exercised by every other spec.
  for (const role of ['MEMBER', 'WORKER', 'ADMIN'] as const) {
    for (const path of PAGES[role]) {
      test(`${role} · /bn/${path} fits a 412px screen`, async ({ page }) => {
        test.setTimeout(90_000);
        await loginAs(page, role, 'bn');
        const response = await page.goto(`/bn/${path}`);
        expect(response?.status()).toBeLessThan(400);
        await waitForContent(page);

        const overflow = await horizontalOverflow(page);
        expect(overflow, `/bn/${path} scrolls ${overflow}px sideways on a phone`).toBeLessThanOrEqual(1);

        const keys = await untranslatedKeys(page);
        expect(keys, `/bn/${path} shows untranslated keys: ${keys.join(', ')}`).toEqual([]);
      });
    }
  }
});
