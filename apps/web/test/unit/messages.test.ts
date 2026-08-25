import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// TEST-39 / WO-51 — EN/BN message parity, pinned.
//
// **This is an enumerating suite. It is SUPPOSED to fail when you add a key to
// one messages file and not the other.** That is not a broken test; it is the
// test working. Add the key to both files — do not delete the assertion, and do
// not paste the English string into `bn.json` to make it pass, because
// assertion 3 below exists precisely to catch that.
//
// product.md states "Full EN/BN parity on all user-facing strings" as a quality
// bar and nothing enforced it. The two files held 300 keys each and were fully
// translated on the day this was written, which is the cheapest moment to pin
// it: the check costs nothing to add now and a reconciliation later.
//
// The browser matrix (`e2e/matrix.spec.ts`) does catch an untranslated key, but
// only on a page it happens to visit, in a locale it happens to render, and
// only once the key has already reached a screen. This catches it at
// `pnpm test:unit`, in under a second, with no database and no browser.

const REPO = resolve(process.cwd(), '..', '..');
const WEB_ROOT = join(REPO, 'apps', 'web');
const readMessages = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(REPO, 'apps/web/messages', `${locale}.json`), 'utf8'));

/** `{ nav: { home: 'Home' } }` → `{ 'nav.home': 'Home' }`. */
function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    out.set(prefix, String(value));
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    for (const [k, v] of flatten(child, path)) out.set(k, v);
  }
  return out;
}

const en = flatten(readMessages('en'));
const bn = flatten(readMessages('bn'));

/**
 * Keys whose two values are *correctly* byte-identical: brand names, currency
 * codes and other strings that are the same in both languages by design.
 *
 * Empty today — every one of the 300 keys differs between the files. Add a key
 * here only when the identical value is deliberate, and say why on the line.
 */
const IDENTICAL_BY_DESIGN = new Set<string>([]);

/**
 * Above this length, an identical value is a copy-paste rather than a word that
 * happens to be the same in both languages. "BDT" and "Hasnahena" are short;
 * a forgotten sentence is not.
 */
const COPY_PASTE_LENGTH = 25;

/** `{amount}` — next-intl's ICU placeholders. */
const PLACEHOLDER = /\{\s*([a-zA-Z0-9_]+)\s*[,}]/g;
const placeholdersIn = (value: string) => new Set([...value.matchAll(PLACEHOLDER)].map((m) => m[1]));

const list = (keys: Iterable<string>) => [...keys].sort().join('\n  ');

describe('EN/BN message parity', () => {
  it('has the same keys in both files', () => {
    const missingFromBn = [...en.keys()].filter((k) => !bn.has(k));
    const missingFromEn = [...bn.keys()].filter((k) => !en.has(k));

    // Named, not counted. "283 !== 284" is not a bug report — the point of this
    // suite is that the failure tells you which key to go and write.
    expect(
      missingFromBn,
      `${missingFromBn.length} key(s) in en.json with no bn.json translation:\n  ${list(missingFromBn)}`,
    ).toEqual([]);
    expect(
      missingFromEn,
      `${missingFromEn.length} key(s) in bn.json with no en.json counterpart:\n  ${list(missingFromEn)}`,
    ).toEqual([]);
  });

  it('has no long Bengali value left byte-identical to the English one', () => {
    const untranslated = [...en.keys()].filter((key) => {
      if (IDENTICAL_BY_DESIGN.has(key)) return false;
      const source = en.get(key);
      const target = bn.get(key);
      if (source === undefined || target === undefined) return false;
      return source === target && source.length > COPY_PASTE_LENGTH;
    });

    expect(
      untranslated,
      `${untranslated.length} bn.json value(s) are still the English string. Translate them, or ` +
        `add the key to IDENTICAL_BY_DESIGN with a reason if it is correct:\n  ${list(untranslated)}`,
    ).toEqual([]);
  });

  it('carries every {placeholder} through to the Bengali string', () => {
    const dropped: string[] = [];
    for (const [key, source] of en) {
      const target = bn.get(key);
      if (target === undefined) continue;
      const expected = placeholdersIn(source);
      const actual = placeholdersIn(target);
      const missing = [...expected].filter((p) => !actual.has(p));
      const extra = [...actual].filter((p) => !expected.has(p));
      // A dropped {amount} renders the literal braces to a member; an invented
      // one renders as an ICU error or an empty string.
      if (missing.length) dropped.push(`${key} — bn is missing {${missing.join('}, {')}}`);
      if (extra.length) dropped.push(`${key} — bn has {${extra.join('}, {')}} which en does not`);
    }

    expect(dropped, `placeholder mismatches:\n  ${dropped.join('\n  ')}`).toEqual([]);
  });

  it('is not empty — a suite that reads nothing passes forever', () => {
    expect(en.size).toBeGreaterThan(250);
    expect(bn.size).toBe(en.size);
  });
});


// ---------------------------------------------------------------------------
// Rule 3, in the copy members actually read
// ---------------------------------------------------------------------------

/**
 * Zero interest and zero fees is a Shariah requirement, not a pricing choice
 * (CLAUDE.md rule 3). The code has been guarded for a long time: `applicationFee`
 * is `BigInt(0)` on every application, a CHECK constraint rejects a non-zero
 * one, `internal/money` computes no rate, and `requirements.test.ts` searches the
 * Go and TypeScript source for the word "markup".
 *
 * **None of that reads the prose.** The Terms of Service told every member, in
 * both languages, that loans "are interest-free but may include administrative
 * fees" — a promise the platform cannot keep and would violate its own rule to
 * keep. It survived every existing guard because it is a string in a page, and
 * it was found by a census written for something else entirely.
 *
 * So this reads the prose. It is deliberately a search for the *promise of a
 * charge* rather than for the word "fee": the copy has to be able to say "no
 * processing fee", which is the whole point.
 */
describe('no member-facing page promises a fee', () => {
  const PAGES = join(WEB_ROOT, 'app');

  function pageFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...pageFiles(full));
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  /**
   * Phrases that assert a charge exists. Each is the affirmative form — "may
   * include a fee", "চার্জ প্রযোজ্য" — so a sentence denying one passes.
   */
  const PROMISES_A_CHARGE = [
    /may\s+include\s+[\w\s]*fee/i,
    /(?<!no\s)(?<!zero\s)(?:administrative|processing|service|application)\s+fees?\s+(?:apply|will|are\s+charged)/i,
    /interest[- ]free\s+but/i,
    /সুদমুক্ত\s+কিন্তু/,
    /ফি\s+(?:প্রযোজ্য|অন্তর্ভুক্ত\s+থাকতে\s+পারে)/,
    /চার্জ\s+প্রযোজ্য/,
  ];

  /**
   * The pages **and the message files** — WO-96 made the second half necessary.
   *
   * This census used to walk `app/` alone, which was complete only because
   * almost all the copy lived there. Moving 73 auth strings into
   * `messages/{en,bn}.json` moved them out of its reach, and the remaining 827
   * inline strings in the dashboard will move the same way. A rule-3 promise is
   * exactly as dangerous in a message file as in a component; the difference is
   * that a member reads it either way.
   */
  function copySources(): string[] {
    return [
      ...pageFiles(PAGES),
      join(WEB_ROOT, 'messages', 'en.json'),
      join(WEB_ROOT, 'messages', 'bn.json'),
    ];
  }

  it('says nothing that commits the foundation to charging one', () => {
    const offenders: string[] = [];
    for (const file of copySources()) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of PROMISES_A_CHARGE) {
        const hit = text.match(pattern);
        if (hit) offenders.push(`${relative(WEB_ROOT, file)}: ${hit[0]}`);
      }
    }
    expect(
      offenders,
      'Rule 3 is a Shariah requirement, not a pricing decision. A page that ' +
        'tells a member a fee may apply describes a charge the platform cannot ' +
        'make: applicationFee is BigInt(0) everywhere and the database rejects ' +
        'anything else. This reads the message files as well as the pages — ' +
        'moving the sentence into messages/{en,bn}.json is not a fix.\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('the terms page states the rule positively in both languages', () => {
    // The absence check above passes on a page that says nothing at all. This
    // is the other half: the one page a member reads before borrowing has to
    // say what the rule is.
    const terms = readFileSync(join(PAGES, '[locale]', 'terms', 'page.tsx'), 'utf8');
    expect(terms).toMatch(/no\s+(?:administrative|processing)/i);
    expect(terms).toContain('সুদমুক্ত');
  });
});

/**
 * WO-96 — the auth pages stop hiding their copy from every check in this file.
 *
 * CLAUDE.md rule 5: *"UI copy lives in `apps/web/messages/{en,bn}.json` — both
 * files, never hardcoded in a component."* Counted 2026-08-24, the two worst
 * offenders were the login page (28 inline ternaries) and forgot-password (19);
 * the work order recorded `reset-password/page.tsx` as already correct and
 * offered it as the model, which it is — the copy was in
 * `reset-password-form.tsx` beside it, and there were 26 more. 73 strings on
 * three files, and **not one of them was reachable by anything above**: not the
 * parity census, not the placeholder check, not the fee-promise search.
 *
 * That is the reason this is a rule rather than a preference. The Terms of
 * Service told every member, in both languages, that loans "may include
 * administrative fees" — and survived a CHECK constraint, a source-wide search
 * for "markup", and `applicationFee = 0`, because a string in a page is
 * invisible to every guard this repository has. (The fee census above now reads
 * the message files too — moving a sentence into `messages/` is not a way
 * around it either.)
 *
 * The census is scoped to `(auth)/` deliberately. The same shape appears ~827
 * times across the dashboard, which is a separate and much larger piece of work
 * ([tasks.md](../../../../docs/tasks.md)); a census that failed on all of them
 * would be switched off within the day, and a census that is switched off is
 * worse than none.
 */
describe('the auth pages read their copy from the message files', () => {
  const AUTH_DIR = join(WEB_ROOT, 'app', '[locale]', '(auth)');

  function authSources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) out.push(full);
      }
    };
    walk(AUTH_DIR);
    return out;
  }

  /**
   * A language toggle names the *other* language, in that language: `বাংলা` on
   * the English page and `English` on the Bengali one. Translating those would
   * render "English" to a reader who is looking for the way out of English.
   * They are the one legitimate inline pair, and exempting them by their exact
   * shape is narrower than exempting the file.
   */
  const LANGUAGE_TOGGLE = /locale === 'en' \? '(বাংলা|English|EN)' : '(বাংলা|English|EN)'/g;

  /** `locale === 'bn' ? 'x' : 'y'` — prose chosen in a component. */
  const INLINE_COPY = /locale === '(bn|en)'\s*\n?\s*\?\s*(['"])(?:\\.|(?!\2).)*\2\s*\n?\s*:\s*(['"])(?:\\.|(?!\3).)*\3/g;

  it('can read the auth pages at all', () => {
    expect(authSources().length).toBeGreaterThanOrEqual(4);
  });

  it('has no inline EN/BN string pair outside the language toggle', () => {
    const offenders: string[] = [];
    for (const file of authSources()) {
      const source = readFileSync(file, 'utf8').replace(LANGUAGE_TOGGLE, '');
      const found = source.match(INLINE_COPY) ?? [];
      for (const hit of found) {
        offenders.push(`${relative(WEB_ROOT, file)} — ${hit.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(
      offenders.sort(),
      'Copy written into a component is invisible to every check in this file: ' +
        'the parity census, the placeholder check and the fee-promise search all ' +
        'read straight past it. Move it into messages/{en,bn}.json and read it ' +
        'with useTranslations.\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });
});
