import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

// Defence in depth on a money path: the presets are now whole, so these rounds
// are no-ops — which is exactly why they must not be deleted as redundant.
describe('the screens that use a preset still round before posting', () => {
  const WEB = resolve(process.cwd());
  // The two staff screens moved into components/dashboard/screens when the
  // worker and admin dashboards stopped being two copies of each other; the
  // route files under app/ are now one-line re-exports with no arithmetic in
  // them, so pointing this list at those would make it pass by reading nothing.
  const SCREENS = [
    'app/[locale]/dashboard/member/loans/page.tsx',
    'components/dashboard/screens/loans-screen.tsx',
    'components/dashboard/screens/member-detail-screen.tsx',
  ];

  for (const rel of SCREENS) {
    it(`${rel} rounds the amount it submits`, () => {
      const source = readFileSync(join(WEB, rel), 'utf8');
      expect(source).toContain('getLoanRepaymentPresets');
      expect(
        /amount: Math\.round\(|return Math\.round\(/.test(source),
        'this screen fills an amount from a preset and must round it before posting (WO-56)',
      ).toBe(true);
    });
  }
});
