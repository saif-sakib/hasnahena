import { test, expect, devices, type Page } from '@playwright/test';

/**
 * The section reveal on the home page actually reveals something.
 *
 * This spec exists because the reveal shipped **twice** doing nothing at all,
 * and was reported both times in the same words: "everything is loaded
 * previously and shown as static". It was written as a scroll-driven CSS
 * animation inside `@supports (animation-timeline: view())` — correct, elegant,
 * and on an engine without that feature (Safari before 26, Firefox before 144)
 * the entire block is skipped. The page renders in its finished state, which is
 * exactly what it looked like before the feature was added.
 *
 * Nothing over the source could see it. It typechecks, it lints, the CSS is in
 * the bundle, and the two fixes in between were both applied to a block that
 * was never running for the reader who filed the report. **A feature that
 * degrades to nothing degrades silently, and looks identical to not having
 * built it.** So the assertion that matters is the negative one: below-the-fold
 * elements must actually be HIDDEN before you scroll to them. Everything else
 * here is about not overcorrecting into content a reader cannot read.
 *
 * No database: the home page falls back to empty settings when Prisma cannot
 * reach one, so this runs against a bare `next dev`.
 */

/** Every element the reveal system is responsible for. */
const REVEALED =
  '.reveal, .reveal-left, .reveal-right, .reveal-soft, .reveal-row > *, .reveal-row-4 > *';

/**
 * Open the home page and wait for it to have settled.
 *
 * Deliberately not `networkidle`: under `next dev` the HMR socket never goes
 * idle, and this spec's reduced-motion case timed out on it while the five
 * around it happened to win the race. Waiting for the last section to exist is
 * both faster and actually about this page.
 */
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

    // The attribute is set by `components/ui/scroll-reveal.tsx` and is the only
    // thing that enables the hidden state. No attribute means no reveal — which
    // is the failure this spec is named after.
    await expect(page.locator('html')).toHaveAttribute('data-reveal-js', '');

    const values = await opacities(page);
    expect(values.length).toBeGreaterThan(20);

    // The page opens on the hero, which carries no reveal, so everything the
    // system owns is still below the fold and must be waiting.
    const waiting = values.filter((o) => o < 0.05).length;
    expect(waiting).toBeGreaterThan(15);

    // And nothing may be fading OUT.
    //
    // The hiding rule deliberately carries no `transition`. When it did,
    // applying the attribute to an already-painted page transitioned
    // twenty-nine elements from 1 down to 0 — a visible blink at load, before
    // anything had been revealed at all.
    //
    // Asserted as a DIRECTION rather than as "nothing is part-way", because
    // part-way is also what a legitimate reveal looks like: on a short viewport
    // the first row is already crossing the trigger line while this runs, and
    // the strict form failed on ten elements sitting at 0.915 on their way up.
    // Only a decrease is the bug.
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

    // Measured on the arrival rule rather than caught mid-transition, which is
    // a race on a fast machine. Three columns and four columns are two separate
    // cycles: sharing the 3n one put card 4 back on card 1's delay, and a
    // fourth card arriving with the first reads as a rendering fault.
    for (const [selector, expected] of [
      ['#features .reveal-row-4 > *', 4],
      ['#about .reveal-row > *', 3],
    ] as const) {
      const delays = (
        await page.$$eval(selector, (els) =>
          els.map((e) => parseFloat(getComputedStyle(e).transitionDelay)),
        )
      ).slice(0, expected);

      expect(delays).toHaveLength(expected);
      for (let i = 1; i < delays.length; i += 1) {
        expect(delays[i], `column ${i + 1} of ${selector}`).toBeGreaterThan(delays[i - 1]);
      }
    }
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
 * Somebody who has asked their system for less motion gets a finished page,
 * not a hidden one — and no observer is constructed for them either.
 *
 * `page.emulateMedia` rather than `test.use({ reducedMotion })`: the fixture
 * form did not reach the page under this project's config, and the test still
 * passed its first assertion for the wrong reason. So the precondition is
 * asserted first — a spec that proves a negative has to prove that the
 * condition it is testing was actually in force, or it passes forever on a
 * browser that never heard the question.
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

/**
 * And the property the whole design is built on: the hidden state is scoped to
 * an attribute only JavaScript sets, so a reader whose JavaScript never arrives
 * gets the page finished rather than blank. This is the check that stops
 * somebody "simplifying" the CSS by hiding things by default.
 */
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('renders the whole page visible', async ({ page }) => {
    await openHome(page);
    expect((await opacities(page)).filter((o) => o < 0.95)).toHaveLength(0);
  });
});
