import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * **The public site does not read the ledger.**
 *
 * This is a rule that was *removed*, and a removed rule needs a test asserting
 * its absence or nothing stops it coming back (traps.md § Deleting a rule).
 *
 * For one day the four figures beside the home page headline were counted out
 * of the database — `SELECT count(*)` for members, the sum of confirmed
 * deposits, the disbursed principal, the confirmed donations. It is the nicer
 * engineering answer by every measure a developer applies: true by
 * construction, never stale, no admin work. The owner's ruling on 2026-08-26
 * was that it is the wrong product: **the fund's real member count and real
 * balances are not for publication.** A cooperative is entitled to describe its
 * scale without opening its books to anyone who loads a page, and a headline
 * figure that moves every time somebody makes a deposit is not a headline.
 *
 * So the figures are `system_config` values the foundation states and can
 * correct, and `lib/public-stats.ts` was deleted rather than left switched off.
 * The next person to look at four hand-maintained numbers next to a database
 * that knows all four will reach for exactly the change that was reverted, and
 * they will be right about everything except the part that matters. This test
 * is where they find out.
 *
 * It is deliberately about **aggregates over people and money**, not about
 * Prisma. A public page reads `system_config` and `galleryItem` — that is what
 * those tables are for.
 */

const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');

/** Reads a member, a balance or a posting — none of which a stranger may total. */
const LEDGER_READS = [
  /prisma\.user\.(count|aggregate|groupBy)\s*\(/,
  /prisma\.transaction\.(count|aggregate|groupBy|findMany|findFirst)\s*\(/,
  /prisma\.loan\.(count|aggregate|groupBy|findMany|findFirst)\s*\(/,
  /prisma\.account\.(count|aggregate|groupBy|findMany|findFirst)\s*\(/,
];

/** Every page under `app/[locale]/` that a signed-out stranger can reach. */
function publicPageFiles(): string[] {
  const root = resolve(WEB_ROOT, 'app/[locale]');
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'dashboard' || entry === '(auth)' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) found.push(full);
    }
  };
  walk(root);
  return found;
}

describe('the marketing pages state the foundation’s figures rather than counting them', () => {
  it('lib/public-stats.ts stays deleted', () => {
    expect(
      existsSync(resolve(WEB_ROOT, 'lib/public-stats.ts')),
      'lib/public-stats.ts is back. It counted the hero figures out of the ledger, ' +
        'and the owner ruled that the fund’s real balances are not published. ' +
        'If this is a deliberate reversal, it is the owner’s to make — read the ' +
        'note at the top of this file first.',
    ).toBe(false);
  });

  it('no public page totals members, postings, loans or balances', () => {
    const offenders: string[] = [];
    for (const file of publicPageFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of LEDGER_READS) {
        if (pattern.test(source)) offenders.push(`${file.slice(WEB_ROOT.length + 1)} — ${pattern}`);
      }
    }
    expect(
      offenders,
      'a public page reads the ledger:\n  ' +
        offenders.join('\n  ') +
        '\nThe figures on the home page are stated in system_config, not counted.',
    ).toEqual([]);
  });

  it('and neither does anything they render from', () => {
    // The accessors the marketing pages share. A count moved one level down is
    // the same publication with an extra file in front of it.
    for (const file of ['lib/system-config.ts', 'lib/public-content.ts', 'lib/localized-settings.ts']) {
      const source = readFileSync(resolve(WEB_ROOT, file), 'utf8');
      for (const pattern of LEDGER_READS) {
        expect(pattern.test(source), `${file} totals the ledger for a public page`).toBe(false);
      }
    }
  });

  it('the home page still shows the four figures it is supposed to', () => {
    // The other half of the rule: refusing the ledger must not have quietly
    // left the hero with nothing in it, which is the state that started the
    // whole sequence.
    const page = readFileSync(resolve(WEB_ROOT, 'app/[locale]/page.tsx'), 'utf8');
    for (const key of ['stats.members', 'stats.deposits', 'stats.loans', 'stats.charity']) {
      expect(page, `the home page no longer renders ${key}`).toContain(`'${key}'`);
    }
  });
});
