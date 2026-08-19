import { describe, it, expect } from 'vitest';
import {
  MEMBER_ID_PREFIX,
  formatMemberId,
  formatMemberSequenceNumber,
  parseMemberSequence,
  isStandardMemberId,
  NEXT_MEMBER_ID_SQL,
} from './member-id';

describe('member id formatting', () => {
  it('pads to three digits', () => {
    expect(formatMemberSequenceNumber(1)).toBe('001');
    expect(formatMemberSequenceNumber(42)).toBe('042');
    expect(formatMemberSequenceNumber(999)).toBe('999');
  });

  it('stops padding rather than truncating past 999', () => {
    // The foundation will pass 999 members one day. Padding is cosmetic and
    // widening it must not change any existing id, so 1000 has to grow, never
    // wrap — an id that collides with an existing member is unrecoverable once
    // it is printed on a passbook.
    expect(formatMemberSequenceNumber(1000)).toBe('1000');
    expect(formatMemberId(1000)).toBe('ACC-KH-331000');
  });

  it('builds ids on the documented prefix', () => {
    expect(formatMemberId(1)).toBe(`${MEMBER_ID_PREFIX}001`);
    expect(formatMemberId(7)).toBe('ACC-KH-33007');
  });
});

describe('parseMemberSequence', () => {
  it('round-trips every id formatMemberId can produce', () => {
    for (const seq of [1, 9, 10, 99, 100, 999, 1000, 12345]) {
      expect(parseMemberSequence(formatMemberId(seq))).toBe(seq);
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
      expect(parseMemberSequence(bad as string | null | undefined)).toBeNull();
    }
  });

  it('reads leading zeros as decimal, not octal', () => {
    // Number.parseInt with an explicit radix. Without it, "008" would be a
    // classic source of an off-by-something that only shows up for members 8
    // and 9 of every hundred.
    expect(parseMemberSequence('ACC-KH-33008')).toBe(8);
    expect(parseMemberSequence('ACC-KH-33009')).toBe(9);
  });
});

describe('isStandardMemberId', () => {
  it('agrees with parseMemberSequence on every input', () => {
    const inputs = [
      'ACC-KH-33001', 'ACC-KH-331000', 'ACC-KH-33', 'acc-kh-33001',
      '', null, undefined, 'LEGACY-7', 'ACC-KH-33abc',
    ];
    for (const input of inputs) {
      expect(isStandardMemberId(input as string | null | undefined))
        .toBe(parseMemberSequence(input as string | null | undefined) !== null);
    }
  });
});

describe('NEXT_MEMBER_ID_SQL', () => {
  it('matches the same shape the TypeScript regex accepts', () => {
    // These two must stay in agreement: the SQL picks the next sequence and the
    // regex validates what comes back. If one is widened without the other, ids
    // are allocated that the application then refuses to parse.
    expect(NEXT_MEMBER_ID_SQL).toContain('ACC-KH-33');
    expect(NEXT_MEMBER_ID_SQL).toContain('+ 1 AS next_seq');
    // COALESCE(..., 0) + 1 means an empty table yields 1, not null.
    expect(NEXT_MEMBER_ID_SQL).toContain('COALESCE');
  });
});
