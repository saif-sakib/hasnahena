/**
 * Types for Hasnahena official documents.
 *
 * Two layers live here:
 *  1. The *data* a caller supplies (ReceiptData, StatementData, …).
 *  2. The *document model* a builder produces — a renderer-independent
 *     description of the page, consumed by both the HTML and the PDF renderer
 *     so the printed and downloaded copies can never drift apart.
 *
 * All money values are whole taka (BigInt in the database) — never paisa.
 * Official documents are English only; see ADR-012.
 */

// ---------------------------------------------------------------------------
// Input data
// ---------------------------------------------------------------------------

export interface OrgSettings {
  name?: string;
  nameEn?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  regNumber?: string;
}

/** Transaction kinds that can appear on a statement. */
export type StatementTxType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'LOAN_DISBURSEMENT'
  | 'LOAN_REPAYMENT'
  | 'DONATION'
  | 'FEE'
  | (string & {});

export interface ReceiptData {
  receiptNumber: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | string;
  amount: number;
  date: string;
  memberName: string;
  memberId: string;
  memberPhone: string;
  balanceAfter: number;
  processedBy?: string;
  notes?: string;
}

export interface LoanDocumentData {
  loanNumber: string;
  memberName: string;
  memberId: string;
  memberPhone: string;
  memberAddress?: string;
  principalAmount: number;
  totalInstallments: number;
  installmentAmount: number;
  disbursementDate?: string;
  guarantorName?: string;
  guarantorPhone?: string;
  purpose?: string;
}

export interface StatementTransaction {
  date: string;
  type: StatementTxType;
  amount: number;
  balance: number;
  description?: string;
  receiptNumber?: string;
}

export interface StatementData {
  memberName: string;
  memberId: string;
  memberPhone: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  totalDeposits: number;
  totalWithdrawals: number;
  transactions: StatementTransaction[];
}

export interface MembershipCertificateData {
  memberName: string;
  memberId: string;
  memberSince: string;
  phone?: string;
  address?: string;
}

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

/** Emphasis applied by both renderers. */
export type Tone = 'default' | 'credit' | 'debit' | 'muted' | 'accent';

export interface Field {
  label: string;
  value: string;
  /** Span both columns of the field grid. */
  wide?: boolean;
}

export interface Tile {
  label: string;
  value: string;
  tone?: Tone;
}

export interface Column {
  header: string;
  /** Share of the content width, 0–1. Must sum to 1 across the table. */
  width: number;
  align?: 'left' | 'right';
}

export interface Cell {
  text: string;
  tone?: Tone;
  /** Overrides the column alignment. */
  align?: 'left' | 'right';
  bold?: boolean;
}

export interface Row {
  cells: Cell[];
  /** `boundary` shades the row — used for opening balance and carried entries. */
  variant?: 'normal' | 'boundary';
}

export interface Signature {
  role: string;
  who?: string;
}

export type Block =
  /** Labelled two-column field grid. */
  | { kind: 'fields'; title: string; fields: Field[] }
  /** The headline amount on a receipt. */
  | {
      kind: 'amount';
      label: string;
      value: string;
      words: string;
      tone: 'credit' | 'debit';
      after?: { label: string; value: string };
    }
  /** Row of summary figures. */
  | { kind: 'tiles'; tiles: Tile[] }
  /** Paginating ledger table with a repeating header. */
  | { kind: 'table'; title?: string; columns: Column[]; rows: Row[]; foot?: Cell[] }
  /** Centred certificate wording. */
  | { kind: 'certify'; intro: string; name: string; subtitle: string; body: string }
  /** Boxed callout. */
  | { kind: 'notice'; text: string }
  /** Numbered terms and conditions. */
  | { kind: 'terms'; title: string; items: string[] }
  /** Empty-table placeholder. */
  | { kind: 'placeholder'; text: string }
  /** Sign-off row; always kept together on one page. */
  | { kind: 'signatures'; signatures: Signature[] };

export interface DocumentModel {
  /** Uppercase document type, e.g. "ACCOUNT STATEMENT". */
  title: string;
  /** Reference printed at the right of the title bar. */
  refLabel: string;
  refValue: string;
  /** Stable identifier printed in the footer of every page. */
  documentId: string;
  /** Download filename, without extension. */
  filename: string;
  org: OrgSettings;
  blocks: Block[];
}
