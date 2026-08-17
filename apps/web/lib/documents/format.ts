/**
 * Formatting helpers for official documents.
 *
 * Documents are English only (ADR-012), so amounts carry the ISO code `BDT`
 * rather than the `৳` sign: the sign lives in the Bengali Unicode block and
 * cannot be drawn by the PDF renderer's standard fonts. Grouping stays
 * South Asian (1,25,000), which is how figures are read in Bangladesh.
 *
 * `esc()` guards the HTML renderer — document data is member-supplied (names,
 * descriptions, notes) and would otherwise be injected straight into markup.
 */

import type { StatementTxType } from './types';

export const CURRENCY_CODE = 'BDT';

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

/**
 * Fallback for empty fields so documents never print "undefined".
 * Returns plain text — escaping is the HTML renderer's job, because the PDF
 * renderer needs the raw string.
 */
export const orDash = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text.length > 0 ? text : '—';
};

/** Grouped figure with no currency code — for table columns headed "(BDT)". */
export function formatAmount(amount: number): string {
  const value = Number.isFinite(amount) ? Math.round(amount) : 0;
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** "BDT 1,25,000" — money is whole taka, so no fractional digits are printed. */
export function formatCurrency(amount: number): string {
  return `${CURRENCY_CODE} ${formatAmount(amount)}`;
}

/** Plain grouped number (counts, installments). */
export function formatNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

const parseDate = (input?: string): Date | null => {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function formatDate(dateStr?: string): string {
  const date = parseDate(dateStr);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function formatDateTime(dateStr?: string): string {
  const date = parseDate(dateStr);
  if (!date) return '—';
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(dateStr)}, ${time}`;
}

// ---------------------------------------------------------------------------
// Amount in words — required on Bangladeshi financial receipts as a tamper
// check. Uses the South Asian numbering system (thousand / lakh / crore).
// ---------------------------------------------------------------------------

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const twoDigit = (n: number): string =>
  n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;

const belowThousand = (n: number): string => {
  if (n === 0) return '';
  if (n < 100) return twoDigit(n);
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` ${twoDigit(rest)}` : ''}`;
};

const UNITS: Array<[number, string]> = [
  [10000000, 'Crore'],
  [100000, 'Lakh'],
  [1000, 'Thousand'],
];

/** 125000 -> "One Lakh Twenty-Five Thousand Taka Only". */
export function amountInWords(amount: number): string {
  let n = Math.abs(Math.round(Number.isFinite(amount) ? amount : 0));
  if (n === 0) return 'Zero Taka Only';

  const parts: string[] = [];
  for (const [divisor, label] of UNITS) {
    const chunk = Math.floor(n / divisor);
    if (chunk > 0) {
      parts.push(`${belowThousand(chunk)} ${label}`);
      n %= divisor;
    }
  }
  if (n > 0) parts.push(belowThousand(n));

  return `${parts.join(' ').replace(/\s+/g, ' ').trim()} Taka Only`;
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

const TX_LABELS: Record<string, string> = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  LOAN_DISBURSEMENT: 'Loan Disbursement',
  LOAN_REPAYMENT: 'Loan Repayment',
  DONATION: 'Donation',
  FEE: 'Fee',
};

export function txLabel(type: StatementTxType): string {
  return TX_LABELS[type] ?? String(type).replace(/_/g, ' ');
}

/**
 * Deterministic, human-readable document id printed on every page.
 * A reference that is already a document number (DEP-2026-…, LOAN-2026-…) is
 * used as-is rather than being prefixed a second time.
 */
export function buildDocumentId(prefix: string, reference: string): string {
  const clean = String(reference || 'NA').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (clean === 'NA' || clean === '') return `${prefix}-NA`;
  if (clean.startsWith(`${prefix}-`)) return clean;
  return `${prefix}-${clean}`;
}

/** Document id for records that carry their own number (receipts, loans). */
export function documentIdFromReference(prefix: string, reference?: string): string {
  const clean = String(reference || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return /^[A-Z]{2,6}-/.test(clean) ? clean : buildDocumentId(prefix, clean || 'NA');
}

/**
 * Make text drawable by the PDF renderer's standard fonts.
 *
 * Documents are English only, but letterhead values come from `system_config`
 * and notes are typed by members, so a Bengali string can still reach a
 * template. Helvetica encodes Latin-1; anything outside it renders as mojibake.
 * Removing it up front makes the failure visible and predictable — a dash where
 * the text would have been — instead of a page of corrupted glyphs.
 *
 * Typographic punctuation is **transliterated, not dropped**. jsPDF discards
 * anything above U+00FF silently, which is worse than mojibake because the
 * result still reads as a sentence: `0% — Qard al-Hasan` printed as
 * `0%  Qard al-Hasan`, and the loan agreement's default clause — the one naming
 * whose savings get taken — printed as "the borrowers own savings, then the
 * guarantors savings", turning two possessives into plurals. Worst of all,
 * `orDash`'s own `—` placeholder vanished, so an empty field printed as a blank
 * gap: exactly the failure this function was written to prevent (TEST-24).
 */
const TRANSLITERATE: Array<[RegExp, string]> = [
  [/[‐-―]/g, '-'], // hyphen, en dash, em dash, horizontal bar
  [/[‘’‚‛]/g, "'"],
  [/[“”„‟]/g, '"'],
  [/…/g, '...'],
  [/•/g, '·'], // bullet -> middle dot, which Latin-1 has
  [/†/g, '+'], // dagger
  [/‰/g, '%'], // per mille
  [/€/g, 'EUR'],
  [/™/g, '(TM)'],
];

/** Anything still outside Latin-1 after transliteration cannot be drawn. */
const NOT_LATIN1 = /[^\x20-\x7E\xA0-\xFF]/g;

export function toPdfSafe(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TRANSLITERATE) {
    out = out.replace(pattern, replacement);
  }
  const cleaned = out.replace(NOT_LATIN1, '').replace(/\s+/g, ' ').trim();
  // A value that was entirely non-Latin would otherwise print as an empty gap.
  return cleaned.length > 0 || text.trim().length === 0 ? cleaned : '-';
}

/** Safe, readable download filename stem. */
export const documentFilename = (...parts: Array<string | undefined>): string =>
  parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('-')
    .replace(/[^\w\-.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'document';
