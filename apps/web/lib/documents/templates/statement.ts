/** Account statement — the member-facing ledger view of an account. */

import {
  amountInWords,
  buildDocumentId,
  esc,
  formatCurrency,
  formatDate,
  formatNumber,
  isBn,
  orDash,
  txDirection,
  txLabel,
} from '../format';
import { DEFAULT_ORG, renderShell, renderSignatures } from '../theme';
import type { OrgSettings, StatementData, StatementTransaction } from '../types';

const byDateAscending = (a: StatementTransaction, b: StatementTransaction): number => {
  const left = new Date(a.date).getTime();
  const right = new Date(b.date).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return 0;
  return left - right;
};

export function generateStatementHTML(
  data: StatementData,
  locale: string = 'bn',
  org: OrgSettings = DEFAULT_ORG
): string {
  const bn = isBn(locale);
  const title = bn ? 'হিসাব বিবরণী' : 'ACCOUNT STATEMENT';
  const documentId = buildDocumentId('STMT', data.memberId);

  // A statement reads chronologically, whatever order the caller collected in.
  const rows = [...(data.transactions ?? [])].sort(byDateAscending);

  // Totals are derived from the printed rows so the footer always ties out with
  // the table above it; caller-supplied totals are the fallback for an empty period.
  const derived = rows.reduce(
    (acc, tx) => {
      const amount = Math.round(tx.amount || 0);
      if (txDirection(tx.type) === 'credit') acc.credit += amount;
      else acc.debit += amount;
      return acc;
    },
    { credit: 0, debit: 0 }
  );
  const totalCredit = rows.length ? derived.credit : Math.round(data.totalDeposits || 0);
  const totalDebit = rows.length ? derived.debit : Math.round(data.totalWithdrawals || 0);

  // A statement must tie out: opening + credits − debits = closing. When the
  // caller passes a filtered slice of a longer history, the remainder is shown
  // as one explicit reconciling line rather than leaving the reader to wonder.
  const opening = Math.round(data.openingBalance || 0);
  const closing = Math.round(data.closingBalance || 0);
  const unreconciled = closing - (opening + totalCredit - totalDebit);

  // The summary tiles and the table footer must quote the same figures, and both
  // must satisfy opening + credits − debits = closing.
  const summaryCredit = totalCredit + Math.max(unreconciled, 0);
  const summaryDebit = totalDebit + Math.max(-unreconciled, 0);

  const openingRow = `
    <tr class="boundary">
      <td colspan="4">${bn ? 'প্রারম্ভিক স্থিতি' : 'Opening balance'}</td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num balance">${formatCurrency(data.openingBalance, locale)}</td>
    </tr>`;

  const bodyRows = rows
    .map((tx, index) => {
      const isCredit = txDirection(tx.type) === 'credit';
      const amount = formatCurrency(tx.amount, locale);
      const particulars = tx.description?.trim()
        ? `${txLabel(tx.type, locale)} — ${esc(tx.description.trim())}`
        : txLabel(tx.type, locale);
      return `
      <tr>
        <td class="muted">${formatNumber(index + 1, locale)}</td>
        <td>${formatDate(tx.date, locale)}</td>
        <td>${particulars}</td>
        <td class="muted ref">${orDash(tx.receiptNumber)}</td>
        <td class="num credit">${isCredit ? amount : ''}</td>
        <td class="num debit">${isCredit ? '' : amount}</td>
        <td class="num balance">${formatCurrency(tx.balance, locale)}</td>
      </tr>`;
    })
    .join('');

  const table = `
    <table class="ledger">
      <thead>
        <tr>
          <th style="width: 5%;">${bn ? 'ক্রম' : '#'}</th>
          <th style="width: 14%;">${bn ? 'তারিখ' : 'Date'}</th>
          <th style="width: 32%;">${bn ? 'বিবরণ' : 'Particulars'}</th>
          <th style="width: 15%;">${bn ? 'রশিদ নং' : 'Receipt'}</th>
          <th style="width: 11%; text-align: right;">${bn ? 'জমা' : 'Credit'}</th>
          <th style="width: 11%; text-align: right;">${bn ? 'উত্তোলন' : 'Debit'}</th>
          <th style="width: 12%; text-align: right;">${bn ? 'স্থিতি' : 'Balance'}</th>
        </tr>
      </thead>
      <tbody>
        ${openingRow}
        ${bodyRows}
        ${unreconciled !== 0
          ? `<tr class="boundary">
               <td colspan="4">${bn
                 ? 'এই বিবরণীর বাইরের অন্যান্য এন্ট্রি'
                 : 'Other entries outside this statement'}</td>
               <td class="num credit">${unreconciled > 0 ? formatCurrency(unreconciled, locale) : ''}</td>
               <td class="num debit">${unreconciled < 0 ? formatCurrency(-unreconciled, locale) : ''}</td>
               <td class="num balance">${formatCurrency(data.closingBalance, locale)}</td>
             </tr>`
          : ''}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4">${bn ? 'সর্বমোট' : 'Totals'}</td>
          <td class="num credit">${formatCurrency(summaryCredit, locale)}</td>
          <td class="num debit">${formatCurrency(summaryDebit, locale)}</td>
          <td class="num">${formatCurrency(data.closingBalance, locale)}</td>
        </tr>
      </tfoot>
    </table>`;

  const emptyState = `
    <div class="empty-state">
      ${bn
        ? 'নির্বাচিত সময়কালে কোনো লেনদেন পাওয়া যায়নি।'
        : 'No transactions were recorded in the selected period.'}
    </div>`;

  const body = `
    <section class="panel">
      <div class="panel-title">${bn ? 'হিসাবধারীর তথ্য' : 'Account Holder'}</div>
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
          <span class="kv-label">${bn ? 'হিসাব নং' : 'Account No'}</span>
          <span class="kv-value">${orDash(data.accountNumber)}</span>
        </div>
        <div class="kv wide">
          <span class="kv-label">${bn ? 'বিবরণীর সময়কাল' : 'Statement period'}</span>
          <span class="kv-value">${formatDate(data.periodStart, locale)} — ${formatDate(data.periodEnd, locale)}</span>
        </div>
      </div>
    </section>

    <div class="tiles">
      <div class="tile">
        <div class="label">${bn ? 'প্রারম্ভিক স্থিতি' : 'Opening balance'}</div>
        <div class="value">${formatCurrency(data.openingBalance, locale)}</div>
      </div>
      <div class="tile credit">
        <div class="label">${bn ? 'মোট জমা' : 'Total credits'}</div>
        <div class="value">${formatCurrency(summaryCredit, locale)}</div>
      </div>
      <div class="tile debit">
        <div class="label">${bn ? 'মোট উত্তোলন' : 'Total debits'}</div>
        <div class="value">${formatCurrency(summaryDebit, locale)}</div>
      </div>
      <div class="tile accent">
        <div class="label">${bn ? 'সমাপনী স্থিতি' : 'Closing balance'}</div>
        <div class="value">${formatCurrency(data.closingBalance, locale)}</div>
      </div>
    </div>

    <section class="panel">
      <div class="panel-title">
        ${bn ? 'লেনদেনের বিবরণ' : 'Transaction details'}
        · ${formatNumber(rows.length, locale)} ${bn ? 'টি এন্ট্রি' : rows.length === 1 ? 'entry' : 'entries'}
      </div>
      ${rows.length ? table : emptyState}
    </section>

    <div class="notice">
      <strong>${bn ? 'সমাপনী স্থিতি' : 'Closing balance'}:</strong>
      ${formatCurrency(data.closingBalance, locale)} —
      ${esc(amountInWords(data.closingBalance, locale))}
    </div>`;

  return renderShell({
    locale,
    org,
    title,
    refLabel: bn ? 'সদস্য আইডি' : 'Member ID',
    refValue: data.memberId || '—',
    documentId,
    windowTitle: `${title} · ${data.memberId}`,
    body,
    signatures: renderSignatures([
      { role: bn ? 'সদস্যের স্বাক্ষর' : 'Member signature' },
      { role: bn ? 'অনুমোদিত স্বাক্ষর' : 'Authorised signature', who: DEFAULT_ORG.nameEn },
    ]),
  });
}
