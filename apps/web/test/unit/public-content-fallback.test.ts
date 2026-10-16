import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A marketing page must render without a database (the Docker build has none):
 * no public accessor rejects. next/cache is mocked to a pass-through — the real
 * unstable_cache throws outside Next and the catch would hide it — so "not
 * cached" (catch OUTSIDE the cache) is checked against the source instead.
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
  // Pass-through (see above).
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
    // Guards the mock: the query must actually have run.
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
