/**
 * Qard al-Hasan loan agreement.
 *
 * The zero-interest terms are printed explicitly: an interest-free loan document
 * that does not state the rate is worthless as evidence of Shariah compliance.
 */

import {
  amountInWords,
  documentIdFromReference,
  esc,
  formatCurrency,
  formatDate,
  formatNumber,
  isBn,
  orDash,
} from '../format';
import { DEFAULT_ORG, renderShell, renderSignatures } from '../theme';
import type { LoanDocumentData, OrgSettings } from '../types';

const TERMS = {
  bn: [
    'এই ঋণ কর্জে হাসানাহ্ নীতিতে প্রদান করা হয়েছে — কোনো সুদ, মুনাফা বা প্রক্রিয়াকরণ ফি প্রযোজ্য নয়।',
    'ঋণগ্রহীতা প্রতি কিস্তির নির্ধারিত তারিখে সম্পূর্ণ কিস্তি পরিশোধ করতে বাধ্য থাকবেন।',
    'ঋণগ্রহীতা যেকোনো সময় আংশিক বা সম্পূর্ণ অগ্রিম পরিশোধ করতে পারবেন; এতে কোনো অতিরিক্ত চার্জ নেই।',
    'কিস্তি পরিশোধে বিলম্ব হলে ফাউন্ডেশনের নীতিমালা অনুযায়ী নির্ধারিত নির্দিষ্ট (সুদবিহীন) বিলম্ব ফি প্রযোজ্য হতে পারে।',
    'ঋণ খেলাপি হলে আদায় ক্রমান্বয়ে — প্রথমে ঋণগ্রহীতার নিজস্ব সঞ্চয়, এরপর জামিনদারের সঞ্চয়, সবশেষে অনুদান তহবিল থেকে সম্পন্ন হবে।',
    'জামিনদার ঋণ চলমান থাকা অবস্থায় তাঁর মূল সঞ্চয় উত্তোলন করতে পারবেন না।',
    'সকল বিরোধ ফাউন্ডেশনের নীতিমালা ও প্রযোজ্য সমবায় আইন অনুযায়ী নিষ্পত্তি হবে।',
  ],
  en: [
    'This loan is granted under Qard al-Hasan: no interest, profit, or processing fee is charged at any stage.',
    'The borrower shall pay each installment in full on its due date.',
    'The borrower may prepay part or all of the outstanding amount at any time at no additional cost.',
    'Late payment may attract a fixed, interest-free late fee as set by foundation policy.',
    'On default, recovery proceeds in order: the borrower’s own savings, then the guarantor’s savings, then the donation pool.',
    'A guarantor may not withdraw their base deposit while the guarantee remains active.',
    'All disputes shall be resolved under foundation policy and applicable cooperative law.',
  ],
};

export function generateLoanDocumentHTML(
  data: LoanDocumentData,
  locale: string = 'bn',
  org: OrgSettings = DEFAULT_ORG
): string {
  const bn = isBn(locale);
  const title = bn ? 'ঋণ চুক্তিপত্র' : 'LOAN AGREEMENT';

  // Under Qard al-Hasan the borrower repays the principal and not one taka more,
  // so equal-installment rounding is absorbed by the final installment rather
  // than inflating the total — a schedule summing above the principal is riba.
  const principal = Math.round(data.principalAmount || 0);
  const count = Math.max(0, Math.round(data.totalInstallments || 0));
  const perInstallment = Math.round(data.installmentAmount || 0);
  const scheduled = perInstallment * count;
  const finalInstallment = count > 0 ? principal - perInstallment * (count - 1) : 0;
  const needsAdjustment = count > 1 && scheduled !== principal;

  const body = `
    <section class="panel">
      <div class="panel-title">${bn ? 'ঋণগ্রহীতার তথ্য' : 'Borrower'}</div>
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
          <span class="kv-label">${bn ? 'বিতরণের তারিখ' : 'Disbursement date'}</span>
          <span class="kv-value">${data.disbursementDate ? formatDate(data.disbursementDate, locale) : '—'}</span>
        </div>
        ${data.memberAddress
          ? `<div class="kv wide">
               <span class="kv-label">${bn ? 'ঠিকানা' : 'Address'}</span>
               <span class="kv-value">${orDash(data.memberAddress)}</span>
             </div>`
          : ''}
      </div>
    </section>

    ${data.guarantorName
      ? `<section class="panel">
           <div class="panel-title">${bn ? 'জামিনদারের তথ্য' : 'Guarantor'}</div>
           <div class="kv-grid">
             <div class="kv">
               <span class="kv-label">${bn ? 'নাম' : 'Name'}</span>
               <span class="kv-value">${orDash(data.guarantorName)}</span>
             </div>
             <div class="kv">
               <span class="kv-label">${bn ? 'মোবাইল' : 'Mobile'}</span>
               <span class="kv-value">${orDash(data.guarantorPhone)}</span>
             </div>
           </div>
         </section>`
      : ''}

    <div class="tiles three">
      <div class="tile accent">
        <div class="label">${bn ? 'মূল ঋণ' : 'Principal'}</div>
        <div class="value">${formatCurrency(data.principalAmount, locale)}</div>
      </div>
      <div class="tile">
        <div class="label">${bn ? 'কিস্তি সংখ্যা' : 'Installments'}</div>
        <div class="value">${formatNumber(data.totalInstallments, locale)}</div>
      </div>
      <div class="tile">
        <div class="label">${bn ? 'প্রতি কিস্তি' : 'Per installment'}</div>
        <div class="value">${formatCurrency(data.installmentAmount, locale)}</div>
      </div>
    </div>

    <section class="panel">
      <div class="panel-title">${bn ? 'ঋণের বিবরণ' : 'Loan particulars'}</div>
      <div class="kv-grid">
        <div class="kv">
          <span class="kv-label">${bn ? 'সুদের হার' : 'Interest rate'}</span>
          <span class="kv-value">${bn ? '০% — কর্জে হাসানাহ্' : '0% — Qard al-Hasan'}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'প্রক্রিয়াকরণ ফি' : 'Processing fee'}</span>
          <span class="kv-value">${bn ? 'প্রযোজ্য নয়' : 'None'}</span>
        </div>
        <div class="kv">
          <span class="kv-label">${bn ? 'মোট পরিশোধযোগ্য' : 'Total repayable'}</span>
          <span class="kv-value">${formatCurrency(principal, locale)}</span>
        </div>
        ${needsAdjustment
          ? `<div class="kv">
               <span class="kv-label">${bn ? 'শেষ কিস্তি (সমন্বিত)' : 'Final installment (adjusted)'}</span>
               <span class="kv-value">${formatCurrency(finalInstallment, locale)}</span>
             </div>`
          : ''}
        <div class="kv">
          <span class="kv-label">${bn ? 'ঋণ নম্বর' : 'Loan number'}</span>
          <span class="kv-value">${orDash(data.loanNumber)}</span>
        </div>
        <div class="kv wide">
          <span class="kv-label">${bn ? 'কথায় (মূল ঋণ)' : 'Principal in words'}</span>
          <span class="kv-value">${esc(amountInWords(principal, locale))}</span>
        </div>
        ${needsAdjustment
          ? `<div class="kv wide">
               <span class="kv-label" style="font-weight: 400;">${bn
                 ? `প্রথম ${formatNumber(count - 1, locale)} কিস্তি ${formatCurrency(perInstallment, locale)} এবং শেষ কিস্তি ${formatCurrency(finalInstallment, locale)} — মোট পরিশোধ মূল ঋণের সমান, কোনো অতিরিক্ত নয়।`
                 : `First ${formatNumber(count - 1, locale)} installments of ${formatCurrency(perInstallment, locale)} and a final installment of ${formatCurrency(finalInstallment, locale)}; the total repaid equals the principal exactly.`}</span>
               <span class="kv-value"></span>
             </div>`
          : ''}
        ${data.purpose
          ? `<div class="kv wide">
               <span class="kv-label">${bn ? 'ঋণের উদ্দেশ্য' : 'Purpose'}</span>
               <span class="kv-value">${orDash(data.purpose)}</span>
             </div>`
          : ''}
      </div>
    </section>

    <section class="terms">
      <div class="panel-title">${bn ? 'শর্তাবলী' : 'Terms & conditions'}</div>
      <ol>
        ${(bn ? TERMS.bn : TERMS.en).map((term) => `<li>${esc(term)}</li>`).join('')}
      </ol>
    </section>`;

  return renderShell({
    locale,
    org,
    title,
    refLabel: bn ? 'ঋণ নম্বর' : 'Loan No',
    refValue: data.loanNumber || '—',
    documentId: documentIdFromReference('LOAN', data.loanNumber),
    windowTitle: `${title} · ${data.loanNumber}`,
    body,
    signatures: renderSignatures([
      { role: bn ? 'ঋণগ্রহীতার স্বাক্ষর' : 'Borrower signature' },
      { role: bn ? 'জামিনদারের স্বাক্ষর' : 'Guarantor signature' },
      { role: bn ? 'অনুমোদনকারী কর্মকর্তা' : 'Authorising officer', who: DEFAULT_ORG.nameEn },
    ]),
  });
}
