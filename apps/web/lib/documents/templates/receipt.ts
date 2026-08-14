/** Deposit / withdrawal receipt — the counterpart of a paper passbook entry. */

import {
  amountInWords,
  documentIdFromReference,
  esc,
  formatCurrency,
  formatDateTime,
  isBn,
  orDash,
  txDirection,
  txLabel,
} from '../format';
import { DEFAULT_ORG, renderShell, renderSignatures } from '../theme';
import type { OrgSettings, ReceiptData } from '../types';

export function generateReceiptHTML(
  data: ReceiptData,
  locale: string = 'bn',
  org: OrgSettings = DEFAULT_ORG
): string {
  const bn = isBn(locale);
  const isCredit = txDirection(data.type) === 'credit';
  const kind = txLabel(data.type, locale);

  const title = bn
    ? `${kind} রশিদ`
    : `${kind.toUpperCase()} RECEIPT`;

  const body = `
    <section class="panel">
      <div class="panel-title">${bn ? 'সদস্য ও লেনদেনের তথ্য' : 'Member & transaction'}</div>
      <div class="kv-grid">
        <div class="kv">
          <span class="kv-label">${bn ? 'নাম' : 'Name'}</span>
          <span class="kv-value">${orDash(data.memberName)}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'সদস্য আইডি' : 'Member ID'}</span>
          <span class="kv-value">${orDash(data.memberId)}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'মোবাইল' : 'Mobile'}</span>
          <span class="kv-value">${orDash(data.memberPhone)}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'লেনদেনের ধরন' : 'Transaction type'}</span>
          <span class="kv-value">${esc(kind)}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'তারিখ ও সময়' : 'Date & time'}</span>
          <span class="kv-value">${formatDateTime(data.date, locale)}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'প্রক্রিয়াকারী' : 'Processed by'}</span>
          <span class="kv-value">${orDash(data.processedBy)}</span>
        </div>
      </div>
    </section>

    <div class="amount-hero ${isCredit ? 'credit' : 'debit'}">
      <div class="label">${bn ? 'লেনদেনের পরিমাণ' : `${kind} amount`}</div>
      <div class="value">${formatCurrency(data.amount, locale)}</div>
      <div class="words">
        ${bn ? 'কথায়' : 'In words'}: <b>${esc(amountInWords(data.amount, locale))}</b>
      </div>
      <div class="after">
        ${bn ? 'লেনদেনের পর স্থিতি' : 'Balance after transaction'}:
        <strong>${formatCurrency(data.balanceAfter, locale)}</strong>
      </div>
    </div>

    ${data.notes?.trim()
      ? `<section class="panel">
           <div class="panel-title">${bn ? 'মন্তব্য' : 'Remarks'}</div>
           <div class="kv wide">
             <span class="kv-value" style="text-align: left; font-weight: 400;">${esc(data.notes.trim())}</span>
           </div>
         </section>`
      : ''}`;

  return renderShell({
    locale,
    org,
    title,
    refLabel: bn ? 'রশিদ নং' : 'Receipt No',
    refValue: data.receiptNumber || '—',
    documentId: documentIdFromReference('RCPT', data.receiptNumber),
    windowTitle: `${title} · ${data.receiptNumber}`,
    body,
    signatures: renderSignatures([
      { role: bn ? 'সদস্যের স্বাক্ষর' : 'Member signature' },
      { role: bn ? 'অনুমোদিত স্বাক্ষর' : 'Authorised signature', who: DEFAULT_ORG.nameEn },
    ]),
  });
}
