import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A marketing page must be renderable without a database.
 *
 * WO-73 made the ten public routes prerender, which moved their `system_config`
 * and `galleryItem` reads from request time to **build** time. The Docker image
 * is built with `DATABASE_URL` pointing at a placeholder database that does not
 * exist — the Dockerfile says so, and says why: `prisma generate` parses the URL
 * and never connects to it. That stayed true until these pages began reading
 * during the export, and then:
 *
 *     Error occurred prerendering page "/en/activities"
 *     Export encountered an error on /[locale]/donate/page: /en/donate
 *     ⨯ Next.js build worker exited with code: 1
 *
 * Six of the eight pages had no `try` of their own. The two that did — `/` and
 * `/gallery` — survived, which is why this presented as a bug in two pages
 * rather than as a missing contract on one function.
 *
 * The contract is here now: **no accessor rejects.** No database means fallback
 * copy and an empty gallery, which is a page, rather than a failed build or a
 * 500. A third accessor belongs in this file rather than growing its own `try`.
 * There briefly was one — `getPublicStats()`, which counted the hero's figures
 * out of the ledger — and it was deleted when the owner ruled that the fund's
 * real balances are not published. The contract outlived it.
 *
 * ── What this file can and cannot check ──────────────────────────────────────
 *
 * `unstable_cache` cannot run here. Called outside a Next server it throws
 * `Invariant: incrementalCache missing in unstable_cache`, and the very `catch`
 * under test swallows it — so the first version of this file passed with
 * `findMany` called **zero** times, asserting nothing about a database being
 * down. `next/cache` is therefore mocked to a pass-through, which puts the real
 * query on the real error path.
 *
 * That leaves one property the mock removes: that the failure is not *cached*.
 * `unstable_cache` stores resolved values and never rejections, so the `catch`
 * must sit outside it — inside, it would memoise the empty map and pin every
 * public page to its hardcoded fallback for the whole revalidate hour after one
 * transient Neon blip. With the cache mocked away there is no cache to observe,
 * so that half is checked against the source instead. It is a weaker check and
 * it is honest about being one; the behaviour it stands in for is verified by
 * building the app against an unreachable database, which is what CI does.
 */

const findManySettings = vi.fn();
const findManyGallery = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    systemConfig: { findMany: (...args: unknown[]) => findManySettings(...args) },
    galleryItem: { findMany: (...args: unknown[]) => findManyGallery(...args) },
  },
}));

vi.mock('next/cache', () => ({
  // Pass-through. See the note above: the real `unstable_cache` throws outside a
  // Next server, and this file's whole subject is a `catch`, so the real one
  // would make every assertion here vacuous.
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

const dead = () => Promise.reject(new Error('Database `placeholder` does not exist'));

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  findManySettings.mockReset();
  findManyGallery.mockReset();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
});

describe('the public accessors survive an unreachable database', () => {
  it('getPublicSettings() resolves to an empty map rather than rejecting', async () => {
    const { getPublicSettings } = await import('@/lib/system-config');
    findManySettings.mockImplementation(dead);

    await expect(getPublicSettings()).resolves.toEqual({});
    // Guards the mock itself: without this the assertion above is also
    // satisfied by never reaching the database at all, which is exactly how the
    // first draft of this file passed against unfixed code.
    expect(findManySettings, 'the query never ran, so nothing was proved').toHaveBeenCalled();
  });

  it('getPublicGalleryItems() resolves to an empty list rather than rejecting', async () => {
    const { getPublicGalleryItems } = await import('@/lib/public-content');
    findManyGallery.mockImplementation(dead);

    await expect(getPublicGalleryItems(6)).resolves.toEqual([]);
    expect(findManyGallery, 'the query never ran, so nothing was proved').toHaveBeenCalled();
  });

  it('still returns real rows when the database answers', async () => {
    const { getPublicSettings } = await import('@/lib/system-config');
    findManySettings.mockResolvedValue([{ key: 'org.name', value: 'Hasnahena Foundation' }]);

    await expect(getPublicSettings()).resolves.toEqual({ 'org.name': 'Hasnahena Foundation' });
  });

  it('says so in the log, so a build with no data is not silently empty', async () => {
    const { getPublicSettings } = await import('@/lib/system-config');
    findManySettings.mockImplementation(dead);

    await getPublicSettings();

    expect(errors).toHaveBeenCalled();
  });
});

describe('the catch is outside the cache, not inside it', () => {
  const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
  const read = (file: string) => readFileSync(resolve(WEB_ROOT, file), 'utf8');

  /** The `unstable_cache(...)` call and everything after it in the file. */
  const cachedRegion = (source: string) => {
    const start = source.indexOf('unstable_cache(');
    expect(start, 'no unstable_cache call found — has the accessor been rewritten?').toBeGreaterThan(
      -1,
    );
    return source.slice(start);
  };

  for (const file of ['lib/system-config.ts', 'lib/public-content.ts']) {
    it(`${file} does not swallow the error inside the cached function`, () => {
      const source = read(file);

      expect(
        cachedRegion(source),
        'the function passed to unstable_cache catches its own error. A caught ' +
          'error resolves, and a resolved value is what unstable_cache stores — so ' +
          'one failed read would serve the empty fallback for the whole revalidate ' +
          'window. Catch around the cached call instead.',
      ).not.toMatch(/\bcatch\s*\(/);

      expect(
        source.slice(0, source.indexOf('unstable_cache(')),
        'the exported accessor no longer catches anything, so an unreachable ' +
          'database fails the prerender and the Docker image cannot be built',
      ).toMatch(/\bcatch\s*\(/);
    });
  }
});
