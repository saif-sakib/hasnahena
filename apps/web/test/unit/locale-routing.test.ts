import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { defaultLocale, locales, localePrefix } from '@/i18n';
import {
  localePath,
  localeFromPath,
  pathWithoutLocale,
  switchLocalePath,
} from '@/lib/locale-path';
import { getLocalizedPath } from '@/lib/seo';

/**
 * WO-94 / WO-95 — English is the default, and the default has no prefix.
 *
 * `/` used to 307 to a negotiated locale, which is why Search Console reported
 * *"Duplicate, Google chose different canonical than user"* on `/bn` with a
 * Google-selected canonical of `/`: Google merges a redirecting root with
 * whatever it lands on and keeps the shorter URL. `/` is a real English page
 * now.
 *
 * Two kinds of assertion here, and the second is the one that lasts. The first
 * pins the rule; the second is a **census** over `app/` and `components/` that
 * fails when somebody writes `` `/${locale}/faq` `` again. Under the old
 * `always` scheme that was merely repetitive — now it produces a URL that 301s,
 * so every hand-built link costs a redirect and tells a crawler the href is not
 * the real one.
 */

const WEB = resolve(new URL('.', import.meta.url).pathname, '..', '..');

describe('the locale rule', () => {
  it('is English, unprefixed', () => {
    expect(defaultLocale).toBe('en');
    expect(localePrefix).toBe('as-needed');
  });

  it('gives the default locale no prefix and every other locale one', () => {
    expect(localePath('en', '/')).toBe('/');
    expect(localePath('en', '/faq')).toBe('/faq');
    expect(localePath('en')).toBe('/');
    expect(localePath('bn', '/')).toBe('/bn');
    expect(localePath('bn', '/faq')).toBe('/bn/faq');
    expect(localePath('bn')).toBe('/bn');
  });

  it('treats an unknown locale as the default rather than inventing a prefix', () => {
    // `/fr/faq` is not a route this app serves. Building one would produce a
    // 404 that looks like a locale.
    expect(localePath('fr', '/faq')).toBe('/faq');
    expect(localePath('', '/faq')).toBe('/faq');
  });

  it('normalises a path that arrives without its leading slash', () => {
    expect(localePath('en', 'faq')).toBe('/faq');
    expect(localePath('bn', 'faq')).toBe('/bn/faq');
  });

  it('is the same function the canonical URLs are built from', () => {
    // Two implementations of "where does this page live" is how a canonical tag
    // comes to disagree with the link that points at it.
    for (const locale of locales) {
      for (const path of ['/', '/faq', '/dashboard/admin']) {
        expect(getLocalizedPath(locale, path)).toBe(localePath(locale, path));
      }
    }
  });
});

describe('reading a locale back out of a path', () => {
  it('knows which locale a path is in', () => {
    expect(localeFromPath('/faq')).toBe('en');
    expect(localeFromPath('/')).toBe('en');
    expect(localeFromPath('/bn/faq')).toBe('bn');
    expect(localeFromPath('/bn')).toBe('bn');
    // Not a locale segment. `/enrolment` is the case a `startsWith('/en')`
    // check gets wrong, and it is why this splits on `/` rather than matching a
    // prefix.
    expect(localeFromPath('/enrolment')).toBe('en');
    expect(localeFromPath('/bnp-office')).toBe('en');
  });

  it('strips only a real locale segment', () => {
    expect(pathWithoutLocale('/bn/faq')).toBe('/faq');
    expect(pathWithoutLocale('/bn')).toBe('/');
    expect(pathWithoutLocale('/faq')).toBe('/faq');
    expect(pathWithoutLocale('/enrolment')).toBe('/enrolment');
    expect(pathWithoutLocale('/')).toBe('/');
  });

  it('switches language without moving the reader', () => {
    // The header's toggle. It has to work on a dashboard route with an id in
    // it, in both directions, which `pathname.replace('/en', '/bn')` never did.
    expect(switchLocalePath('/dashboard/admin/members/abc', 'bn'))
      .toBe('/bn/dashboard/admin/members/abc');
    expect(switchLocalePath('/bn/dashboard/admin/members/abc', 'en'))
      .toBe('/dashboard/admin/members/abc');
    expect(switchLocalePath('/', 'bn')).toBe('/bn');
    expect(switchLocalePath('/bn', 'en')).toBe('/');
  });
});

/**
 * The census. A list of the files that were fixed on 2026-08-25 would be
 * satisfied and then stale; what has to fail is the *next* one.
 */
describe('no page builds a locale URL by hand', () => {
  function sourceFiles(): string[] {
    const roots = ['app', 'components', 'lib'].map((d) => join(WEB, d));
    const out: string[] = [];
    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.next') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
      }
    };
    roots.forEach(walk);
    return out;
  }

  const FILES = sourceFiles();

  it('can read the source at all', () => {
    // A walk that silently found nothing would make the assertion below pass
    // while checking not one file.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('has no `/${locale}` template literal outside lib/locale-path.ts', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file.endsWith(join('lib', 'locale-path.ts'))) continue;
      const source = readFileSync(file, 'utf8');
      // The shape being banned: a template literal that opens with a slash and
      // interpolates something locale-ish. Narrow on purpose — `${locale}`
      // elsewhere in a string is fine, and so is a path with no interpolation.
      for (const match of source.matchAll(/`\/\$\{\s*(\w*[Ll]ocale\w*)\b/g)) {
        offenders.push(`${file.slice(WEB.length + 1)} — \`/\${${match[1]}}…\``);
      }
    }
    expect(
      offenders.sort(),
      'These build a locale URL by hand. Under `localePrefix: "as-needed"` that ' +
        'produces `/en/…` for English, which the proxy 301s to the unprefixed ' +
        'form — so every such link costs a redirect and tells a crawler the href ' +
        'it was given is not the canonical one. Use `localePath(locale, path)` ' +
        'from `lib/locale-path.ts`.\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  /**
   * The other way a locale URL gets built by hand: string surgery on the
   * current pathname.
   *
   * `pathname.replace(localePath(locale), otherPrefix)` reads like "swap the
   * locale segment" and is not. For English `localePath('en')` is `/`, so on
   * `/dashboard/admin` it replaced the **first slash** and produced
   * `/bndashboard/admin` — a 404 reachable from the language button on every
   * staff screen. `pathname.replace('/en', '/bn')` is the same family: it
   * matches `/enrolment`, and it cannot add a prefix to a path that has none.
   *
   * There is no correct spelling of this with `replace`, because under
   * `as-needed` one of the two locales has no segment to replace at all.
   * Banning the shape is the fix; `switchLocalePath` is the only sanctioned way.
   */
  it('rewrites no locale with replace(), because there is no correct way to', () => {
    // `router.replace(localePath(locale, '/login'))` is Next's navigation, and
    // four files legitimately do it. The lookbehind is what keeps this census
    // about string surgery on a path rather than about routing — without it the
    // check fails on the correct code and gets deleted by the next person.
    const NOT_A_ROUTER = String.raw`(?<!\brouter)`;
    const BANNED: Array<{ pattern: string; what: string }> = [
      { pattern: String.raw`pathname\s*\.replace\s*\(`, what: 'pathname.replace(…)' },
      {
        pattern: NOT_A_ROUTER + String.raw`\.replace\s*\(\s*localePath\s*\(`,
        what: '.replace(localePath(…))',
      },
      {
        pattern: NOT_A_ROUTER + String.raw`\.replace\s*\(\s*['"\`]/(en|bn)\b`,
        what: ".replace('/en'…)",
      },
    ];

    const offenders: string[] = [];
    for (const file of FILES) {
      if (file.endsWith(join('lib', 'locale-path.ts'))) continue;
      // Comments explain the banned shape in several places — including beside
      // the fix for it. Matching those would fail this on its own documentation.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const { pattern, what } of BANNED) {
        if (new RegExp(pattern).test(code)) {
          offenders.push(`${file.slice(WEB.length + 1)} — ${what}`);
        }
      }
    }

    expect(
      offenders.sort(),
      'These rewrite a path to change its locale. Under `as-needed` the ' +
        'English pathname has no locale segment, so there is nothing to ' +
        'replace and the match lands somewhere else — `localePath("en")` is ' +
        '`/`, which is the first character of every path, which is how the ' +
        'admin language button produced `/bndashboard/admin`. Use ' +
        '`switchLocalePath(pathname, otherLocale(locale))`.\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });
});
