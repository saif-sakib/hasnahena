import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The Settings screen's DEFAULT_ORG_SETTINGS must equal seed.mjs: the screen
 * POSTS its defaults back on save, so it is a writer, not a display fallback.
 * lib/documents/theme.ts's DEFAULT_ORG (English-only fields) is deliberately
 * not compared.
 */

const REPO = resolve(process.cwd(), '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const SEED = 'apps/web/scripts/seed.mjs';
const SETTINGS_SCREEN = 'apps/web/app/[locale]/dashboard/admin/settings/page.tsx';

/** The `org.*` rows in seed.mjs, in both the one-line and the block spelling. */
function seededOrgValues(): Map<string, string> {
  const source = read(SEED);
  const out = new Map<string, string>();
  for (const m of source.matchAll(/key:\s*'(org\.[A-Za-z]+)',\s*\n?\s*value:\s*'([^']*)'/g)) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** `DEFAULT_ORG_SETTINGS` on the Settings screen, as a `org.foo` → value map. */
function screenOrgValues(): Map<string, string> {
  const source = read(SETTINGS_SCREEN);
  const block = source.match(/const DEFAULT_ORG_SETTINGS = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error(`DEFAULT_ORG_SETTINGS not found in ${SETTINGS_SCREEN}`);
  const out = new Map<string, string>();
  // Values may be wrapped onto the next line by the formatter.
  for (const m of block[1].matchAll(/^\s{2}([A-Za-z]+):\s*\n?\s*'([^']*)',/gm)) {
    out.set(`org.${m[1]}`, m[2]);
  }
  return out;
}

describe('the organisation defaults in the seed and in the Settings screen', () => {
  const seeded = seededOrgValues();
  const screen = screenOrgValues();

  it('parses both files it is comparing', () => {
    // Guards the parser: matching nothing would make this vacuous.
    expect(seeded.size, `no org.* rows parsed out of ${SEED}`).toBeGreaterThan(6);
    expect(screen.size, `no fields parsed out of DEFAULT_ORG_SETTINGS`).toBeGreaterThan(6);
  });

  it('covers both halves of every prose pair', () => {
    // The pairs are the whole reason this file exists. A key that stops being
    // seeded drops out of the comparison below silently, so name them.
    for (const key of [
      'org.name',
      'org.nameEn',
      'org.address',
      'org.addressEn',
      'org.description',
      'org.descriptionEn',
    ]) {
      expect(seeded.has(key), `${key} is no longer seeded in ${SEED}`).toBe(true);
      expect(screen.has(key), `${key} has no default on the Settings screen`).toBe(true);
    }
  });

  it.each([...seededOrgValues().keys()])('%s is the same in both', (key) => {
    const fromScreen = screen.get(key);
    if (fromScreen === undefined) return; // seeded but not offered by this screen
    expect(
      fromScreen,
      `${key} differs between the seed and the Settings screen. The screen POSTS its ` +
        `default on save, so the disagreement is not cosmetic — whichever value is wrong ` +
        `gets written to the live database the next time an admin saves that form.\n` +
        `  ${SEED}: ${JSON.stringify(seeded.get(key))}\n` +
        `  ${SETTINGS_SCREEN}: ${JSON.stringify(fromScreen)}`,
    ).toBe(seeded.get(key));
  });
});
