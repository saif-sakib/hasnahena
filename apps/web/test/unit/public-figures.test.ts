import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The public site does NOT read the ledger (owner's ruling): the hero figures
 * are stated system_config values. A removed rule needs a test asserting its
 * absence. About aggregates over people and money, not Prisma generally.
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
    // …and the hero still shows the four figures.
    const page = readFileSync(resolve(WEB_ROOT, 'app/[locale]/page.tsx'), 'utf8');
    for (const key of ['stats.members', 'stats.deposits', 'stats.loans', 'stats.charity']) {
      expect(page, `the home page no longer renders ${key}`).toContain(`'${key}'`);
    }
  });
});
