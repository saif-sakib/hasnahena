/**
 * Shared types for Hasnahena official documents.
 * All money values are whole taka (BigInt in the database) — never paisa.
 */

export type DocumentLocale = 'bn' | 'en';

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
  /** Optional account number printed in the statement header. */
  accountNumber?: string;
}

export interface MembershipCertificateData {
  memberName: string;
  memberId: string;
  accountNumber?: string;
  memberSince: string;
  phone?: string;
  address?: string;
}
