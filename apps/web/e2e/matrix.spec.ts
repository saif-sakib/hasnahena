import { test, expect, devices } from '@playwright/test';

import { hasDatabase, seedAccounts, disconnect } from './fixtures/accounts';
import { loginAs, PAGES, waitForContent, horizontalOverflow } from './fixtures/session';

/**
 * TEST-29 — every page, phone and desktop, English and Bengali (the wider
 * script): renders, no sideways scroll, no untranslated key, nothing clipped.
 * Failures name the page, locale and viewport.
 */

const VIEWPORTS = [
  // The handset this cooperative's members carry.
  { name: 'phone', size: devices['Pixel 7'].viewport },
  // What the office uses.
  { name: 'desktop', size: { width: 1280, height: 800 } },
] as const;

const LOCALES = ['en', 'bn'] as const;

/** The public URL a visitor types (English unprefixed, ADR-034) — written out, not imported. */
const url = (locale: string, path: string) => {
  const prefix = locale === 'en' ? '' : `/${locale}`;
  // No trailing slash (Next 308s `/bn/`).
  return path ? `${prefix}/${path}` : prefix || '/';
};

/** A message key rendered instead of its translation. */
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

/** Elements clipped by overflow:hidden (scroll containers excluded). */
async function clippedElements(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(el);
      if (style.overflowX !== 'hidden' && style.overflow !== 'hidden') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      // sr-only text is clipped by construction.
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
 * The logo fits its header — measured, with a ceiling (it once rendered at its
 * intrinsic 192×108 in a 64px header) and a floor.
 */
for (const viewport of VIEWPORTS) {
  test.describe(`the logo fits its header · ${viewport.name}`, () => {
    test.use({ viewport: viewport.size });

    for (const path of ['', 'privacy', 'terms', 'login', 'register']) {
      test(`${url('en', path) || '/'}`, async ({ page }) => {
        await page.goto(url('en', path));
        await waitForContent(page);

        const measured = await page.evaluate(() => {
          // On auth pages the logo is in the card (no header): width bound only.
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

        // A floor: below ~36px the Bengali tagline is unreadable.
        expect(
          measured!.logo,
          `the logo is only ${measured!.logo}px tall on ${url('en', path)} — the wordmark ` +
            'and its tagline cannot be read at that size',
        ).toBeGreaterThanOrEqual(36);

        // An oddly shaped uploaded logo must not push the language switcher off.
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
 * The hero's content column lines up with the rest of the page, in both
 * languages (as a flex item it once shrank to its text).
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
        // The hero's container vs one further down.
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
        // The container box, not the glyph (scripts differ in side bearing).
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

  // Dashboards: Bengali on a phone, the combination members actually use.
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
