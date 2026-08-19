import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { SYSTEM_CONFIG_KEYS, UNIMPLEMENTED_CONFIG_KEYS } from '@/lib/system-config';

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
const READ_PATTERN = /\bsettings\[\s*['"]([a-zA-Z0-9._-]+)['"]\s*\]/g;

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
