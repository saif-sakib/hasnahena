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
 * WO-67. Every `system_config` key a page *reads* must be one the settings
 * endpoint will let an admin *write*.
 *
 * The allow-list already stops the reverse mistake: `PUT /api/v1/settings`
 * rejects an unrecognised key, which is what made WO-46's settings page unable
 * to save anything. This is the same failure from the other direction, and it
 * is quieter — a page reading an undeclared key never errors. It renders its
 * `|| 'fallback'` literal, forever, and the fallback looks like real content.
 *
 * That was live on two public pages:
 *
 *   /donate   showed the account number `2050 0000 0000 0000` under the heading
 *             "Bank Account", in a highlighted monospace box, because all four
 *             `bank.*` keys were undeclared.
 *   /contact  showed `contact@example.com` as the foundation's email address,
 *             because `contact.email` was undeclared — while `org.email`, which
 *             *is* declared and seeded with the real address, sat unused.
 *
 * A donor reading either page was being given details that no admin could
 * correct through any screen in the application.
 *
 * The rule this file enforces is deliberately the narrow one — *declared*, not
 * *seeded* — because a key with no row is a legitimately empty setting, and the
 * pages now render an empty state for that. What is never legitimate is a key
 * the admin screen cannot reach.
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

/**
 * `settings['some.key']` / `settings["some.key"]`, which is how every page reads
 * the flattened config map. A computed key would slip past this — none exists,
 * and one would be worth rejecting in review anyway, because it cannot be
 * checked from here or anywhere else.
 */
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

describe('every setting a page reads is one an admin can write', () => {
  it('finds the reads at all', () => {
    // Guards the regex itself. If a refactor changes how pages access settings,
    // this file would otherwise pass by reading nothing — the shape of green
    // that means a test has stopped working rather than the code being correct.
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
    // UNIMPLEMENTED_CONFIG_KEYS exists to say "nothing reads this". A page that
    // reads one turns that comment into a lie, and the key into a setting whose
    // control was deliberately removed.
    const dead: ReadonlySet<string> = new Set(UNIMPLEMENTED_CONFIG_KEYS);
    const offenders = READS.filter((r) => dead.has(r.key));
    expect(
      [...new Set(offenders.map((r) => `${r.key} (${r.file})`))],
      'a page reads a key listed in UNIMPLEMENTED_CONFIG_KEYS',
    ).toEqual([]);
  });
});

describe('the organisation is described in one place', () => {
  /**
   * `org.email`, `org.phone` and `org.address` are declared, seeded with the
   * foundation's real details, and printed on generated documents. `contact.*`
   * held a second copy of the same three facts — undeclared, unseeded, and read
   * by /contact in preference to the real ones.
   *
   * This is the ADR-023 shape: two columns for one fact, kept equal by hand,
   * except here they were never equal because one side could not be written.
   */
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
  /**
   * WO-77 (SEC-12) split the allow-list into what an anonymous caller may read,
   * what a signed-in member may read, and the admin-only remainder. Three
   * lists, each a copy of part of a fourth — which is the shape that goes stale.
   *
   * Nothing here judges *which* tier a key belongs in; that is a decision, and
   * it is argued in the comments in lib/system-config.ts. What this refuses is
   * a key that exists in a tier and not in the master list, which would be a
   * key `PUT` rejects and `GET` returns — and a member tier that has quietly
   * stopped containing the public one, which would make a signed-in member see
   * *less* than a stranger.
   */
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
  /**
   * Settings used to own every key, and had grown a "Landing" tab holding the
   * hero image, the partner logos, three section headings and a gallery
   * uploader — beside the bKash number and the loan multiplier. That is two
   * jobs, so it is two screens: Content & Media publishes the public site,
   * Settings configures the organisation and its money.
   *
   * Two screens over one table is only safe if each key belongs to exactly one
   * of them. A key in **neither** is a key no admin can change — WO-67's failure
   * with a new cause, and just as silent, because the page keeps rendering its
   * `|| 'fallback'`. A key in **both** is two forms writing one row, each
   * posting a copy it read minutes ago, so whichever saves last quietly reverts
   * the other.
   */
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
  /**
   * WO-73 made every page outside `dashboard/` render from one cached
   * `getPublicSettings()` map, and that map contains PUBLIC_CONFIG_KEYS and
   * nothing else. So a public page reading a key that is declared but not
   * *public* gets `undefined` and renders its `|| 'fallback'` literal —
   * silently, forever, exactly the WO-67 failure with a new cause.
   *
   * It is worth stating what the previous version of this file missed: it
   * matched `settings['key']` but not `settings?.['key']`, which is how the
   * header and footer read every one of their keys. Both forms are matched now.
   */
  const PUBLIC: ReadonlySet<string> = new Set(PUBLIC_CONFIG_KEYS);
  // `components/dashboard/` is dashboard code even though it does not live under
  // `app/[locale]/dashboard/`: the worker and admin screens moved there when the
  // two dashboards stopped being separate copies. Without this clause every one
  // of them counted as a public page, and the member-detail screen's reads of
  // the loan policy — which the member tier serves and the public tier does not —
  // failed the check.
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
