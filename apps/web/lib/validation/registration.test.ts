import { describe, it, expect } from 'vitest';
import { bdPhoneRegex, bdNidRegex } from './registration';

// These two decide who can become a member. They run on the signup form and
// again in the route handler, and a member whose phone was accepted in the wrong
// shape cannot log in — phone is a login identifier (FR-01).

describe('bdPhoneRegex', () => {
  it('accepts every operator prefix in use', () => {
    // 013 Grameenphone, 014 Banglalink, 015 Teletalk, 016 Airtel,
    // 017 Grameenphone, 018 Robi, 019 Banglalink.
    for (const prefix of ['013', '014', '015', '016', '017', '018', '019']) {
      expect(bdPhoneRegex.test(`${prefix}12345678`)).toBe(true);
    }
  });

  it('requires exactly 11 digits', () => {
    expect(bdPhoneRegex.test('0171234567')).toBe(false);   // 10
    expect(bdPhoneRegex.test('017123456789')).toBe(false); // 12
  });

  it('rejects the formats people actually type', () => {
    for (const input of [
      '+8801712345678',   // international prefix
      '8801712345678',    // country code, no plus
      '01712-345678',     // hyphenated
      '01712 345678',     // spaced
      ' 01712345678',     // leading space
      '01712345678 ',     // trailing space
      '11712345678',      // does not start 01
      '',
    ]) {
      expect(bdPhoneRegex.test(input)).toBe(false);
    }
  });

  it('is anchored at both ends', () => {
    // Without anchors a pasted line of text containing a valid number would
    // pass, and the stored identifier would carry the surrounding characters.
    expect(bdPhoneRegex.test('call me on 01712345678 please')).toBe(false);
  });
});

describe('bdNidRegex', () => {
  it('accepts the three lengths Bangladesh issues', () => {
    expect(bdNidRegex.test('1'.repeat(10))).toBe(true); // old
    expect(bdNidRegex.test('1'.repeat(13))).toBe(true); // old, with birth year
    expect(bdNidRegex.test('1'.repeat(17))).toBe(true); // smart card
  });

  it('rejects lengths in between, which are transcription errors', () => {
    for (const len of [9, 11, 12, 14, 15, 16, 18]) {
      expect(bdNidRegex.test('1'.repeat(len))).toBe(false);
    }
  });

  it('rejects non-digits and separators', () => {
    for (const input of ['123 456 7890', '1234-567890', 'abcdefghij', '']) {
      expect(bdNidRegex.test(input)).toBe(false);
    }
  });

  it('is anchored, so a long string containing a valid NID does not pass', () => {
    expect(bdNidRegex.test('nid:1234567890')).toBe(false);
    expect(bdNidRegex.test('1'.repeat(10) + 'x')).toBe(false);
  });
});
