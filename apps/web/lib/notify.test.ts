import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatTaka, formatMoney } from './notify';
import { formatCurrency } from './utils';

// WO-58: Next notification amounts must match the Go builders; expected
// strings are duplicated from messages_test.go on purpose.

describe('notification amount formatting', () => {
  it('renders whole taka with the dashboard grouping', () => {
    const cases: Array<[bigint, string]> = [
      [BigInt(0), '0'],
      [BigInt(1), '1'],
      [BigInt(999), '999'],
      [BigInt(1000), '1,000'],
      [BigInt(50000), '50,000'],
      [BigInt(150000), '150,000'],
      [BigInt(1234567), '1,234,567'],
    ];
    for (const [amount, want] of cases) {
      expect(formatTaka(amount), `formatTaka(${amount})`).toBe(want);
    }
  });

  it('always states the unit', () => {
    expect(formatMoney(BigInt(50000))).toBe('BDT 50,000');
    expect(formatMoney(BigInt(0))).toBe('BDT 0');
  });

  it('never prints a fractional amount — money is whole taka (rule 1)', () => {
    for (const amount of [BigInt(0), BigInt(1), BigInt(999), BigInt(1000), BigInt(50000), BigInt(1234567)]) {
      expect(formatMoney(amount)).not.toMatch(/\d[.,]\d{1,2}\b/);
    }
    // A float that sneaks in is truncated rather than rendered with paisa.
    expect(formatTaka(1234.99)).toBe('1,234');
  });

  it('agrees with the Go builders in apps/api/internal/notify', () => {
    // Copied from messages_test.go TestFormatTakaMatchesTheWebApp. If one side
    // changes its grouping, this fails rather than a member noticing.
    const fromGo: Record<string, string> = {
      '0': 'BDT 0',
      '1': 'BDT 1',
      '999': 'BDT 999',
      '1000': 'BDT 1,000',
      '5000': 'BDT 5,000',
      '100000': 'BDT 100,000',
      '1234567': 'BDT 1,234,567',
    };
    for (const [amount, want] of Object.entries(fromGo)) {
      expect(formatMoney(BigInt(amount)), `amount ${amount}`).toBe(want);
    }
  });

  it('groups the same way the dashboard does', () => {
    // formatCurrency in lib/utils.ts is what a member sees beside the
    // notification list. The currency symbol differs (it renders "BDT" via
    // Intl); the digits must not.
    for (const amount of [0, 1000, 50000, 1234567]) {
      const onScreen = formatCurrency(amount).replace(/[^\d,]/g, '');
      expect(formatTaka(amount), `amount ${amount}`).toBe(onScreen);
    }
  });
});

// A locale-less toLocaleString() is the defect itself, not a style problem: it
// silently takes the server's locale. This reads the routes that build
// notification text and fails if one comes back.
describe('no notification route formats an amount without a locale', () => {
  const REPO = resolve(process.cwd(), '..', '..');
  const routes = [
    'apps/web/app/api/v1/loans/applications/route.ts',
    'apps/web/app/api/v1/loans/[id]/guarantor-approval/route.ts',
  ];

  for (const rel of routes) {
    it(`${rel} uses the shared formatter`, () => {
      const source = readFileSync(join(REPO, rel), 'utf8');
      const offenders = source
        .split('\n')
        .map((line, i) => ({ line: line.trim(), number: i + 1 }))
        .filter(({ line }) => !line.startsWith('//'))
        .filter(({ line }) => /toLocaleString\(\s*\)/.test(line));

      expect(
        offenders.map((o) => `${rel}:${o.number} — ${o.line}`),
        'toLocaleString() with no locale uses the server default (en-US on Vercel). ' +
          'Use formatMoney from lib/notify.ts.',
      ).toEqual([]);
    });
  }
});
