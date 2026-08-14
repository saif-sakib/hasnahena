/**
 * Formatting helpers for official documents.
 *
 * Every value that reaches a template passes through `esc()` — document data is
 * member-supplied (names, descriptions, notes) and would otherwise be injected
 * straight into the generated HTML.
 */

import type { DocumentLocale, StatementTxType } from './types';

export const isBn = (locale: string): boolean => locale === 'bn';

/** Escape text for interpolation into an HTML template. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Fallback for empty fields so documents never print "undefined". */
export const orDash = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text.length > 0 ? esc(text) : '—';
};

/**
 * Money is stored as whole taka, so no fractional digits are printed.
 * Bengali documents use Bengali digits, matching the rest of the UI.
 */
export function formatCurrency(amount: number, locale: string = 'bn'): string {
  const value = Number.isFinite(amount) ? Math.round(amount) : 0;
  const formatted = value.toLocaleString(isBn(locale) ? 'bn-BD' : 'en-IN', {
    maximumFractionDigits: 0,
  });
  return `৳${formatted}`;
}

/** Plain grouped number without the currency symbol (table totals, counts). */
export function formatNumber(value: number, locale: string = 'bn'): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString(isBn(locale) ? 'bn-BD' : 'en-IN', { maximumFractionDigits: 0 });
}

const parseDate = (input: string): Date | null => {
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function formatDate(dateStr: string, locale: string = 'bn'): string {
  const date = parseDate(dateStr);
  if (!date) return '—';
  return date.toLocaleDateString(isBn(locale) ? 'bn-BD' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function formatDateTime(dateStr: string, locale: string = 'bn'): string {
  const date = parseDate(dateStr);
  if (!date) return '—';
  return `${formatDate(dateStr, locale)}, ${date.toLocaleTimeString(
    isBn(locale) ? 'bn-BD' : 'en-GB',
    { hour: '2-digit', minute: '2-digit' }
  )}`;
}

// ---------------------------------------------------------------------------
// Amount in words — required on Bangladeshi financial receipts as a tamper check.
// Uses the South Asian numbering system (hazar / lakh / kuti).
// ---------------------------------------------------------------------------

const EN_ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const BN_NUMBERS = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ',
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছিষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];

const enTwoDigit = (n: number): string =>
  n < 20 ? EN_ONES[n] : `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? `-${EN_ONES[n % 10]}` : ''}`;

const enBelowThousand = (n: number): string => {
  if (n === 0) return '';
  if (n < 100) return enTwoDigit(n);
  const rest = n % 100;
  return `${EN_ONES[Math.floor(n / 100)]} Hundred${rest ? ` ${enTwoDigit(rest)}` : ''}`;
};

const bnBelowThousand = (n: number): string => {
  if (n === 0) return '';
  if (n < 100) return BN_NUMBERS[n];
  const rest = n % 100;
  return `${BN_NUMBERS[Math.floor(n / 100)]} শত${rest ? ` ${BN_NUMBERS[rest]}` : ''}`;
};

/** "৳12,500" -> "Twelve Thousand Five Hundred Taka Only". */
export function amountInWords(amount: number, locale: string = 'bn'): string {
  const bn = isBn(locale);
  let n = Math.abs(Math.round(Number.isFinite(amount) ? amount : 0));
  if (n === 0) return bn ? 'শূন্য টাকা মাত্র' : 'Zero Taka Only';

  const below = bn ? bnBelowThousand : enBelowThousand;
  const units: Array<[number, string]> = bn
    ? [[10000000, 'কোটি'], [100000, 'লক্ষ'], [1000, 'হাজার']]
    : [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']];

  const parts: string[] = [];
  for (const [divisor, label] of units) {
    const chunk = Math.floor(n / divisor);
    if (chunk > 0) {
      parts.push(`${below(chunk)} ${label}`);
      n %= divisor;
    }
  }
  if (n > 0) parts.push(below(n));

  const words = parts.join(' ').replace(/\s+/g, ' ').trim();
  return bn ? `${words} টাকা মাত্র` : `${words} Taka Only`;
}

// ---------------------------------------------------------------------------
// Transaction classification
// ---------------------------------------------------------------------------

/**
 * Direction from the member's point of view: money received is a credit,
 * money paid out is a debit. Used for the statement's credit/debit columns.
 */
export function txDirection(type: StatementTxType): 'credit' | 'debit' {
  switch (type) {
    case 'DEPOSIT':
    case 'LOAN_DISBURSEMENT':
      return 'credit';
    default:
      return 'debit';
  }
}

const TX_LABELS: Record<string, { bn: string; en: string }> = {
  DEPOSIT: { bn: 'জমা', en: 'Deposit' },
  WITHDRAWAL: { bn: 'উত্তোলন', en: 'Withdrawal' },
  LOAN_DISBURSEMENT: { bn: 'ঋণ বিতরণ', en: 'Loan Disbursement' },
  LOAN_REPAYMENT: { bn: 'ঋণ পরিশোধ', en: 'Loan Repayment' },
  DONATION: { bn: 'অনুদান', en: 'Donation' },
  FEE: { bn: 'ফি', en: 'Fee' },
};

export function txLabel(type: StatementTxType, locale: string = 'bn'): string {
  const entry = TX_LABELS[type];
  if (!entry) return esc(String(type).replace(/_/g, ' '));
  return entry[isBn(locale) ? 'bn' : 'en'];
}

/**
 * Deterministic, human-readable document id printed on every page.
 * A reference that is already a document number (RCP-…, LN-…) is used as-is
 * rather than being prefixed a second time.
 */
export function buildDocumentId(prefix: string, reference: string): string {
  const clean = String(reference || 'NA').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (clean === 'NA') return `${prefix}-NA`;
  if (clean.startsWith(`${prefix}-`)) return clean;
  return `${prefix}-${clean}`;
}

/** Document id for records that carry their own number (receipts, loans). */
export function documentIdFromReference(prefix: string, reference?: string): string {
  const clean = String(reference || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return /^[A-Z]{2,5}-/.test(clean) ? clean : buildDocumentId(prefix, clean || 'NA');
}

export type { DocumentLocale };
