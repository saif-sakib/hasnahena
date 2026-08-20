import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getLoanRepaymentPresets, formatCurrency } from './utils';

// WO-56. Rule 1: money is whole taka, no paisa.
//
// The presets fill a text input the member then submits, so a fractional preset
// is a figure the platform cannot post: the call sites round again on submit,
// which means the amount recorded is not the amount the member was shown. A
// ৳4,567 installment offered `1141.75` weekly and posted `1142`.
//
// `formatCurrency` truncates for display, which is why nobody saw this — the
// presets bypass it.

const AMOUNTS = [0, 1, 3, 4, 5, 7, 99, 100, 101, 1000, 4567, 12345, 999_999, 1_234_567];

describe('getLoanRepaymentPresets', () => {
  it('offers only whole taka', () => {
    for (const installment of AMOUNTS) {
      const presets = getLoanRepaymentPresets(installment, 10_000_000);
      for (const [name, value] of Object.entries(presets)) {
        expect(Number.isInteger(value), `${name} for an installment of ${installment} is ${value}`).toBe(true);
      }
    }
  });

  it('divides the installment into four whole weeks', () => {
    // 4567/4 is 1141.75 — the figure that started this.
    expect(getLoanRepaymentPresets(4567, 10_000).weekly).toBe(1142);
    expect(getLoanRepaymentPresets(4000, 10_000).weekly).toBe(1000);
    expect(getLoanRepaymentPresets(1, 10_000).weekly).toBe(0);
  });

  it('never offers more than is left to repay', () => {
    for (const installment of AMOUNTS) {
      for (const remaining of [0, 1, 500, 4567, 1_000_000]) {
        const presets = getLoanRepaymentPresets(installment, remaining);
        for (const [name, value] of Object.entries(presets)) {
          expect(value, `${name} exceeds the remaining ${remaining}`).toBeLessThanOrEqual(remaining);
          expect(value, `${name} is negative`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('offers nothing on a settled loan', () => {
    expect(getLoanRepaymentPresets(4567, 0)).toEqual({ weekly: 0, monthly: 0, full: 0 });
  });

  it('refuses to turn nonsense into a payable figure', () => {
    // A loan whose figures have not loaded yet reaches this with NaN, and
    // "NaN" in an amount box is better than a plausible wrong number.
    for (const bad of [NaN, Infinity, -Infinity]) {
      const presets = getLoanRepaymentPresets(bad, 10_000);
      expect(Number.isInteger(presets.weekly)).toBe(true);
      expect(Number.isInteger(presets.monthly)).toBe(true);
      expect(getLoanRepaymentPresets(4567, bad).full).toBe(0);
    }
    // A negative remaining is a broken loan record, not a refund.
    expect(getLoanRepaymentPresets(4567, -500)).toEqual({ weekly: 0, monthly: 0, full: 0 });
  });

  it('shows the member the same digits the formatter would', () => {
    const presets = getLoanRepaymentPresets(4567, 100_000);
    expect(formatCurrency(presets.weekly).replace(/[^\d,]/g, '')).toBe('1,142');
  });
});

// Rule 1, enumerated rather than listed.
//
// Every screen that posts a money `amount` must get it from `parseWholeTaka`,
// which refuses paisa instead of rounding them. The list this replaced named
// three files by hand and asserted they contained `Math.round(` — which is the
// *old* rule, and which passed happily while two of the three screens rounded
// 1500.75 into 1501 and told the worker it had worked.
//
// This walks the source instead, so a new screen that posts an amount fails
// here until it goes through the same parser. `components/dashboard/
// money-actions.tsx` is the one implementation of the four staff actions; the
// member's own request forms are separate because they post a *request*, not a
// posting.
describe('every screen that posts an amount parses whole taka', () => {
  const WEB = resolve(process.cwd());

  /** Files under these roots are searched for a money post. */
  const ROOTS = ['app', 'components', 'lib'];

  /** A body key of `amount:` on an api call is what makes a file in scope. */
  const POSTS_AN_AMOUNT = /\bapi(?:Post|Put|Patch)\b[\s\S]{0,400}?\bamount:/;

  const sources = (() => {
    const found: Array<{ rel: string; source: string }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(WEB, dir), { withFileTypes: true })) {
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          walk(rel);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          found.push({ rel, source: readFileSync(join(WEB, rel), 'utf8') });
        }
      }
    };
    for (const root of ROOTS) walk(root);
    return found;
  })();

  const posters = sources.filter(({ source }) => POSTS_AN_AMOUNT.test(source));

  it('finds the money forms at all', () => {
    // A regex that matches nothing would make every assertion below vacuous.
    expect(posters.length).toBeGreaterThan(0);
  });

  for (const { rel } of posters) {
    it(`${rel} refuses paisa rather than rounding`, () => {
      const source = readFileSync(join(WEB, rel), 'utf8');
      expect(
        source.includes('parseWholeTaka'),
        `${rel} posts a money amount and must read it with parseWholeTaka (rule 1)`,
      ).toBe(true);
      expect(
        /Math\.round\([^)]*[Aa]mount/.test(source),
        `${rel} rounds a money amount; parseWholeTaka refuses one instead`,
      ).toBe(false);
    });
  }
});
