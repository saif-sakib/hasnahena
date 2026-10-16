import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  CONTENT_CONFIG_KEYS,
  MEMBER_CONFIG_KEYS,
  PUBLIC_CONFIG_KEYS,
  SETTINGS_CONFIG_KEYS,
  SYSTEM_CONFIG_KEYS,
  UNIMPLEMENTED_CONFIG_KEYS,
} from '@/lib/system-config';

/**
 * WO-67: every system_config key a page READS must be one an admin can WRITE —
 * otherwise the page renders its `|| 'fallback'` forever (a placeholder bank
 * account number once shipped on /donate). Declared, not seeded.
 */

const HERE = new URL('.', import.meta.url).pathname;
const WEB_ROOT = resolve(HERE, '..', '..');

/** Every page and component that could read a setting. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  for (const root of ['app', 'components']) walk(join(WEB_ROOT, root));
  return out;
}

/** `settings['key']` / `settings?.['key']` — how pages read the flattened config. */
const READ_PATTERN = /\bsettings\??\.?\[\s*['"]([a-zA-Z0-9._-]+)['"]\s*\]/g;

type Read = { key: string; file: string };

function keysRead(): Read[] {
  const found: Read[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(READ_PATTERN)) {
      found.push({ key: m[1], file: relative(WEB_ROOT, file) });
    }
  }
  return found;
}

const READS = keysRead();
const DECLARED: ReadonlySet<string> = new Set(SYSTEM_CONFIG_KEYS);

/**
 * The other direction (T-11): every writable key must be READ by something —
 * either backend counts. Declared-dead keys go in UNIMPLEMENTED_CONFIG_KEYS.
 */
describe('every setting an admin can write is one something reads', () => {
  const REPO = resolve(WEB_ROOT, '..', '..');

  /** Go source, where the loan policy and the retention sweeps read their keys. */
  function goSources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.go') && !entry.endsWith('_test.go')) out.push(full);
      }
    };
    walk(join(REPO, 'apps', 'api'));
    return out;
  }

  /** Everything that could name a key — both application trees and the seed. */
  const corpus = [
    ...sourceFiles().filter((f) => !f.includes('/system-config.ts')),
    join(WEB_ROOT, 'lib', 'localized-settings.ts'),
    join(WEB_ROOT, 'lib', 'contact-details.ts'),
    join(WEB_ROOT, 'lib', 'faq.ts'),
    join(WEB_ROOT, 'lib', 'retention-policy.ts'),
    join(WEB_ROOT, 'lib', 'membership-eligibility.ts'),
    ...goSources(),
  ]
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('is reading something', () => {
    // The corpus assembling to nothing would make the assertion below vacuous.
    expect(corpus.length).toBeGreaterThan(100_000);
    expect(corpus).toContain('loan.maxLoanMultiplier');
  });

  it('has a reader for every declared key', () => {
    const dead: ReadonlySet<string> = new Set(UNIMPLEMENTED_CONFIG_KEYS);
    const orphans = SYSTEM_CONFIG_KEYS.filter(
      (key) => !dead.has(key) && !corpus.includes(key),
    );
    expect(
      orphans,
      'These keys have an admin control and nothing reads them, so saving the form ' +
        'writes a row that changes nothing a member or visitor can see. Either wire ' +
        'a reader, or move the key to UNIMPLEMENTED_CONFIG_KEYS and take its control ' +
        'off the screen — a switch that does nothing will be trusted eventually:\n  ' +
        orphans.join('\n  '),
    ).toEqual([]);
  });

  it('has a control for every key a public page renders', () => {
    // A PUBLIC key must be settable by an admin.
    const reachable = new Set<string>([...CONTENT_CONFIG_KEYS, ...SETTINGS_CONFIG_KEYS]);
    const unreachable = PUBLIC_CONFIG_KEYS.filter((key) => !reachable.has(key));
    expect(
      unreachable,
      'a public page can render these and no admin screen can set them:\n  ' +
        unreachable.join('\n  '),
    ).toEqual([]);
  });
});

describe('every setting a page reads is one an admin can write', () => {
  it('finds the reads at all', () => {
    // Guards the regex: reading nothing would pass.
    expect(READS.length).toBeGreaterThan(10);
  });

  it('reads no key that is absent from SYSTEM_CONFIG_KEYS', () => {
    const undeclared = READS.filter((r) => !DECLARED.has(r.key));
    const detail = [...new Set(undeclared.map((r) => `${r.key}  (${r.file})`))].sort();
    expect(
      detail,
      'These keys are read by a page but cannot be written through the settings ' +
        'screen, so the page\'s `|| fallback` literal is the only value it can ever ' +
        'show. Either declare the key and give it a control, or make the page read ' +
        'a key that already exists.\n  ' + detail.join('\n  '),
    ).toEqual([]);
  });

  it('reads none of the keys that are declared dead', () => {
    // An unimplemented key must not be read.
    const dead: ReadonlySet<string> = new Set(UNIMPLEMENTED_CONFIG_KEYS);
    const offenders = READS.filter((r) => dead.has(r.key));
    expect(
      [...new Set(offenders.map((r) => `${r.key} (${r.file})`))],
      'a page reads a key listed in UNIMPLEMENTED_CONFIG_KEYS',
    ).toEqual([]);
  });
});

describe('the organisation is described in one place', () => {
  /** contact.* was an undeclared second copy of org.*. */
  it('no page reads a contact.* address, email or phone', () => {
    const duplicated = READS.filter((r) => /^contact\.(email|phone|address)$/.test(r.key));
    expect(
      [...new Set(duplicated.map((r) => `${r.key} (${r.file})`))],
      'read org.email / org.phone / org.address instead — they are the declared, ' +
        'seeded keys, and they are what the letterhead on every generated document uses',
    ).toEqual([]);
  });
});

describe('the tiers `GET /api/v1/settings` serves are exhaustive', () => {
  /** Every tiered key is declared, and the member tier contains the public one. */
  it('every tiered key is a declared key', () => {
    const declared: ReadonlySet<string> = new Set(SYSTEM_CONFIG_KEYS);
    const strays = [...new Set([...PUBLIC_CONFIG_KEYS, ...MEMBER_CONFIG_KEYS])].filter(
      (key) => !declared.has(key),
    );
    expect(
      strays,
      'a key in a response tier that SYSTEM_CONFIG_KEYS does not declare: PUT would ' +
        'reject it while GET returns it',
    ).toEqual([]);
  });

  it('a signed-in member sees everything a stranger sees', () => {
    const member: ReadonlySet<string> = new Set(MEMBER_CONFIG_KEYS);
    const lost = PUBLIC_CONFIG_KEYS.filter((key) => !member.has(key));
    expect(lost, 'these keys vanish from the response once the caller signs in').toEqual([]);
  });

  it('the tiers are a partition, not overlapping copies', () => {
    const publicKeys = [...PUBLIC_CONFIG_KEYS];
    expect(new Set(publicKeys).size, 'PUBLIC_CONFIG_KEYS repeats a key').toBe(publicKeys.length);
    const memberKeys = [...MEMBER_CONFIG_KEYS];
    expect(new Set(memberKeys).size, 'MEMBER_CONFIG_KEYS repeats a key').toBe(memberKeys.length);
  });
});

describe('every declared key has exactly one admin screen that writes it', () => {
  /** CONTENT and SETTINGS partition the keys: neither = unreachable, both = two forms fighting. */
  const content: string[] = [...CONTENT_CONFIG_KEYS];
  const settings: string[] = [...SETTINGS_CONFIG_KEYS];

  it('neither list repeats a key', () => {
    expect(new Set(content).size, 'CONTENT_CONFIG_KEYS repeats a key').toBe(content.length);
    expect(new Set(settings).size, 'SETTINGS_CONFIG_KEYS repeats a key').toBe(settings.length);
  });

  it('no key is claimed by both screens', () => {
    const contentSet = new Set(content);
    const both = settings.filter((key) => contentSet.has(key));
    expect(
      both,
      'these keys have a control on Content & Media *and* on Settings; each save ' +
        'posts a whole list, so the later save reverts the earlier one',
    ).toEqual([]);
  });

  it('every declared key is claimed by one of them', () => {
    const claimed = new Set([...content, ...settings]);
    const orphans = SYSTEM_CONFIG_KEYS.filter((key) => !claimed.has(key));
    expect(
      orphans,
      'these keys are declared, so PUT accepts them and a page may read them, but ' +
        'no admin screen offers a control — the value they hold is whatever the ' +
        'seed wrote, forever',
    ).toEqual([]);
  });

  it('neither list names a key that is not declared', () => {
    const declared: ReadonlySet<string> = new Set(SYSTEM_CONFIG_KEYS);
    const strays = [...content, ...settings].filter((key) => !declared.has(key));
    expect(strays, 'a screen offers a control for a key PUT would reject').toEqual([]);
  });
});

describe('the public pages can only read public keys', () => {
  /** A public page may read only PUBLIC keys (both bracket forms matched). */
  const PUBLIC: ReadonlySet<string> = new Set(PUBLIC_CONFIG_KEYS);
  // components/dashboard/ is dashboard code too.
  const isDashboard = (file: string) =>
    file.includes('app/[locale]/dashboard/') || file.startsWith('components/dashboard/');
  const isPublicPage = (file: string) => !isDashboard(file) && !file.startsWith('app/api/');

  it('finds the reads on the public pages at all', () => {
    const reads = READS.filter((r) => isPublicPage(r.file));
    expect(reads.length).toBeGreaterThan(10);
  });

  it('reads no key that getPublicSettings() does not return', () => {
    const offenders = READS.filter((r) => isPublicPage(r.file) && !PUBLIC.has(r.key));
    const detail = [...new Set(offenders.map((r) => `${r.key}  (${r.file})`))].sort();
    expect(
      detail,
      'These keys are read by a page that renders from the cached public settings ' +
        'map, which only carries PUBLIC_CONFIG_KEYS. The read returns undefined and ' +
        "the page shows its hardcoded fallback. Add the key to PUBLIC_CONFIG_KEYS " +
        'if a stranger may see it, or stop reading it here.\n  ' + detail.join('\n  '),
    ).toEqual([]);
  });
});
