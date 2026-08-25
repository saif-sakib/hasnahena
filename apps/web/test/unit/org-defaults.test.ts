import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The organisation's default identity exists twice, and the two copies must agree.
 *
 * `scripts/seed.mjs` writes the `org.*` rows a fresh database starts with. The
 * admin Settings screen holds its own `DEFAULT_ORG_SETTINGS` for a row the
 * database does *not* have — and, crucially, **posts that value back on save**.
 * So the screen's copy is not a display fallback: it is a writer. An admin who
 * changes the phone number and presses Save writes every other box too.
 *
 * Until 2026-08-25 the two disagreed about the foundation's own name. The
 * screen said `Hasnahena` / `হাসনাহেনা`; the seed said `Hasnahena Foundation` /
 * `হাসনাহেনা ফাউন্ডেশন`. The short form is what the live site published in its
 * JSON-LD, and T-03 recorded it as a settings row somebody had typed wrongly —
 * it was not. Nobody typed it. Fixing the row by hand would have fixed it until
 * the next time an admin saved that screen, which is the definition of a defect
 * that comes back.
 *
 * This is the same shape as `donation-pool-owner.test.ts`: a value that must be
 * identical in a seed script and in application code, where nothing at runtime
 * would ever notice them diverging.
 *
 * **`lib/documents/theme.ts` holds a third copy and is deliberately not compared
 * here.** Its `DEFAULT_ORG` is the *documents'* `OrgSettings`, which is English
 * only by [ADR-012], so its `address` field carries the English address — the
 * same field name meaning a different thing. Comparing them would need a
 * per-field exception list, which is the kind of test that gets switched off.
 * Its overlapping values do agree, and `getOrgNameEn()` there already carries a
 * hand-written guard against the exact short name this file now prevents:
 * `name.toLowerCase() === 'hasnahena' ? BRAND_NAME_EN : name`. Somebody saw the
 * wrong name reach a PDF and defended the PDF instead of the source.
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
    // A regex that quietly matches nothing would make every assertion below
    // vacuous — this suite would then pass most loudly at the moment it stopped
    // being able to see the thing it guards.
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
