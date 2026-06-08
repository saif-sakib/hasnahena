/**
 * Hasnahena Official Document Generator
 * Professional document generation with official Hasnahena branding
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface OrgSettings {
  name?: string;
  nameEn?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  regNumber?: string;
}

const BRAND_NAME_EN = 'Hasnahena Foundation';
const BRAND_NAME_BN = 'হাসনাহেনা ফাউন্ডেশন';
const BRAND_LOGO_PATH = '/images/logo.png';
const LEDGER_NOTICE_EN = 'Official ledger book entries are the final record. Online documents are generated for service convenience and must be reconciled with the physical ledger.';
const LEDGER_NOTICE_BN = 'অফিসিয়াল লেজার বইয়ের এন্ট্রিই চূড়ান্ত রেকর্ড। অনলাইন ডকুমেন্ট শুধু সেবার সুবিধার জন্য তৈরি এবং ফিজিক্যাল লেজারের সাথে মিলিয়ে দেখতে হবে।';

export const DEFAULT_ORG: OrgSettings = {
  name: BRAND_NAME_BN,
  nameEn: BRAND_NAME_EN,
  address: 'ভেকুটিয়া, যশোর, বাংলাদেশ',
  phone: '+880 1712-345678',
  email: 'info@hasnahenafoundation.com',
  website: 'hasnahenafoundation.com'
};

export async function fetchOrgSettings(): Promise<OrgSettings> {
  try {
    const res = await fetch('/api/v1/settings');
    if (res.ok) {
      const data = await res.json();
      return {
        name: data['org.name'] || DEFAULT_ORG.name,
        nameEn: data['org.nameEn'] || DEFAULT_ORG.nameEn,
        address: data['org.address'] || DEFAULT_ORG.address,
        phone: data['org.phone'] || DEFAULT_ORG.phone,
        email: data['org.email'] || DEFAULT_ORG.email,
        website: data['org.website'] || DEFAULT_ORG.website,
        regNumber: data['org.regNumber'],
      };
    }
  } catch (e) {
    console.error('Failed to fetch org settings:', e);
  }
  return DEFAULT_ORG;
}

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
  interestRate?: number;
  disbursementDate?: string;
  guarantorName?: string;
  guarantorPhone?: string;
  purpose?: string;
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
  transactions: Array<{
    date: string;
    type: string;
    amount: number;
    balance: number;
    description?: string;
    receiptNumber?: string;
  }>;
}

export interface MembershipCertificateData {
  memberName: string;
  memberId: string;
  accountNumber?: string;
  memberSince: string;
  phone?: string;
  address?: string;
}

const formatCurrency = (amount: number, locale: string = 'bn'): string => {
  const value = amount / 100;
  return locale === 'bn' 
    ? `৳${value.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`
    : `৳${value.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`;
};

const formatDate = (dateStr: string, locale: string = 'bn'): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const getOrgNameEn = (org: OrgSettings = DEFAULT_ORG): string => {
  const configuredName = org.nameEn?.trim();
  if (!configuredName || configuredName.toLowerCase() === 'hasnahena') {
    return BRAND_NAME_EN;
  }
  return configuredName;
};

const getOrgNameBn = (org: OrgSettings = DEFAULT_ORG): string => {
  const configuredName = org.name?.trim();
  if (!configuredName || configuredName === 'হাসনাহেনা' || configuredName.includes('সমিতি')) {
    return BRAND_NAME_BN;
  }
  return configuredName;
};

const getCommonStyles = (): string => `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Noto Sans Bengali', 'Inter', 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: #17201d;
      background: #f3f6f5;
    }
    
    .document {
      max-width: 210mm;
      min-height: 297mm;
      margin: 20px auto;
      padding: 18mm 18mm 16mm;
      background: #ffffff;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
      position: relative;
      overflow: hidden;
    }
    
    .border-frame {
      position: absolute;
      top: 10mm;
      left: 10mm;
      right: 10mm;
      bottom: 10mm;
      border: 1px solid #d8e3df;
      pointer-events: none;
    }
    
    .border-frame::before {
      content: none;
      position: absolute;
      top: 2px;
      left: 2px;
      right: 2px;
      bottom: 2px;
      border: 1px solid #0f766e;
    }
    
    .header {
      display: grid;
      grid-template-columns: minmax(230px, 44%) 1fr;
      align-items: end;
      gap: 22px;
      padding-bottom: 18px;
      margin-bottom: 22px;
      border-bottom: 2px solid #0f766e;
      position: relative;
    }
    
    .logo-container {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      margin-bottom: 0;
      min-width: 0;
    }
    
    .brand-logo {
      height: 104px;
      width: auto;
      max-width: 260px;
      display: block;
    }
    
    .org-name-en {
      font-family: 'Inter', 'Noto Sans Bengali', sans-serif;
      font-size: 27px;
      font-weight: 700;
      color: #12332d;
      letter-spacing: 0;
      text-transform: none;
      line-height: 1.1;
    }

    .header-details {
      text-align: right;
      min-width: 0;
    }
    
    .org-name-bn {
      font-size: 17px;
      font-weight: 700;
      color: #0f766e;
      margin-top: 4px;
    }
    
    .org-tagline {
      font-size: 12px;
      color: #52645f;
      margin-top: 6px;
    }
    
    .org-info {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 5px 14px;
      margin-top: 12px;
      font-size: 11px;
      color: #52645f;
    }
    
    .org-info span {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .ledger-notice {
      margin: 16px 0 24px;
      padding: 11px 14px;
      border: 1px solid #cfded9;
      border-left: 3px solid #0f766e;
      background: #f8fbfa;
      color: #31413d;
      font-size: 11.5px;
      line-height: 1.55;
      border-radius: 4px;
    }
    
    .doc-title {
      text-align: center;
      margin: 20px 0 22px;
      position: relative;
    }
    
    .doc-title h1 {
      display: inline-block;
      padding: 9px 28px;
      background: #f4fbf8;
      color: #0f5f56;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.8px;
      border-radius: 4px;
      border: 1px solid #bddbd3;
      box-shadow: none;
    }
    
    .doc-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 24px;
      padding: 12px 14px;
      background: #f8fbfa;
      border-radius: 6px;
      border: 1px solid #dce8e4;
    }
    
    .meta-item {
      text-align: left;
      flex: 1;
    }
    
    .meta-label {
      font-size: 10px;
      color: #677772;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .meta-value {
      font-size: 14px;
      font-weight: 600;
      color: #12332d;
      margin-top: 3px;
    }
    
    .info-section {
      margin-bottom: 25px;
    }
    
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #12332d;
      margin-bottom: 12px;
      padding-bottom: 5px;
      border-bottom: 1px solid #dce8e4;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }
    
    .info-item {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: #fbfcfc;
      border-radius: 4px;
      border: 1px solid #e2e8e5;
    }
    
    .info-item.full-width {
      grid-column: 1 / -1;
    }
    
    .info-label {
      font-size: 11px;
      color: #62716c;
    }
    
    .info-value {
      font-size: 13px;
      font-weight: 600;
      color: #17201d;
      text-align: right;
    }
    
    .amount-highlight {
      text-align: center;
      padding: 22px;
      margin: 25px 0;
      border-radius: 6px;
      position: relative;
      overflow: hidden;
    }
    
    .amount-highlight.deposit {
      background: #f0f9f5;
      border: 1px solid #9bd4bd;
    }
    
    .amount-highlight.withdrawal {
      background: #fff5f5;
      border: 1px solid #efb6b6;
    }
    
    .amount-label {
      font-size: 12px;
      color: #62716c;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 8px;
    }
    
    .amount-value {
      font-size: 36px;
      font-weight: 700;
    }
    
    .amount-highlight.deposit .amount-value { color: #047857; }
    .amount-highlight.withdrawal .amount-value { color: #b91c1c; }
    
    .amount-words {
      font-size: 12px;
      color: #666;
      margin-top: 8px;
      font-style: italic;
    }
    
    .balance-after {
      display: inline-block;
      margin-top: 12px;
      padding: 8px 20px;
      background: rgba(255,255,255,0.85);
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid rgba(15, 118, 110, 0.14);
    }
    
    .balance-after strong {
      color: #0f766e;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 12px;
    }
    
    th, td {
      padding: 12px 10px;
      text-align: left;
      border-bottom: 1px solid #e4ebe8;
    }
    
    th {
      background: #f1f7f5;
      color: #12332d;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-top: 1px solid #dce8e4;
    }
    
    tr:nth-child(even) {
      background: #f9fafb;
    }
    
    tr:hover {
      background: #f6fbf9;
    }
    
    .signature-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 60px;
      margin-top: 60px;
      padding-top: 30px;
    }
    
    .signature-box {
      text-align: center;
    }
    
    .signature-line {
      border-top: 1px solid #17201d;
      width: 180px;
      margin: 0 auto 10px;
      padding-top: 8px;
    }
    
    .signature-label {
      font-size: 12px;
      color: #52645f;
    }
    
    .signature-name {
      font-size: 11px;
      color: #7d8c87;
      margin-top: 5px;
    }
    
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #dce8e4;
      text-align: center;
      font-size: 10px;
      color: #73817d;
    }
    
    .footer p {
      margin: 4px 0;
    }
    
    .document-id {
      position: absolute;
      bottom: 15mm;
      right: 15mm;
      font-size: 9px;
      color: #8c9995;
    }
    
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 70px;
      font-weight: 700;
      color: rgba(15, 118, 110, 0.035);
      pointer-events: none;
      z-index: 0;
      white-space: nowrap;
      font-family: 'Inter', 'Noto Sans Bengali', sans-serif;
      letter-spacing: 0;
    }
    
    .terms-section {
      margin: 25px 0;
      padding: 20px;
      background: #f8fbfa;
      border-radius: 6px;
      border: 1px solid #dce8e4;
    }
    
    .terms-title {
      font-weight: 600;
      color: #0f766e;
      margin-bottom: 12px;
      font-size: 14px;
    }
    
    .terms-list {
      list-style: none;
      padding: 0;
    }
    
    .terms-list li {
      margin-bottom: 10px;
      padding-left: 20px;
      position: relative;
      font-size: 12px;
      line-height: 1.6;
    }
    
    .terms-list li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 9px;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #0f766e;
      color: #0f766e;
      font-weight: bold;
    }
    
    .loan-summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin: 25px 0;
    }
    
    .summary-card {
      text-align: center;
      padding: 20px;
      border-radius: 6px;
      background: #f4fbf8;
      border: 1px solid #cfe3dc;
    }
    
    .summary-card .label {
      font-size: 10px;
      text-transform: uppercase;
      color: #666;
      letter-spacing: 0.5px;
    }
    
    .summary-card .value {
      font-size: 22px;
      font-weight: 700;
      color: #0f766e;
      margin-top: 8px;
    }
    
    .statement-summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin: 20px 0;
    }
    
    .stat-card {
      text-align: center;
      padding: 15px 10px;
      border-radius: 8px;
    }
    
    .stat-card.opening { background: #f8fafc; border: 1px solid #d8e0e7; }
    .stat-card.deposits { background: #f0f9f5; border: 1px solid #b8ddcc; }
    .stat-card.withdrawals { background: #fff5f5; border: 1px solid #efc1c1; }
    .stat-card.closing { background: #f4fbf8; border: 1px solid #0f766e; }
    
    .stat-card .label {
      font-size: 9px;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.5px;
    }
    
    .stat-card .value {
      font-size: 16px;
      font-weight: 700;
      margin-top: 5px;
    }
    
    .stat-card.deposits .value { color: #059669; }
    .stat-card.withdrawals .value { color: #dc2626; }
    .stat-card.closing .value { color: #0f766e; }
    
    .credit { color: #059669 !important; }
    .debit { color: #dc2626 !important; }
    
    .print-btn {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 24px;
      background: #0f766e;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(15, 118, 110, 0.3);
      z-index: 1000;
    }
    
    .print-btn:hover {
      background: #0d6359;
    }
    
    @media print {
      body { background: white; }
      .document { 
        box-shadow: none; 
        margin: 0; 
        padding: 14mm;
        min-height: auto;
      }
      .print-btn { display: none; }
      .border-frame { display: none; }
    }
  </style>
`;

const getHeader = (org: OrgSettings = DEFAULT_ORG): string => `
  <div class="header">
    <div class="logo-container">
      <img class="brand-logo" src="${BRAND_LOGO_PATH}" alt="${BRAND_NAME_EN} logo" crossorigin="anonymous" />
    </div>
    <div class="header-details">
      <div class="org-name-en">${getOrgNameEn(org)}</div>
      <div class="org-name-bn">${getOrgNameBn(org)}</div>
      <div class="org-tagline">${localeSafeTagline()}</div>
      <div class="org-info">
        <span>Address: ${org.address || DEFAULT_ORG.address}</span>
        <span>Phone: ${org.phone || DEFAULT_ORG.phone}</span>
        <span>Email: ${org.email || DEFAULT_ORG.email}</span>
        <span>Web: ${org.website || DEFAULT_ORG.website}</span>
      </div>
    </div>
  </div>
`;

const localeSafeTagline = (): string => 'Interest-free member services and community welfare';

const getLedgerNotice = (locale: string): string => `
  <div class="ledger-notice">
    ${locale === 'bn' ? LEDGER_NOTICE_BN : LEDGER_NOTICE_EN}
  </div>
`;

const getFooter = (documentId: string, locale: string, org: OrgSettings = DEFAULT_ORG): string => `
  <div class="footer">
    <p>${locale === 'bn' ? 'এটি একটি কম্পিউটার জেনারেটেড ডকুমেন্ট। সিল ও স্বাক্ষর ছাড়াও বৈধ।' : 'This is a computer-generated document. Valid without seal and signature.'}</p>
    <p>© ${new Date().getFullYear()} ${getOrgNameEn(org)}${org.regNumber ? ` | Reg. No: ${org.regNumber}` : ''}</p>
  </div>
  <div class="document-id">
    Doc ID: ${documentId}<br/>
    ${new Date().toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
  </div>
`;

export function generateReceiptHTML(data: ReceiptData, locale: string = 'bn', org: OrgSettings = DEFAULT_ORG): string {
  const isDeposit = data.type === 'DEPOSIT';
  const title = locale === 'bn' 
    ? (isDeposit ? 'জমা রশিদ' : 'উত্তোলন রশিদ')
    : (isDeposit ? 'DEPOSIT RECEIPT' : 'WITHDRAWAL RECEIPT');
  
  return `
    <!DOCTYPE html>
    <html lang="${locale}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - ${data.receiptNumber}</title>
      ${getCommonStyles()}
    </head>
    <body>
      <div class="watermark">${BRAND_NAME_EN}</div>
      <button class="print-btn" onclick="window.print()">${locale === 'bn' ? 'প্রিন্ট করুন' : 'Print'}</button>
      
      <div class="document">
        <div class="border-frame"></div>
        ${getHeader(org)}
        
        <div class="doc-title">
          <h1>${title}</h1>
        </div>

        ${getLedgerNotice(locale)}
        
        <div class="doc-meta">
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'রশিদ নং' : 'Receipt No'}</div>
            <div class="meta-value">${data.receiptNumber}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'তারিখ' : 'Date'}</div>
            <div class="meta-value">${formatDate(data.date, locale)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'সময়' : 'Time'}</div>
            <div class="meta-value">${new Date(data.date).toLocaleTimeString(locale === 'bn' ? 'bn-BD' : 'en-GB')}</div>
          </div>
        </div>
        
        <div class="info-section">
          <div class="section-title">${locale === 'bn' ? 'সদস্য তথ্য' : 'Member Information'}</div>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">${locale === 'bn' ? 'নাম' : 'Name'}</span>
              <span class="info-value">${data.memberName}</span>
            </div>
            <div class="info-item">
              <span class="info-label">${locale === 'bn' ? 'সদস্য আইডি' : 'Member ID'}</span>
              <span class="info-value">${data.memberId}</span>
            </div>
            <div class="info-item full-width">
              <span class="info-label">${locale === 'bn' ? 'মোবাইল' : 'Mobile'}</span>
              <span class="info-value">${data.memberPhone}</span>
            </div>
          </div>
        </div>
        
        <div class="amount-highlight ${isDeposit ? 'deposit' : 'withdrawal'}">
          <div class="amount-label">${locale === 'bn' ? (isDeposit ? 'জমার পরিমাণ' : 'উত্তোলনের পরিমাণ') : (isDeposit ? 'Deposit Amount' : 'Withdrawal Amount')}</div>
          <div class="amount-value">${formatCurrency(data.amount, locale)}</div>
          ${data.notes ? `<div class="amount-words">"${data.notes}"</div>` : ''}
          <div class="balance-after">
            ${locale === 'bn' ? 'লেনদেনের পর ব্যালেন্স' : 'Balance After'}: <strong>${formatCurrency(data.balanceAfter, locale)}</strong>
          </div>
        </div>
        
        ${data.processedBy ? `
        <div class="info-section">
          <div class="info-grid">
            <div class="info-item full-width">
              <span class="info-label">${locale === 'bn' ? 'প্রক্রিয়াকারী' : 'Processed By'}</span>
              <span class="info-value">${data.processedBy}</span>
            </div>
          </div>
        </div>
        ` : ''}
        
        <div class="signature-section">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'সদস্যের স্বাক্ষর' : 'Member Signature'}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'অনুমোদিত স্বাক্ষর' : 'Authorized Signature'}</div>
            <div class="signature-name">${BRAND_NAME_EN}</div>
          </div>
        </div>
        
        ${getFooter(data.receiptNumber, locale, org)}
      </div>
    </body>
    </html>
  `;
}

export function generateLoanDocumentHTML(data: LoanDocumentData, locale: string = 'bn', org: OrgSettings = DEFAULT_ORG): string {
  const title = locale === 'bn' ? 'ঋণ চুক্তিপত্র' : 'LOAN AGREEMENT';
  
  return `
    <!DOCTYPE html>
    <html lang="${locale}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - ${data.loanNumber}</title>
      ${getCommonStyles()}
    </head>
    <body>
      <div class="watermark">${BRAND_NAME_EN}</div>
      <button class="print-btn" onclick="window.print()">${locale === 'bn' ? 'প্রিন্ট করুন' : 'Print'}</button>
      
      <div class="document">
        <div class="border-frame"></div>
        ${getHeader(org)}
        
        <div class="doc-title">
          <h1>${title}</h1>
        </div>

        ${getLedgerNotice(locale)}
        
        <div class="doc-meta">
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'ঋণ নম্বর' : 'Loan No'}</div>
            <div class="meta-value">${data.loanNumber}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'তারিখ' : 'Date'}</div>
            <div class="meta-value">${data.disbursementDate ? formatDate(data.disbursementDate, locale) : formatDate(new Date().toISOString(), locale)}</div>
          </div>
        </div>
        
        <div class="info-section">
          <div class="section-title">${locale === 'bn' ? 'ঋণগ্রহীতার তথ্য' : 'Borrower Information'}</div>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">${locale === 'bn' ? 'নাম' : 'Name'}</span>
              <span class="info-value">${data.memberName}</span>
            </div>
            <div class="info-item">
              <span class="info-label">${locale === 'bn' ? 'সদস্য আইডি' : 'Member ID'}</span>
              <span class="info-value">${data.memberId}</span>
            </div>
            <div class="info-item">
              <span class="info-label">${locale === 'bn' ? 'মোবাইল' : 'Mobile'}</span>
              <span class="info-value">${data.memberPhone}</span>
            </div>
            ${data.memberAddress ? `
            <div class="info-item">
              <span class="info-label">${locale === 'bn' ? 'ঠিকানা' : 'Address'}</span>
              <span class="info-value">${data.memberAddress}</span>
            </div>
            ` : ''}
          </div>
        </div>
        
        ${data.guarantorName ? `
        <div class="info-section">
          <div class="section-title">${locale === 'bn' ? 'জামিনদারের তথ্য' : 'Guarantor Information'}</div>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">${locale === 'bn' ? 'নাম' : 'Name'}</span>
              <span class="info-value">${data.guarantorName}</span>
            </div>
            <div class="info-item">
              <span class="info-label">${locale === 'bn' ? 'মোবাইল' : 'Mobile'}</span>
              <span class="info-value">${data.guarantorPhone || '-'}</span>
            </div>
          </div>
        </div>
        ` : ''}
        
        <div class="info-section">
          <div class="section-title">${locale === 'bn' ? 'ঋণের বিবরণ' : 'Loan Details'}</div>
          <div class="loan-summary">
            <div class="summary-card">
              <div class="label">${locale === 'bn' ? 'মূল ঋণ' : 'Principal'}</div>
              <div class="value">${formatCurrency(data.principalAmount, locale)}</div>
            </div>
            <div class="summary-card">
              <div class="label">${locale === 'bn' ? 'কিস্তি সংখ্যা' : 'Installments'}</div>
              <div class="value">${data.totalInstallments}</div>
            </div>
            <div class="summary-card">
              <div class="label">${locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly EMI'}</div>
              <div class="value">${formatCurrency(data.installmentAmount, locale)}</div>
            </div>
          </div>
        </div>
        
        ${data.purpose ? `
        <div class="info-section">
          <div class="info-grid">
            <div class="info-item full-width">
              <span class="info-label">${locale === 'bn' ? 'ঋণের উদ্দেশ্য' : 'Loan Purpose'}</span>
              <span class="info-value">${data.purpose}</span>
            </div>
          </div>
        </div>
        ` : ''}
        
        <div class="terms-section">
          <div class="terms-title">${locale === 'bn' ? 'শর্তাবলী' : 'Terms & Conditions'}</div>
          <ul class="terms-list">
            <li>${locale === 'bn' ? 'ঋণগ্রহীতা প্রতি মাসে নির্ধারিত তারিখে কিস্তি পরিশোধ করতে বাধ্য থাকবেন।' : 'The borrower shall pay the monthly installment on the due date.'}</li>
            <li>${locale === 'bn' ? 'কিস্তি পরিশোধে ১৫ দিনের বেশি বিলম্ব হলে জরিমানা প্রযোজ্য হবে।' : 'Late payment beyond 15 days will attract penalty charges.'}</li>
            <li>${locale === 'bn' ? 'ঋণ খেলাপি হলে জামিনদারের জমা থেকে আদায় করা হবে।' : 'In case of default, the amount will be recovered from guarantor\'s deposit.'}</li>
            <li>${locale === 'bn' ? 'আংশিক বা সম্পূর্ণ অগ্রিম পরিশোধ করা যাবে।' : 'Partial or full prepayment is allowed.'}</li>
            <li>${locale === 'bn' ? 'সকল বিরোধ ফাউন্ডেশনের নীতিমালা অনুযায়ী নিষ্পত্তি হবে।' : 'All disputes shall be resolved according to Hasnahena Foundation policies.'}</li>
          </ul>
        </div>
        
        <div class="signature-section">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'ঋণগ্রহীতার স্বাক্ষর' : 'Borrower Signature'}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'জামিনদারের স্বাক্ষর' : 'Guarantor Signature'}</div>
          </div>
        </div>
        
        <div class="signature-section" style="margin-top: 30px;">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'সাক্ষী' : 'Witness'}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'অনুমোদনকারী কর্মকর্তা' : 'Authorizing Officer'}</div>
            <div class="signature-name">${BRAND_NAME_EN}</div>
          </div>
        </div>
        
        ${getFooter(data.loanNumber, locale, org)}
      </div>
    </body>
    </html>
  `;
}

export function generateStatementHTML(data: StatementData, locale: string = 'bn', org: OrgSettings = DEFAULT_ORG): string {
  const title = locale === 'bn' ? 'অ্যাকাউন্ট স্টেটমেন্ট' : 'ACCOUNT STATEMENT';
  
  return `
    <!DOCTYPE html>
    <html lang="${locale}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - ${data.memberId}</title>
      ${getCommonStyles()}
    </head>
    <body>
      <div class="watermark">${BRAND_NAME_EN}</div>
      <button class="print-btn" onclick="window.print()">${locale === 'bn' ? 'প্রিন্ট করুন' : 'Print'}</button>
      
      <div class="document">
        <div class="border-frame"></div>
        ${getHeader(org)}
        
        <div class="doc-title">
          <h1>${title}</h1>
        </div>

        ${getLedgerNotice(locale)}
        
        <div class="doc-meta">
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'সদস্য' : 'Member'}</div>
            <div class="meta-value">${data.memberName}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'আইডি' : 'ID'}</div>
            <div class="meta-value">${data.memberId}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'সময়কাল' : 'Period'}</div>
            <div class="meta-value">${formatDate(data.periodStart, locale)} - ${formatDate(data.periodEnd, locale)}</div>
          </div>
        </div>
        
        <div class="statement-summary">
          <div class="stat-card opening">
            <div class="label">${locale === 'bn' ? 'প্রারম্ভিক' : 'Opening'}</div>
            <div class="value">${formatCurrency(data.openingBalance, locale)}</div>
          </div>
          <div class="stat-card deposits">
            <div class="label">${locale === 'bn' ? 'মোট জমা' : 'Deposits'}</div>
            <div class="value">+${formatCurrency(data.totalDeposits, locale)}</div>
          </div>
          <div class="stat-card withdrawals">
            <div class="label">${locale === 'bn' ? 'মোট উত্তোলন' : 'Withdrawals'}</div>
            <div class="value">-${formatCurrency(data.totalWithdrawals, locale)}</div>
          </div>
          <div class="stat-card closing">
            <div class="label">${locale === 'bn' ? 'সমাপনী' : 'Closing'}</div>
            <div class="value">${formatCurrency(data.closingBalance, locale)}</div>
          </div>
        </div>
        
        <div class="info-section">
          <div class="section-title">${locale === 'bn' ? 'লেনদেনের বিবরণ' : 'Transaction Details'}</div>
          <table>
            <thead>
              <tr>
                <th>${locale === 'bn' ? 'তারিখ' : 'Date'}</th>
                <th>${locale === 'bn' ? 'বিবরণ' : 'Description'}</th>
                <th>${locale === 'bn' ? 'রশিদ নং' : 'Receipt'}</th>
                <th style="text-align: right;">${locale === 'bn' ? 'জমা' : 'Credit'}</th>
                <th style="text-align: right;">${locale === 'bn' ? 'উত্তোলন' : 'Debit'}</th>
                <th style="text-align: right;">${locale === 'bn' ? 'ব্যালেন্স' : 'Balance'}</th>
              </tr>
            </thead>
            <tbody>
              ${data.transactions.map(tx => `
                <tr>
                  <td>${formatDate(tx.date, locale)}</td>
                  <td>${tx.description || (tx.type === 'DEPOSIT' ? (locale === 'bn' ? 'জমা' : 'Deposit') : (locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'))}</td>
                  <td>${tx.receiptNumber || '-'}</td>
                  <td style="text-align: right;" class="credit">${tx.type === 'DEPOSIT' ? formatCurrency(tx.amount, locale) : '-'}</td>
                  <td style="text-align: right;" class="debit">${tx.type === 'WITHDRAWAL' ? formatCurrency(tx.amount, locale) : '-'}</td>
                  <td style="text-align: right; font-weight: 600;">${formatCurrency(tx.balance, locale)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        
        <div class="signature-section">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'সদস্যের স্বাক্ষর' : 'Member Signature'}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'অনুমোদিত স্বাক্ষর' : 'Authorized Signature'}</div>
            <div class="signature-name">${BRAND_NAME_EN}</div>
          </div>
        </div>
        
        ${getFooter(`STMT-${data.memberId}-${new Date().getTime()}`, locale, org)}
      </div>
    </body>
    </html>
  `;
}

export function generateMembershipCertificateHTML(data: MembershipCertificateData, locale: string = 'bn', org: OrgSettings = DEFAULT_ORG): string {
  const title = locale === 'bn' ? 'সদস্যপদ সনদ' : 'MEMBERSHIP CERTIFICATE';

  return `
    <!DOCTYPE html>
    <html lang="${locale}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - ${data.memberId}</title>
      ${getCommonStyles()}
      <style>
        .certificate-body {
          margin-top: 24px;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 24px;
          background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
        }

        .certificate-lead {
          text-align: center;
          font-size: 16px;
          margin-bottom: 18px;
          color: #0f766e;
          font-weight: 600;
        }

        .certificate-text {
          text-align: justify;
          margin-bottom: 16px;
          line-height: 1.9;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="watermark">${BRAND_NAME_EN}</div>
      <button class="print-btn" onclick="window.print()">${locale === 'bn' ? 'প্রিন্ট করুন' : 'Print'}</button>

      <div class="document">
        <div class="border-frame"></div>
        ${getHeader(org)}

        <div class="doc-title">
          <h1>${title}</h1>
        </div>

        ${getLedgerNotice(locale)}

        <div class="doc-meta">
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'সদস্য আইডি' : 'Member ID'}</div>
            <div class="meta-value">${data.memberId}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'অ্যাকাউন্ট' : 'Account'}</div>
            <div class="meta-value">${data.accountNumber || '-'}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">${locale === 'bn' ? 'সদস্যপদ শুরু' : 'Member Since'}</div>
            <div class="meta-value">${formatDate(data.memberSince, locale)}</div>
          </div>
        </div>

        <div class="certificate-body">
          <div class="certificate-lead">
            ${locale === 'bn' ? 'এতদ্বারা প্রত্যয়ন করা যাচ্ছে যে' : 'This is to certify that'}
          </div>
          <p class="certificate-text">
            <strong>${data.memberName}</strong>
            ${locale === 'bn'
              ? `, সদস্য আইডি <strong>${data.memberId}</strong>, হাসনাহেনা ফাউন্ডেশন-এর একজন বৈধ সদস্য। সদস্য হিসেবে তিনি সংগঠনের সঞ্চয়, ঋণ ও সদস্যসেবামূলক কার্যক্রমে অংশগ্রহণের অধিকারী।`
              : `, Member ID <strong>${data.memberId}</strong>, is a valid member of Hasnahena Foundation and is entitled to participate in its savings, loan, and member service activities.`}
          </p>
          <p class="certificate-text">
            ${locale === 'bn'
              ? `যোগাযোগ: ${data.phone || '-'}${data.address ? ` | ঠিকানা: ${data.address}` : ''}`
              : `Contact: ${data.phone || '-'}${data.address ? ` | Address: ${data.address}` : ''}`}
          </p>
        </div>

        <div class="signature-section" style="margin-top: 34px;">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'সদস্যের স্বাক্ষর' : 'Member Signature'}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'অনুমোদিত স্বাক্ষর' : 'Authorized Signature'}</div>
            <div class="signature-name">${BRAND_NAME_EN}</div>
          </div>
        </div>

        ${getFooter(`CERT-${data.memberId}-${Date.now()}`, locale, org)}
      </div>
    </body>
    </html>
  `;
}

export function openPrintWindow(html: string, title: string): void {
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.document.title = title;
  }
}

export function downloadAsHTML(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadAsPDF(html: string, filename: string): Promise<void> {
  const container = document.createElement('div');
  container.innerHTML = html;
  Object.assign(container.style, {
    position: 'absolute',
    top: '-9999px',
    left: '-9999px',
    width: '210mm',
    background: 'white',
    zIndex: '-1'
  });
  
  const printBtn = container.querySelector('.print-btn');
  if (printBtn) printBtn.remove();
  
  document.body.appendChild(container);
  
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const docElement = container.querySelector('.document') as HTMLElement;
    if (!docElement) throw new Error('Document container not found');
    
    const canvas = await html2canvas(docElement, {
      scale: 2,
      useCORS: true,
      logging: false
    });
    
    const imgData = canvas.toDataURL('image/jpeg', 1.0);
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });
    
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    
    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`${filename}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
