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
