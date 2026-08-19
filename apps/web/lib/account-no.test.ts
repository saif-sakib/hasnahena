import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_NO_PREFIX,
  formatAccountNo,
  formatAccountSequenceNumber,
  parseAccountSequence,
  isStandardAccountNo,
  NEXT_ACCOUNT_NO_SQL,
} from './account-no';

describe('member id formatting', () => {
  it('pads to three digits', () => {
    expect(formatAccountSequenceNumber(1)).toBe('001');
    expect(formatAccountSequenceNumber(42)).toBe('042');
    expect(formatAccountSequenceNumber(999)).toBe('999');
  });

  it('stops padding rather than truncating past 999', () => {
    // The foundation will pass 999 members one day. Padding is cosmetic and
    // widening it must not change any existing id, so 1000 has to grow, never
    // wrap — an id that collides with an existing member is unrecoverable once
    // it is printed on a passbook.
    expect(formatAccountSequenceNumber(1000)).toBe('1000');
    expect(formatAccountNo(1000)).toBe('ACC-KH-331000');
  });

  it('builds ids on the documented prefix', () => {
    expect(formatAccountNo(1)).toBe(`${ACCOUNT_NO_PREFIX}001`);
    expect(formatAccountNo(7)).toBe('ACC-KH-33007');
  });
});

describe('parseAccountSequence', () => {
  it('round-trips every id formatAccountNo can produce', () => {
    for (const seq of [1, 9, 10, 99, 100, 999, 1000, 12345]) {
      expect(parseAccountSequence(formatAccountNo(seq))).toBe(seq);
    }
  });

  it('returns null for anything that is not a standard id', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'ACC-KH-33',        // prefix with no sequence
      'ACC-KH-33abc',     // non-numeric sequence
      'acc-kh-33001',     // lower case — the regex is deliberately exact
      'ACC-KH-34001',     // wrong branch code
      ' ACC-KH-33001',    // leading space
      'ACC-KH-33001 ',    // trailing space
      'XACC-KH-33001',
    ]) {
      expect(parseAccountSequence(bad as string | null | undefined)).toBeNull();
    }
  });

  it('reads leading zeros as decimal, not octal', () => {
    // Number.parseInt with an explicit radix. Without it, "008" would be a
    // classic source of an off-by-something that only shows up for members 8
    // and 9 of every hundred.
    expect(parseAccountSequence('ACC-KH-33008')).toBe(8);
    expect(parseAccountSequence('ACC-KH-33009')).toBe(9);
  });
});

describe('isStandardAccountNo', () => {
  it('agrees with parseAccountSequence on every input', () => {
    const inputs = [
      'ACC-KH-33001', 'ACC-KH-331000', 'ACC-KH-33', 'acc-kh-33001',
      '', null, undefined, 'LEGACY-7', 'ACC-KH-33abc',
    ];
    for (const input of inputs) {
      expect(isStandardAccountNo(input as string | null | undefined))
        .toBe(parseAccountSequence(input as string | null | undefined) !== null);
    }
  });
});

describe('NEXT_ACCOUNT_NO_SQL', () => {
  it('matches the same shape the TypeScript regex accepts', () => {
    // These two must stay in agreement: the SQL picks the next sequence and the
    // regex validates what comes back. If one is widened without the other, ids
    // are allocated that the application then refuses to parse.
    expect(NEXT_ACCOUNT_NO_SQL).toContain('ACC-KH-33');
    expect(NEXT_ACCOUNT_NO_SQL).toContain('+ 1 AS next_seq');
    // COALESCE(..., 0) + 1 means an empty table yields 1, not null.
    expect(NEXT_ACCOUNT_NO_SQL).toContain('COALESCE');
  });
});
