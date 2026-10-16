/**
 * Qard al-Hasan loan agreement. States the zero rate explicitly, and DENIES a
 * late fee rather than staying silent (rule 3).
 */

import {
  amountInWords,
  documentFilename,
  documentIdFromReference,
  formatCurrency,
  formatDate,
  formatNumber,
  orDash,
} from '../format';
import { DEFAULT_ORG } from '../theme';
import type { Block, DocumentModel, Field, LoanDocumentData, OrgSettings } from '../types';

const TERMS = [
  'This loan is granted under Qard al-Hasan: no interest, profit, or markup is charged at any stage.',
  'The only payment beyond the principal is BDT 500 for office expenses, paid once at the time of application. It is non-refundable, the same for every loan amount, and not added to the loan.',
  'The borrower shall pay each installment in full on its due date.',
  'The borrower may prepay part or all of the outstanding amount at any time at no additional cost.',
  'No late fee, penalty, or additional charge of any kind is applied to a late or missed installment.',
  'On default, recovery proceeds in order: the borrower’s own savings, then the guarantor’s savings, then the donation pool.',
  'A guarantor may not withdraw their base deposit while the guarantee remains active.',
  'All disputes shall be resolved under foundation policy and applicable cooperative law.',
];

export function buildLoanAgreement(
  data: LoanDocumentData,
  org: OrgSettings = DEFAULT_ORG
): DocumentModel {
  // Rounding goes in the final instalment, never on top of the principal (riba).
  const principal = Math.round(data.principalAmount || 0);
  const count = Math.max(0, Math.round(data.totalInstallments || 0));
  const perInstallment = Math.round(data.installmentAmount || 0);
  const finalInstallment = count > 0 ? principal - perInstallment * (count - 1) : 0;
  const needsAdjustment = count > 1 && perInstallment * count !== principal;

  const particulars: Field[] = [
    { label: 'Interest rate', value: '0% — Qard al-Hasan' },
    { label: 'Office expense', value: 'BDT 500 at application, non-refundable — not part of this loan' },
    { label: 'Total repayable', value: formatCurrency(principal) },
    { label: 'Loan number', value: orDash(data.loanNumber) },
  ];
  if (needsAdjustment) {
    particulars.push({
      label: 'Final installment (adjusted)',
      value: formatCurrency(finalInstallment),
    });
  }
  particulars.push({
    label: 'Principal in words',
    value: amountInWords(principal),
    wide: true,
  });
  if (needsAdjustment) {
    particulars.push({
      label: 'Repayment schedule',
      value:
        `First ${formatNumber(count - 1)} installments of ${formatCurrency(perInstallment)} ` +
        `and a final installment of ${formatCurrency(finalInstallment)}; ` +
        'the total repaid equals the principal exactly.',
      wide: true,
    });
  }
  if (data.purpose?.trim()) {
    particulars.push({ label: 'Purpose', value: data.purpose.trim(), wide: true });
  }

  const borrower: Field[] = [
    { label: 'Name', value: orDash(data.memberName) },
    { label: 'Account No', value: orDash(data.accountNo) },
    { label: 'Mobile', value: orDash(data.memberPhone) },
    { label: 'Disbursement date', value: formatDate(data.disbursementDate) },
  ];
  if (data.memberAddress?.trim()) {
    borrower.push({ label: 'Address', value: data.memberAddress.trim(), wide: true });
  }

  const blocks: Block[] = [{ kind: 'fields', title: 'Borrower', fields: borrower }];

  if (data.guarantorName?.trim()) {
    blocks.push({
      kind: 'fields',
      title: 'Guarantor',
      fields: [
        { label: 'Name', value: orDash(data.guarantorName) },
        { label: 'Mobile', value: orDash(data.guarantorPhone) },
      ],
    });
  }

  blocks.push(
    {
      kind: 'tiles',
      tiles: [
        { label: 'Principal', value: formatCurrency(principal), tone: 'accent' },
        { label: 'Installments', value: formatNumber(count) },
        { label: 'Per installment', value: formatCurrency(perInstallment) },
      ],
    },
    { kind: 'fields', title: 'Loan particulars', fields: particulars },
    { kind: 'terms', title: 'Terms & conditions', items: TERMS },
    {
      kind: 'signatures',
      signatures: [
        { role: 'Borrower signature' },
        { role: 'Guarantor signature' },
        { role: 'Authorising officer', who: DEFAULT_ORG.nameEn },
      ],
    }
  );

  return {
    title: 'Loan Agreement',
    refLabel: 'Loan No',
    refValue: orDash(data.loanNumber),
    documentId: documentIdFromReference('LOAN', data.loanNumber),
    filename: documentFilename('Loan-Agreement', data.loanNumber || data.accountNo),
    org,
    blocks,
  };
}
