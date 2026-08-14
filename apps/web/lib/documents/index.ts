/**
 * Hasnahena official document generation.
 *
 *   generate*HTML(data, locale, org) -> standalone, print-ready HTML
 *   downloadAsPDF(html, filename)    -> paginated A4 PDF
 *   openPrintWindow(html, title)     -> browser print (real text, best quality)
 *
 * Amounts are whole taka everywhere; all interpolated data is HTML-escaped.
 */

export type {
  DocumentLocale,
  LoanDocumentData,
  MembershipCertificateData,
  OrgSettings,
  ReceiptData,
  StatementData,
  StatementTransaction,
  StatementTxType,
} from './types';

export {
  amountInWords,
  esc,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  txDirection,
  txLabel,
} from './format';

export {
  BRAND_LOGO_PATH,
  BRAND_NAME_BN,
  BRAND_NAME_EN,
  DEFAULT_ORG,
  getOrgNameBn,
  getOrgNameEn,
} from './theme';

export { generateReceiptHTML } from './templates/receipt';
export { generateLoanDocumentHTML } from './templates/loan-agreement';
export { generateStatementHTML } from './templates/statement';
export { generateMembershipCertificateHTML } from './templates/membership-certificate';

export { downloadAsHTML, downloadAsPDF, openPrintWindow } from './export';

export { fetchOrgSettings } from './org-settings';
