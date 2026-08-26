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
 * One box, two audiences — the whole class of it, not the one that was reported.
 *
 * A `system_config` row holds one string and a visitor reads one of two
 * languages, so **any row an admin types prose into is shown to both** in
 * whichever script it was typed. This has been found four times:
 *
 *   - `org.address` (2026-08-25) — the foundation's Bengali address under an
 *     English "Address" heading on four public pages and on the English-only
 *     letterhead of every generated document (ADR-012);
 *   - `org.description` — which survived that fix by four months, because its
 *     only reader is the JSON-LD and no rendered-page test reads JSON-LD;
 *   - `org.name`, split into a pair before either of those;
 *   - twelve landing-page keys, found on 2026-08-26 by the T-09 audit — by
 *     enumerating, which is the point.
 *
 * Nothing else in the suite can see this. The string lives in the database, not
 * the repo, so no source census reaches it; and `e2e/locale-content.spec.ts`
 * strips admin-typed values before it looks, deliberately, so that it never goes
 * red on content somebody legitimately wrote. That is why this file enumerates
 * the pairs and checks the *plumbing* rather than the values.
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
    // A foundation that has not filled in the English box yet should show its
    // real address in the wrong script — a reader can still post a letter to
    // that — instead of an empty line or a plausible-looking invented address.
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
   * The three lists both halves have to be in, and what each one costs:
   *
   *   SYSTEM   — `PUT /api/v1/settings` rejects any key outside it, and rejects
   *              the *whole request* on one unknown key. A missing English twin
   *              therefore makes the form 400 on save for **every** field.
   *   PUBLIC   — `getPublicSettings()` selects only these, so a marketing page
   *              reads `undefined` and renders its hardcoded fallback forever.
   *   CONTENT
   *   or SETTINGS — exactly one of the two, or no admin can reach the box
   *              (neither) or two forms fight over one row (both).
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
        // Both halves belong on the *same* screen. Splitting a pair across
        // Content and Settings gives an admin one language on each, which is
        // the single-box bug wearing a second form.
        expect(
          onContent,
          `${bnKey} and ${enKey} are on different admin screens`,
        ).toBe((CONTENT_CONFIG_KEYS as readonly string[]).includes(bnKey));
      }
    });
  }
});

/**
 * The census that would have caught all four occurrences at once.
 *
 * A public page reading `settings['hero.tagline']` directly is the bug: the
 * value goes to the screen unchanged, whatever script it is in. Reading it
 * through `localizedSetting` is the fix, so this forbids the former.
 *
 * `settings-keys-read.test.ts` already refuses a key no admin screen can set.
 * This refuses a *pair* key read without its twin — the other direction, and the
 * one that has actually shipped.
 */
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

  // Deliberately short, and it must stay short. `lib/documents/org-settings.ts`
  // was on it for one afternoon and is not any more: it needs both halves, so it
  // calls `localizedSettingPair` instead. An exemption is where the fifth
  // occurrence of this bug would live.


  /**
   * Source with comments removed.
   *
   * A census that forbids a string has to search code, not prose. The first run
   * of this one failed on the login page's own explanation of the rule —
   * `// Through localizedSetting, not data['auth.welcomeBack']` — which is the
   * trap `requirements.test.ts` names: a detector that fires on its own rule
   * being written down teaches people to delete the documentation.
   */
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
            // The key named as a string literal, on a line that does not also
            // call the resolver. Per line rather than per file, and by literal
            // rather than by `settings['…']`, because the shape this has to
            // catch is not only the index expression: the JSON-LD builder read
            // `trimmed(settings, 'org.name')`, which an index-only pattern
            // walks straight past. `localizedSettingPair(…)` contains
            // `localizedSetting`, so it passes.
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

  /**
   * Seeding the landing copy is a position, taken on the owner's instruction
   * (2026-08-26) rather than a default.
   *
   * The pages read `messages/{en,bn}.json` when a setting is empty, so an
   * unseeded install *renders* correctly — and Admin → Content & Media shows a
   * screen of **empty boxes**, from which an admin cannot tell whether the site
   * has no copy or whether the form failed to load. Worse, saving from that
   * screen writes the emptiness back over anything that was there.
   *
   * The four figures were the exception for a day: seeded blank, on the
   * argument that a number the foundation has not stated is a number nobody
   * should invent for it. The owner settled it in the other direction — `135+`
   * members and estimates consistent with it — because the alternative on offer
   * was **counting them out of the ledger**, and the fund's real balances are
   * not for publication. They are seeded like every other pair now, and like
   * every other pair they are the foundation's to correct.
   */

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
    // Not "some words": a figure has to contain a digit, in the alphabet of the
    // language it is shown in. `stats.members` reading `135+` would put Latin
    // numerals on the Bengali home page, which is the same defect as Bengali
    // prose on the English one — and it is easy to do, because `135+` looks
    // finished.
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
     * The bug this is here for, in full, because a source census only makes
     * sense next to the story.
     *
     * The English halves of these pairs were brand new keys on 2026-08-26, so
     * `create` ran and they got their words. The Bengali halves already
     * existed — as **empty strings**. Admin → Content & Media POSTs every field
     * on save, so an admin who had once opened that screen while the boxes were
     * blank had written a blank row for each of them. `seedConfig` then said
     * "an operator outranks this file" and refused to touch a value nobody had
     * ever set.
     *
     * The result was `hero.tagline` empty beside `hero.taglineEn` filled: an
     * English page rendering correctly, a Bengali one silently on its
     * `messages/bn.json` fallback, and no way to repair it by re-running the
     * seed — which is what made it a bug in this function rather than in the
     * data. Reported by the owner as "Bangla is not seeded yet".
     *
     * An empty value is the absence of a decision, not a decision. A row that
     * holds one gets the default; a row that holds words keeps them.
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
    // The failure this catches is the quiet one: seeding the Bengali sentence
    // into both rows satisfies every check above and shows Bengali to English
    // readers on a fresh install — which is exactly the state the pairs were
    // introduced to end.
    //
    // The taka sign is the one exception, and it has to be: `৳` is U+09F3,
    // inside the Bengali block, and it is what a Bangladeshi reads a price in
    // whichever language the sentence is in — `৳25 Lakh+` is correct English
    // here. Every Bengali *letter* and *digit* is still refused, so seeding
    // `৳২৫ লক্ষ+` into the English row still fails, on its numerals.
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
    // `<Footer>` is a client component. Importing `system-config.ts` — which
    // imports Prisma — from here would pull the database client into the
    // browser bundle and break the build, which is the reason this module is
    // separate from the key registry in the first place.
    const source = read('lib/localized-settings.ts');
    expect(source).not.toMatch(/from '@\/lib\/(system-config|prisma)'/);
  });
});
