/** Deposit / withdrawal receipt — the counterpart of a paper passbook entry. */

import {
  amountInWords,
  documentFilename,
  documentIdFromReference,
  formatCurrency,
  formatDateTime,
  orDash,
  txDirection,
  txLabel,
} from '../format';
import { DEFAULT_ORG, LEDGER_NOTICE } from '../theme';
import type { Block, DocumentModel, OrgSettings, ReceiptData } from '../types';

export function buildReceipt(
  data: ReceiptData,
  org: OrgSettings = DEFAULT_ORG
): DocumentModel {
  const direction = txDirection(data.type);
  const kind = txLabel(data.type);

  const blocks: Block[] = [
    {
      kind: 'fields',
      title: 'Member & transaction',
      fields: [
        { label: 'Name', value: orDash(data.memberName) },
        { label: 'Member ID', value: orDash(data.memberId) },
        { label: 'Mobile', value: orDash(data.memberPhone) },
        { label: 'Transaction type', value: kind },
        { label: 'Date & time', value: formatDateTime(data.date) },
        { label: 'Processed by', value: orDash(data.processedBy) },
      ],
    },
    {
      kind: 'amount',
      label: `${kind} amount`,
      value: formatCurrency(data.amount),
      words: amountInWords(data.amount),
      tone: direction,
      after: { label: 'Balance after transaction', value: formatCurrency(data.balanceAfter) },
    },
  ];

  const notes = data.notes?.trim();
  if (notes) {
    blocks.push({
      kind: 'fields',
      title: 'Remarks',
      fields: [{ label: '', value: notes, wide: true }],
    });
  }

  blocks.push(
    { kind: 'notice', text: LEDGER_NOTICE },
    {
      kind: 'signatures',
      signatures: [
        { role: 'Member signature' },
        { role: 'Authorised signature', who: DEFAULT_ORG.nameEn },
      ],
    }
  );

  return {
    title: `${kind} Receipt`,
    refLabel: 'Receipt No',
    refValue: orDash(data.receiptNumber),
    documentId: documentIdFromReference('RCPT', data.receiptNumber),
    filename: documentFilename('Receipt', data.receiptNumber || data.memberId),
    org,
    blocks,
  };
}
