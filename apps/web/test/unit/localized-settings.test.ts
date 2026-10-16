import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  LOCALIZED_SETTING_PAIRS,
  localizedSetting,
  orgAddress,
  orgDescription,
  orgName,
} from '@/lib/localized-settings';
import {
  SYSTEM_CONFIG_KEYS,
  PUBLIC_CONFIG_KEYS,
  CONTENT_CONFIG_KEYS,
  SETTINGS_CONFIG_KEYS,
} from '@/lib/system-config';

/**
 * One box, two audiences: any prose row is shown to both languages in the
 * script it was typed in (found four times, key by key). This enumerates the
 * pairs and checks the plumbing — the values live in the database.
 */

const REPO = resolve(process.cwd(), '..', '..');
const WEB = join(REPO, 'apps', 'web');
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8');

describe('the prose settings are pairs', () => {
  const both = { 'org.address': 'ভেকুটিয়া, সদর, যশোর', 'org.addressEn': 'Bhekutia, Sadar, Jashore' };

  it('gives each language its own script', () => {
    expect(orgAddress(both, 'en')).toBe('Bhekutia, Sadar, Jashore');
    expect(orgAddress(both, 'bn')).toBe('ভেকুটিয়া, সদর, যশোর');
  });

  it('treats an unknown locale as English, like every other locale decision', () => {
    expect(orgAddress(both, 'fr')).toBe('Bhekutia, Sadar, Jashore');
    expect(orgAddress(both, '')).toBe('Bhekutia, Sadar, Jashore');
  });

  it('falls back to the other script rather than to nothing', () => {
    // An unfilled English box falls back to the real (Bengali) value, never invented.
    expect(orgAddress({ 'org.address': 'ভেকুটিয়া, সদর, যশোর' }, 'en')).toBe('ভেকুটিয়া, সদর, যশোর');
    expect(orgAddress({ 'org.addressEn': 'Bhekutia, Sadar, Jashore' }, 'bn')).toBe(
      'Bhekutia, Sadar, Jashore',
    );
  });

  it('is empty when nothing is set, so a caller can choose its own fallback', () => {
    expect(orgAddress({}, 'en')).toBe('');
    expect(orgAddress(undefined, 'bn')).toBe('');
    expect(orgAddress({ 'org.address': '   ' }, 'en')).toBe('');
  });

  it('resolves every declared pair the same way, not just the org ones', () => {
    for (const [bnKey, enKey] of LOCALIZED_SETTING_PAIRS) {
      const settings = { [bnKey]: 'বাংলা', [enKey]: 'English' };
      expect(localizedSetting(settings, bnKey, 'bn'), bnKey).toBe('বাংলা');
      expect(localizedSetting(settings, bnKey, 'en'), enKey).toBe('English');
      // Each half rescues the other, in both directions.
      expect(localizedSetting({ [bnKey]: 'বাংলা' }, bnKey, 'en')).toBe('বাংলা');
      expect(localizedSetting({ [enKey]: 'English' }, bnKey, 'bn')).toBe('English');
    }
  });

  it('names the org helpers as pairs too, so no caller reads a bare key', () => {
    const settings = {
      'org.name': 'হাসনাহেনা ফাউন্ডেশন',
      'org.nameEn': 'Hasnahena Foundation',
      'org.description': 'বাংলা বিবরণ',
      'org.descriptionEn': 'English description',
    };
    expect(orgName(settings, 'en')).toBe('Hasnahena Foundation');
    expect(orgName(settings, 'bn')).toBe('হাসনাহেনা ফাউন্ডেশন');
    expect(orgDescription(settings, 'en')).toBe('English description');
    expect(orgDescription(settings, 'bn')).toBe('বাংলা বিবরণ');
  });
});

describe('every pair is reachable from an admin screen and by a public page', () => {
  /**
   * Both halves must be in SYSTEM (or saves 400), PUBLIC (or pages show
   * fallbacks), and exactly one of CONTENT/SETTINGS.
   */
  for (const [bnKey, enKey] of LOCALIZED_SETTING_PAIRS) {
    it(`${bnKey} travels with ${enKey}`, () => {
      for (const key of [bnKey, enKey]) {
        expect(SYSTEM_CONFIG_KEYS as readonly string[], `${key} is not a declared key`).toContain(
          key,
        );
        expect(
          PUBLIC_CONFIG_KEYS as readonly string[],
          `${key} is not public, so the page that renders it reads undefined`,
        ).toContain(key);

        const onContent = (CONTENT_CONFIG_KEYS as readonly string[]).includes(key);
        const onSettings = (SETTINGS_CONFIG_KEYS as readonly string[]).includes(key);
        expect(
          onContent !== onSettings,
          `${key} is on ${onContent && onSettings ? 'both admin screens' : 'neither admin screen'}`,
        ).toBe(true);
        // Both halves on the SAME screen.
        expect(
          onContent,
          `${bnKey} and ${enKey} are on different admin screens`,
        ).toBe((CONTENT_CONFIG_KEYS as readonly string[]).includes(bnKey));
      }
    });
  }
});

/** No page reads half of a pair: a pair key must go through localizedSetting. */
describe('no page reads half of a pair', () => {
  const SEARCH_DIRS = ['app', 'components', 'lib'];

  /** Files that legitimately name a bare key. */
  const ALLOWED = new Set([
    // The registry itself, the resolver, and the tests that read them.
    'lib/system-config.ts',
    'lib/localized-settings.ts',
    'lib/contact-details.ts',
    // The admin screens *write* these rows; a form field is bound to one key by
    // definition, and the pair is what `localizedField` renders two of.
    'components/dashboard/screens/content-screen.tsx',
    'app/[locale]/dashboard/admin/settings/page.tsx',
  ]);

  // Keep this list short — an exemption is where the next occurrence hides.


  /** Source with comments removed, so the census reads code, not prose. */
  const codeOf = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  function sources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
      }
    };
    for (const dir of SEARCH_DIRS) walk(join(WEB, dir));
    return out;
  }

  it('reads every prose setting through localizedSetting()', () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const rel = relative(WEB, file);
      if (ALLOWED.has(rel)) continue;
      const lines = codeOf(readFileSync(file, 'utf8')).split('\n');
      for (const [bnKey, enKey] of LOCALIZED_SETTING_PAIRS) {
        for (const key of [bnKey, enKey]) {
          for (const line of lines) {
            // A pair key as a literal on a line that does not call the resolver
            // (catches trimmed(settings, 'org.name') too).
            if (!line.includes(`'${key}'`) && !line.includes(`"${key}"`)) continue;
            if (line.includes('localizedSetting')) continue;
            offenders.push(`${rel}: ${line.trim().slice(0, 70)}`);
          }
        }
      }
    }
    expect(
      offenders,
      'these read a prose setting straight out of the map, so whatever script an ' +
        'admin typed goes to both audiences — the org.address bug. Read it through ' +
        'localizedSetting(settings, key, locale) instead:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('is not vacuous — the pairs list is real and non-trivial', () => {
    // A regex that matches nothing, or an emptied list, makes the assertion
    // above pass forever.
    expect(LOCALIZED_SETTING_PAIRS.length).toBeGreaterThan(10);
    expect(sources().length).toBeGreaterThan(50);
    // The resolver is actually used by the pages, rather than declared and
    // forgotten.
    const callers = sources().filter((file) =>
      readFileSync(file, 'utf8').includes('localizedSetting('),
    );
    expect(callers.length, 'nothing calls localizedSetting()').toBeGreaterThan(1);
  });
});

describe('every pair is seeded, so a fresh install has words on it', () => {
  const seed = read('scripts/seed.mjs');

  /** Every pair is seeded, both halves, with real words (owner's instruction). */

  for (const [bnKey, enKey] of LOCALIZED_SETTING_PAIRS) {
    it(`${bnKey} and ${enKey} both have a seed row`, () => {
      for (const key of [bnKey, enKey]) {
        expect(
          seed,
          `scripts/seed.mjs has no row for ${key}. Both halves of a pair must be seeded ` +
            'together — seeding one puts that language in front of both audiences, which ' +
            'is the bug the pair exists to prevent.',
        ).toContain(`key: '${key}'`);
      }
    });
  }

  it('seeds the copy with real words and the figures with nothing', () => {
    // A row per key is not enough on its own: `value: ''` for a *sentence*
    // would satisfy the check above and still leave the admin screen blank.
    const rowValue = (key: string): string | null => {
      const match = seed.match(
        new RegExp(`key:\\s*'${key.replace('.', '\\.')}'\\s*,\\s*value:\\s*(['"\`])([\\s\\S]*?)\\1`),
      );
      if (match) return match[2];
      // The multi-line object form, where `value` is on its own line.
      const block = seed.match(
        new RegExp(`key:\\s*'${key.replace('.', '\\.')}'[\\s\\S]{0,400}?value:\\s*\\n?\\s*(['"\`])([\\s\\S]*?)\\1`),
      );
      return block ? block[2] : null;
    };

    for (const [bnKey, enKey] of LOCALIZED_SETTING_PAIRS) {
      for (const key of [bnKey, enKey]) {
        const value = rowValue(key);
        expect(value, `could not read the seeded value for ${key}`).not.toBeNull();
        expect(value!.trim().length, `${key} is seeded empty`).toBeGreaterThan(0);
      }
    }
  });

  it('seeds the four figures with a number in each script', () => {
    // A figure needs a digit in the alphabet of its language.
    const rowValue = (key: string) =>
      seed.match(new RegExp(`key:\\s*'${key.replace('.', '\\.')}'\\s*,\\s*value:\\s*'([^']*)'`))?.[1] ?? null;

    for (const figure of ['members', 'deposits', 'loans', 'charity']) {
      const bn = rowValue(`stats.${figure}`);
      const en = rowValue(`stats.${figure}En`);
      expect(bn, `stats.${figure} has no seeded value`).not.toBeNull();
      expect(en, `stats.${figure}En has no seeded value`).not.toBeNull();
      expect(bn, `stats.${figure} is not written in Bengali numerals`).toMatch(/[০-৯]/u);
      expect(en, `stats.${figure}En is not written in Latin numerals`).toMatch(/[0-9]/u);
      expect(en, `stats.${figure}En carries Bengali numerals`).not.toMatch(/[০-৯]/u);
    }
  });

  it('fills a row that exists and is blank', () => {
    /*
     * seedConfig must backfill EMPTY rows: Content & Media saves every field, so
     * blank rows existed that a create-only seed could never fill.
     */
    const body = seed.slice(seed.indexOf('async function seedConfig'));
    const fn = body.slice(0, body.indexOf('\n}'));

    expect(
      fn,
      'seedConfig no longer looks at what the stored value is. If it only ever ' +
        'refreshes the description, a config row that exists and is blank can ' +
        'never be repaired by re-running the seed — which is how the whole ' +
        'Bengali half of the public site stayed empty.',
    ).toMatch(/\.trim\(\)\s*===\s*''/);

    expect(
      fn,
      'seedConfig never writes `value` to an existing row, so a blank one stays blank',
    ).toMatch(/\{\s*value,\s*description\s*\}/);
  });

  it('seeds each half in its own script', () => {
    // No Bengali letters or digits in the English half (৳ U+09F3 excepted).
    const bengali = /[\u0980-\u09F2\u09F4-\u09FF]/;
    for (const [, enKey] of LOCALIZED_SETTING_PAIRS) {
      const en = seed.match(
        new RegExp(`key:\\s*'${enKey.replace('.', '\\.')}'[\\s\\S]{0,400}?value:\\s*\\n?\\s*'([\\s\\S]*?)'`),
      );
      expect(en, `no seeded value found for ${enKey}`).toBeTruthy();
      expect(
        bengali.test(en![1]),
        `${enKey} is seeded with Bengali text: "${en![1].slice(0, 40)}"`,
      ).toBe(false);
    }
  });
});

describe('the module the footer imports stays free of Prisma', () => {
  it('does not import lib/system-config or lib/prisma', () => {
    // The footer is a client component: this module must not import Prisma.
    const source = read('lib/localized-settings.ts');
    expect(source).not.toMatch(/from '@\/lib\/(system-config|prisma)'/);
  });
});
