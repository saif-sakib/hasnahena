import { test, expect, devices, type Page } from '@playwright/test';

/**
 * The home page reveal actually reveals. It once shipped twice doing nothing
 * (a CSS feature older Safari ignores), so the key assertion is the NEGATIVE:
 * below-the-fold elements are hidden before you scroll. No database needed.
 */

/** Every element the reveal system is responsible for. */
const REVEALED =
  '.reveal, .reveal-left, .reveal-right, .reveal-soft, .reveal-row > *, .reveal-row-4 > *';

/** Open the home page and wait for the last section (not networkidle — HMR never idles). */
async function openHome(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#donate').waitFor({ state: 'attached' });
  // Long enough for the client effect to have run — which is what the
  // reduced-motion and no-JavaScript cases need in order to prove a negative.
  await page.waitForTimeout(700);
}

async function opacities(page: Page) {
  return page.$$eval(REVEALED, (els) =>
    els.map((e) => parseFloat(getComputedStyle(e).opacity)),
  );
}

test.describe('home page section reveal', () => {
  test('is armed, and hides what has not been scrolled to yet', async ({ page }) => {
    await openHome(page);

    // The attribute that enables the hidden state at all.
    await expect(page.locator('html')).toHaveAttribute('data-reveal-js', '');

    const values = await opacities(page);
    expect(values.length).toBeGreaterThan(20);

    // The page opens on the hero, which carries no reveal, so everything the
    // system owns is still below the fold and must be waiting.
    const waiting = values.filter((o) => o < 0.05).length;
    expect(waiting).toBeGreaterThan(15);

    // Nothing may fade OUT at load (a transition on the hiding rule blinked
    // every element). Asserted as a direction — part-way can be a real reveal.
    const before = await opacities(page);
    await page.waitForTimeout(180);
    const after = await opacities(page);
    const droppers = before
      .map((o, i) => ({ from: o, to: after[i] }))
      .filter((x) => x.to < x.from - 0.01);
    expect(droppers, `elements fading out: ${JSON.stringify(droppers)}`).toEqual([]);
  });

  test('reveals each section as it is scrolled to, and leaves nothing faded', async ({
    page,
  }) => {
    await openHome(page);

    const height = await page.evaluate(() => document.body.scrollHeight);
    const stranded: { opacity: number; text: string }[] = [];

    for (let y = 0; y < height - 400; y += 500) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      // Longer than the 760ms transition, so anything still faded is stuck
      // rather than in flight.
      await page.waitForTimeout(950);

      stranded.push(
        ...(await page.$$eval(REVEALED, (els) =>
          els
            .map((e) => {
              const r = e.getBoundingClientRect();
              return {
                opacity: parseFloat(getComputedStyle(e).opacity),
                // "Being read" is fully on screen AND above the observer's
                // trigger line, which sits 8% up from the foot of the viewport.
                onScreen: r.top > 0 && r.bottom < innerHeight && r.top < innerHeight * 0.88,
                text: (e.textContent || '').trim().slice(0, 40),
              };
            })
            .filter((x) => x.onScreen && x.opacity < 0.9)
            .map(({ opacity, text }) => ({ opacity, text })),
        )),
      );
    }

    expect(stranded, `faded while being read: ${JSON.stringify(stranded.slice(0, 4))}`).toEqual(
      [],
    );

    // By the foot of the page everything has arrived.
    expect((await opacities(page)).filter((o) => o < 0.95)).toHaveLength(0);
  });

  test('cascades a card row rather than revealing it all at once', async ({ page }) => {
    await openHome(page);

    const height = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < height; y += 500) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(900);

    // Stagger read from animationDelay (first of two animations); 3- and
    // 4-column grids are separate cycles.
    for (const [selector, expected] of [
      ['#features .reveal-row-4 > *', 4],
      ['#about .reveal-row > *', 3],
    ] as const) {
      const delays = (
        await page.$$eval(selector, (els) =>
          els.map((e) => parseFloat(getComputedStyle(e).animationDelay.split(',')[0])),
        )
      ).slice(0, expected);

      expect(delays).toHaveLength(expected);
      for (let i = 1; i < delays.length; i += 1) {
        expect(delays[i], `column ${i + 1} of ${selector}`).toBeGreaterThan(delays[i - 1]);
      }
    }
  });

  test('arms again when you scroll back up past it', async ({ page }) => {
    await openHome(page);

    const cards = page.locator('#about .reveal-row > *');
    const opacityOf = () =>
      cards.evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).opacity)));

    const sectionTop = await page.evaluate(
      () => window.scrollY + document.getElementById('about')!.getBoundingClientRect().top,
    );

    // Down to it: it arrives.
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), sectionTop + 250);
    await page.waitForTimeout(1200);
    expect((await opacityOf()).every((o) => o > 0.95)).toBe(true);

    // Back to the top: it must be armed again, or the second visit is static —
    // which is exactly what was reported once the reveal finally worked at all.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(700);
    expect((await opacityOf()).some((o) => o < 0.05)).toBe(true);

    // And down again: it plays a second time.
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), sectionTop + 250);
    await page.waitForTimeout(1200);
    expect((await opacityOf()).every((o) => o > 0.95)).toBe(true);
  });

  test('phone width reveals too — this site is read on a phone', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    await openHome(page);

    await expect(page.locator('html')).toHaveAttribute('data-reveal-js', '');
    expect((await opacities(page)).filter((o) => o < 0.05).length).toBeGreaterThan(15);

    const y = await page.evaluate(
      () => window.scrollY + document.getElementById('about')!.getBoundingClientRect().top,
    );
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y + 200);
    await page.waitForTimeout(1200);

    const arrived = await page.$$eval('#about .reveal-row > *', (els) =>
      els.filter((e) => parseFloat(getComputedStyle(e).opacity) > 0.95).length,
    );
    expect(arrived).toBeGreaterThan(0);
    await context.close();
  });
});

/**
 * Reduced motion: a finished page and no observer. emulateMedia, and the
 * precondition is asserted first — a negative needs its condition proven.
 */
test('reduced motion: nothing is hidden and no observer is armed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);

  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'the emulation is actually in force',
  ).toBe(true);

  await expect(page.locator('html')).not.toHaveAttribute('data-reveal-js', '');
  expect((await opacities(page)).filter((o) => o < 1)).toHaveLength(0);
});

/** Without JavaScript the page is finished, never blank — hiding needs the JS-set attribute. */
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('renders the whole page visible', async ({ page }) => {
    await openHome(page);
    expect((await opacities(page)).filter((o) => o < 0.95)).toHaveLength(0);
  });
});
