/** Account statement — the member-facing ledger view of an account. */

import {
  amountInWords,
  buildDocumentId,
  documentFilename,
  formatAmount,
  formatCurrency,
  formatDate,
  formatNumber,
  orDash,
  txDirection,
  txLabel,
} from '../format';
import { DEFAULT_ORG } from '../theme';
import type {
  Block,
  Column,
  DocumentModel,
  OrgSettings,
  Row,
  StatementData,
  StatementTransaction,
} from '../types';

// Widths are shares of the content width and must sum to 1. Reference must fit
// a 15-char document number at 8pt (TEST-25); boundaries.test.ts measures it.
const COLUMNS: Column[] = [
  { header: '#', width: 0.05 },
  { header: 'Date', width: 0.13 },
  { header: 'Particulars', width: 0.27 },
  { header: 'Reference', width: 0.18 },
  { header: 'Credit (BDT)', width: 0.12, align: 'right' },
  { header: 'Debit (BDT)', width: 0.12, align: 'right' },
  // 0.13: "BALANCE (BDT)" headers do not wrap.
  { header: 'Balance (BDT)', width: 0.13, align: 'right' },
];

const byDateAscending = (a: StatementTransaction, b: StatementTransaction): number => {
  const left = new Date(a.date).getTime();
  const right = new Date(b.date).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return 0;
  return left - right;
};

export function buildStatement(
  data: StatementData,
  org: OrgSettings = DEFAULT_ORG
): DocumentModel {
  // A statement reads chronologically, whatever order the caller collected in.
  const entries = [...(data.transactions ?? [])].sort(byDateAscending);

  // Totals are derived from the printed rows so the footer always ties out with
  // the table above it; caller-supplied totals are the fallback for an empty period.
  const derived = entries.reduce(
    (acc, tx) => {
      const amount = Math.round(tx.amount || 0);
      if (txDirection(tx.type) === 'credit') acc.credit += amount;
      else acc.debit += amount;
      return acc;
    },
    { credit: 0, debit: 0 }
  );
  const totalCredit = entries.length ? derived.credit : Math.round(data.totalDeposits || 0);
  const totalDebit = entries.length ? derived.debit : Math.round(data.totalWithdrawals || 0);

  // Must tie out: opening + credits − debits = closing (a filtered slice gets a
  // reconciling line).
  const opening = Math.round(data.openingBalance || 0);
  const closing = Math.round(data.closingBalance || 0);
  const unreconciled = closing - (opening + totalCredit - totalDebit);

  // The summary tiles and the table footer must quote the same figures, and both
  // must satisfy opening + credits − debits = closing.
  const summaryCredit = totalCredit + Math.max(unreconciled, 0);
  const summaryDebit = totalDebit + Math.max(-unreconciled, 0);

  const rows: Row[] = [
    {
      variant: 'boundary',
      cells: [
        { text: '' },
        { text: '' },
        { text: 'Opening balance', bold: true },
        { text: '' },
        { text: '' },
        { text: '' },
        { text: formatAmount(opening), bold: true },
      ],
    },
  ];

  entries.forEach((tx, index) => {
    const isCredit = txDirection(tx.type) === 'credit';
    const amount = formatAmount(tx.amount);
    const description = tx.description?.trim();
    rows.push({
      cells: [
        { text: formatNumber(index + 1), tone: 'muted' },
        { text: formatDate(tx.date) },
        { text: description ? `${txLabel(tx.type)} — ${description}` : txLabel(tx.type) },
        { text: orDash(tx.receiptNumber), tone: 'muted' },
        { text: isCredit ? amount : '', tone: 'credit' },
        { text: isCredit ? '' : amount, tone: 'debit' },
        { text: formatAmount(tx.balance), bold: true },
      ],
    });
  });

  if (unreconciled !== 0) {
    rows.push({
      variant: 'boundary',
      cells: [
        { text: '' },
        { text: '' },
        { text: 'Other entries outside this statement' },
        { text: '' },
        { text: unreconciled > 0 ? formatAmount(unreconciled) : '', tone: 'credit' },
        { text: unreconciled < 0 ? formatAmount(-unreconciled) : '', tone: 'debit' },
        { text: formatAmount(closing), bold: true },
      ],
    });
  }

  const entryCount = `${formatNumber(entries.length)} ${entries.length === 1 ? 'entry' : 'entries'}`;

  const blocks: Block[] = [
    {
      kind: 'fields',
      title: 'Account holder',
      fields: [
        { label: 'Name', value: orDash(data.memberName) },
        { label: 'Account No', value: orDash(data.accountNo) },
        { label: 'Mobile', value: orDash(data.memberPhone) },
        {
          label: 'Statement period',
          value: `${formatDate(data.periodStart)} — ${formatDate(data.periodEnd)}`,
          wide: true,
        },
      ],
    },
    {
      kind: 'tiles',
      tiles: [
        { label: 'Opening balance', value: formatCurrency(opening) },
        { label: 'Total credits', value: formatCurrency(summaryCredit), tone: 'credit' },
        { label: 'Total debits', value: formatCurrency(summaryDebit), tone: 'debit' },
        { label: 'Closing balance', value: formatCurrency(closing), tone: 'accent' },
      ],
    },
    entries.length
      ? {
          kind: 'table',
          title: `Transaction details · ${entryCount}`,
          columns: COLUMNS,
          rows,
          foot: [
            { text: '' },
            { text: '' },
            { text: 'Totals' },
            { text: '' },
            { text: formatAmount(summaryCredit), tone: 'credit' },
            { text: formatAmount(summaryDebit), tone: 'debit' },
            { text: formatAmount(closing) },
          ],
        }
      : {
          kind: 'placeholder',
          text: 'No transactions were recorded in the selected period.',
        },
    {
      kind: 'notice',
      text: `Closing balance: ${formatCurrency(closing)} — ${amountInWords(closing)}`,
    },
    {
      kind: 'signatures',
      signatures: [
        { role: 'Member signature' },
        { role: 'Authorised signature', who: DEFAULT_ORG.nameEn },
      ],
    },
  ];

  return {
    title: 'Account Statement',
    refLabel: 'Account No',
    refValue: orDash(data.accountNo),
    documentId: buildDocumentId('STMT', data.accountNo),
    filename: documentFilename('Statement', data.accountNo, formatDate(data.periodEnd)),
    org,
    blocks,
  };
}
