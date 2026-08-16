import { describe, it, expect } from 'vitest';
import {
  esc,
  formatAmount,
  formatCurrency,
  formatNumber,
  amountInWords,
  CURRENCY_CODE,
} from './format';

// These functions produce what a member is handed on paper. A wrong figure on a
// receipt is a dispute, and ADR-012 makes generated documents English-only, so
// there is exactly one rendering to get right.

describe('formatAmount', () => {
  it('groups in the Indian system, which is what Bangladesh uses', () => {
    // 1,25,000 — not 125,000. Getting this wrong is not a rounding error, it is
    // a document that looks foreign to the person reading it.
    expect(formatAmount(125000)).toBe('1,25,000');
    expect(formatAmount(1000)).toBe('1,000');
    expect(formatAmount(100000)).toBe('1,00,000');
    expect(formatAmount(10000000)).toBe('1,00,00,000');
  });

  it('prints whole taka only — money is BigInt taka, there is no paisa', () => {
    expect(formatAmount(1234.4)).toBe('1,234');
    expect(formatAmount(1234.6)).toBe('1,235');
  });

  it('degrades to 0 rather than printing NaN or Infinity on a document', () => {
    expect(formatAmount(NaN)).toBe('0');
    expect(formatAmount(Infinity)).toBe('0');
    expect(formatAmount(-Infinity)).toBe('0');
  });

  it('keeps the sign on a negative', () => {
    expect(formatAmount(-5000)).toBe('-5,000');
  });
});

describe('formatCurrency', () => {
  it('prefixes the currency code', () => {
    expect(formatCurrency(125000)).toBe(`${CURRENCY_CODE} 1,25,000`);
  });
});

describe('formatNumber', () => {
  it('groups counts without a currency code', () => {
    expect(formatNumber(12)).toBe('12');
    expect(formatNumber(100000)).toBe('1,00,000');
  });

  it('falls back to 0 on a non-finite value', () => {
    expect(formatNumber(NaN)).toBe('0');
  });
});

describe('amountInWords', () => {
  it('writes zero explicitly', () => {
    expect(amountInWords(0)).toBe('Zero Taka Only');
  });

  it('renders the amounts that appear on a loan agreement', () => {
    for (const [amount, expected] of [
      [1, 'One'],
      [10, 'Ten'],
      [100, 'One Hundred'],
      [1000, 'One Thousand'],
    ] as Array<[number, string]>) {
      expect(amountInWords(amount)).toContain(expected);
    }
  });

  it('always ends with the unit, so a figure can never be read bare', () => {
    for (const amount of [1, 999, 10000, 125000, 9999999]) {
      expect(amountInWords(amount)).toMatch(/Taka Only$/);
    }
  });

  it('rounds to whole taka and ignores the sign', () => {
    // The document template supplies the direction (credit/debit); the words
    // carry the magnitude. A minus sign inside written words would read as an
    // error to a member.
    expect(amountInWords(-500)).toBe(amountInWords(500));
    expect(amountInWords(500.4)).toBe(amountInWords(500));
  });

  it('never emits NaN or undefined into a printed document', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const words = amountInWords(bad);
      expect(words).toBe('Zero Taka Only');
      expect(words).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe('esc', () => {
  it('escapes every character that could break out of the HTML template', () => {
    expect(esc('<script>alert(1)</script>')).not.toContain('<script>');
    expect(esc('&')).toBe('&amp;');
    expect(esc('<')).toBe('&lt;');
    expect(esc('>')).toBe('&gt;');
    expect(esc('"')).toBe('&quot;');
  });

  it('escapes the ampersand first, so escapes are not double-escaped', () => {
    // If `&` were replaced after `<`, "&lt;" would become "&amp;lt;" and the
    // member's name would render as literal markup on their own statement.
    expect(esc('<')).toBe('&lt;');
    expect(esc('&lt;')).toBe('&amp;lt;');
  });

  it('renders null and undefined as empty, not as the words', () => {
    // A statement reading "Nominee: undefined" is the kind of detail that
    // destroys confidence in every other number on the page.
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('passes ordinary Bengali names through unchanged', () => {
    expect(esc('মোহাম্মদ রফিক')).toBe('মোহাম্মদ রফিক');
  });
});
