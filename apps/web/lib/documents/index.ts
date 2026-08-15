/**
 * Hasnahena official document generation.
 *
 *   build*(data, org)          -> a renderer-independent DocumentModel
 *   downloadDocumentPDF(model) -> paginated, text-selectable A4 PDF
 *   printDocument(model)       -> browser print dialog
 *   downloadDocumentHTML(model)-> standalone HTML copy
 *
 * Documents are English only (ADR-012). Amounts are whole taka, printed with
 * the ISO code `BDT`. All interpolated data is HTML-escaped by the HTML renderer.
 */

export type {
  Block,
  Cell,
  Column,
  DocumentModel,
  Field,
  LoanDocumentData,
  MembershipCertificateData,
  OrgSettings,
  ReceiptData,
  Row,
  Signature,
  StatementData,
  StatementTransaction,
  StatementTxType,
  Tile,
  Tone,
} from './types';

export {
  CURRENCY_CODE,
  amountInWords,
  esc,
  formatAmount,
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
  getOrgNameEn,
} from './theme';

export { buildReceipt } from './builders/receipt';
export { buildLoanAgreement } from './builders/loan-agreement';
export { buildStatement } from './builders/statement';
export { buildMembershipCertificate } from './builders/membership-certificate';

export {
  downloadDocumentHTML,
  downloadDocumentPDF,
  printDocument,
  renderHTML,
  renderPDF,
} from './export';

export { fetchOrgSettings } from './org-settings';
