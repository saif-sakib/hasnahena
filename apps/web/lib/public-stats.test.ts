import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { formatMemberCount, formatTakaTotal, NO_PUBLIC_STATS } from './public-stats';

/**
 * The home page's figures — the formatting half, and rule 6a.
 *
 * The queries themselves are exercised by `public-content-fallback.test.ts`,
 * which owns the "no database is still a page" contract these share. What is
 * here is what that file cannot see: what the numbers *look like* to a reader,
 * and whether the aggregates are allowed to count money that has not moved.
 */

const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = readFileSync(resolve(WEB_ROOT, 'lib/public-stats.ts'), 'utf8');

describe('a figure worth publishing', () => {
  it('is nothing at all when there is nothing to say', () => {
    // The panel hides a card whose value is `''`, so `''` is how this function
    // says "no card". A foundation on its first day gets the drawn panel, not
    // "0 Total Members" — which is a true statement and a terrible headline.
    expect(formatMemberCount(0, 'en')).toBe('');
    expect(formatTakaTotal(BigInt(0), 'en')).toBe('');
  });

  it('is nothing at all for a number that cannot be right', () => {
    expect(formatMemberCount(-3, 'en')).toBe('');
    expect(formatMemberCount(Number.NaN, 'en')).toBe('');
    expect(formatTakaTotal(BigInt(-1), 'en')).toBe('');
  });

  it('counts members in the reader’s own digits', () => {
    expect(formatMemberCount(10, 'en')).toBe('10');
    expect(formatMemberCount(10, 'bn')).toBe('১০');
  });

  it('groups a Bangladeshi total the Bangladeshi way', () => {
    // Lakh, not thousands: ৪৭,৯৬,১০০ and never ৪,৭৯৬,১০০. `bn-BD` does this on
    // its own, which is the reason to go through `Intl` rather than to reach
    // for a `toLocaleString('en-US')` that would be wrong in both languages.
    expect(formatMemberCount(4796100, 'bn')).toBe('৪৭,৯৬,১০০');
  });

  it('spells money the way the rest of the platform spells it', () => {
    // `formatCurrency`, not a second `Intl` call written out here. A statement,
    // a receipt and the home page must not disagree about what taka looks like.
    //
    // The separator is U+00A0, a **non-breaking** space, and it is written out
    // here rather than typed as a space so nobody "fixes" this line by pasting
    // an ordinary one. It is what keeps `BDT` from wrapping away from its own
    // number in a narrow column — the failure the hero panel had to be
    // restructured around, arriving one word earlier.
    expect(formatTakaTotal(BigInt(4796100), 'en')).toBe('BDT\u00a04,796,100');
    expect(formatTakaTotal(BigInt(4796100), 'bn')).toContain('৪৭,৯৬,১০০');
  });

  it('shows whole taka and never a paisa (rule 1)', () => {
    for (const locale of ['en', 'bn']) {
      expect(formatTakaTotal(BigInt(6502000), locale)).not.toMatch(/[.।]\d/);
    }
  });

  it('reports nothing rather than zeroes when the database is unreachable', () => {
    expect(NO_PUBLIC_STATS.members).toBe(0);
    expect(formatMemberCount(NO_PUBLIC_STATS.members, 'en')).toBe('');
    expect(formatTakaTotal(NO_PUBLIC_STATS.deposits, 'en')).toBe('');
  });
});

describe('rule 6a — only money that moved is counted', () => {
  it('sums confirmed postings and nothing else', () => {
    // A `PENDING` deposit is a request and a `PENDING` withdrawal is an unpaid
    // intention. Four aggregates in this codebase once counted intentions as
    // income (ADR-016), and a home page that does it publishes the foundation
    // as larger than it is — to the people deciding whether to trust it.
    for (const block of aggregateBlocks(SOURCE)) {
      expect(block, `an aggregate in public-stats.ts does not filter on status:\n${block}`).toMatch(
        /status:\s*'CONFIRMED'/,
      );
    }
    expect(aggregateBlocks(SOURCE).length, 'no transaction aggregate found — has this been rewritten?').toBe(2);
  });

  it('counts a loan as distributed when the money left, not by its label', () => {
    // `disbursementDate`, not a list of statuses. "Distributed" stays true after
    // the loan is COMPLETED or SETTLED, and a status list needs five labels that
    // a sixth silently falls out of — which is how `LoanStatus` produced two
    // real defects before WO-71 collapsed it.
    expect(SOURCE).toMatch(/disbursementDate:\s*\{\s*not:\s*null\s*\}/);
  });

  it('is the only place in the web app that sums a posting', () => {
    // The census, so the next aggregate does not have to remember this rule.
    // Deliberately about `_sum` and not about `count`: two routes count a
    // member's postings at *every* status to decide whether they can be deleted
    // outright, and that is correct — a PENDING row is still a row that stops an
    // erasure. It is summing **money** that must never see one.
    const offenders: string[] = [];
    for (const file of sourceFiles(['app', 'lib'])) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('_sum')) continue;
      for (const block of aggregateBlocks(source)) {
        if (!/status:\s*'CONFIRMED'/.test(block)) {
          offenders.push(file.slice(WEB_ROOT.length + 1));
        }
      }
    }
    expect(
      offenders,
      'a transaction aggregate somewhere in app/ or lib/ sums an amount without ' +
        "filtering on status. Only CONFIRMED moved money (rule 6a) — add " +
        "`status: 'CONFIRMED'` to the where clause.",
    ).toEqual([]);
  });
});

/** Every `prisma.transaction.aggregate({ … })` call in a source file, by brace balance. */
function aggregateBlocks(source: string): string[] {
  const blocks: string[] = [];
  const marker = 'transaction.aggregate(';
  let from = 0;
  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) return blocks;
    let depth = 0;
    let end = start + marker.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(start, end + 1));
    from = end + 1;
  }
}

function sourceFiles(roots: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) found.push(full);
    }
  };
  for (const root of roots) walk(resolve(WEB_ROOT, root));
  return found;
}
