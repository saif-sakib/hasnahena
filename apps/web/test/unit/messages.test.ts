import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// TEST-39 / WO-51 — EN/BN message parity. SUPPOSED to fail when a key is in one
// file and not the other: add it to both (never paste English into bn.json —
// assertion 3 catches that).

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

/** Keys correctly identical in both languages (brand names…). Say why on the line. */
const IDENTICAL_BY_DESIGN = new Set<string>([]);

/** Above this length an identical value is a copy-paste, not a shared word. */
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
 * Rule 3 in the PROSE members read: no copy may promise a charge (a Terms line
 * once said loans "may include administrative fees"). Searches for the promise,
 * so "no processing fee" passes. The one charge is the flat ৳500 (ADR-045).
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

  /** Affirmative charge phrases; a denial passes. */
  const PROMISES_A_CHARGE = [
    /may\s+include\s+[\w\s]*fee/i,
    /(?<!no\s)(?<!zero\s)(?:administrative|processing|service|application)\s+fees?\s+(?:apply|will|are\s+charged)/i,
    /interest[- ]free\s+but/i,
    /সুদমুক্ত\s+কিন্তু/,
    /ফি\s+(?:প্রযোজ্য|অন্তর্ভুক্ত\s+থাকতে\s+পারে)/,
    /চার্জ\s+প্রযোজ্য/,
  ];

  /** The pages AND the message files (copy moves there — WO-96). */
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

  it('the terms state the rule positively in both languages', () => {
    // The other half: the Terms must state the rule. Reads messages/, where the
    // wording lives (T-10).
    const loans = {
      en: en.get('legal.terms.sections.loans.content'),
      bn: bn.get('legal.terms.sections.loans.content'),
    };
    expect(
      loans.en,
      'the loan clause is gone from legal.terms.sections.loans.content — if it was ' +
        'renamed, move this assertion with it rather than deleting it',
    ).toBeDefined();
    expect(loans.en).toMatch(/no\s+profit\s+rate/i);
    // The ৳500: flat, non-refundable, never added to what is owed (ADR-045).
    expect(loans.en).toMatch(/same whatever amount you borrow/i);
    expect(loans.en).toMatch(/not added to the loan/i);
    expect(loans.bn).toContain('ঋণের সাথে যোগ হয় না');
    // "no late fee" is the second half of the same ruling (T-05, 2026-08-25):
    // the agreement denies one rather than reserving one, and so must the page.
    expect(loans.en).toMatch(/no\s+penalty|no\s+additional\s+charge/i);
    expect(loans.bn).toContain('সুদমুক্ত');
    expect(loans.bn).toMatch(/কোনো জরিমানা|বাড়তি চার্জ/);
  });
});

/**
 * WO-96 / rule 5: the (auth) pages read their copy from the message files.
 * Scoped to (auth)/ — the dashboard's inline strings are a separate task.
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

  /** The language toggle names the other language in itself — the one allowed inline pair. */
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
