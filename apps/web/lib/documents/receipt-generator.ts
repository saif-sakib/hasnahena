/**
 * Hasnahena Receipt and Document Generator
 * Professional document generation with Hasnahena branding
 */

export interface ReceiptData {
  receiptNumber: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
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

const getCommonStyles = (): string => `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Noto Sans Bengali', 'Segoe UI', sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #1a1a1a;
      background: white;
    }
    
    .document {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
      background: white;
    }
    
    .header {
      text-align: center;
      border-bottom: 3px solid #0f766e;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    
    .logo {
      width: 80px;
      height: 80px;
      margin-bottom: 10px;
    }
    
    .org-name {
      font-size: 24px;
      font-weight: 700;
      color: #0f766e;
      margin-bottom: 4px;
    }
    
    .org-name-bn {
      font-size: 20px;
      font-weight: 600;
      color: #0f766e;
    }
    
    .org-tagline {
      font-size: 11px;
      color: #666;
      margin-top: 4px;
    }
    
    .org-contact {
      font-size: 10px;
      color: #888;
      margin-top: 8px;
    }
    
    .doc-title {
      text-align: center;
      margin: 20px 0;
      padding: 10px;
      background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%);
      color: white;
      font-size: 18px;
      font-weight: 600;
      border-radius: 4px;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 25px;
    }
    
    .info-box {
      background: #f8fafc;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    
    .info-box.full-width {
      grid-column: 1 / -1;
    }
    
    .info-label {
      font-size: 10px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    
    .info-value {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
    }
    
    .amount-box {
      text-align: center;
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      border: 2px solid #10b981;
      padding: 20px;
      border-radius: 12px;
      margin: 25px 0;
    }
    
    .amount-box.withdrawal {
      background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
      border-color: #ef4444;
    }
    
    .amount-label {
      font-size: 12px;
      color: #059669;
      margin-bottom: 5px;
    }
    
    .amount-box.withdrawal .amount-label {
      color: #dc2626;
    }
    
    .amount-value {
      font-size: 32px;
      font-weight: 700;
      color: #047857;
    }
    
    .amount-box.withdrawal .amount-value {
      color: #b91c1c;
    }
    
    .amount-words {
      font-size: 11px;
      color: #666;
      margin-top: 5px;
      font-style: italic;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    
    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    
    th {
      background: #f1f5f9;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      color: #475569;
    }
    
    td {
      font-size: 12px;
    }
    
    tr:nth-child(even) {
      background: #f8fafc;
    }
    
    .signature-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-top: 50px;
      padding-top: 30px;
    }
    
    .signature-box {
      text-align: center;
    }
    
    .signature-line {
      border-top: 1px solid #333;
      width: 200px;
      margin: 0 auto 10px;
      padding-top: 5px;
    }
    
    .signature-label {
      font-size: 11px;
      color: #666;
    }
    
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      font-size: 10px;
      color: #94a3b8;
    }
    
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 100px;
      font-weight: 700;
      color: rgba(15, 118, 110, 0.03);
      pointer-events: none;
      z-index: -1;
    }
    
    .qr-section {
      text-align: center;
      margin-top: 20px;
    }
    
    .document-id {
      font-size: 10px;
      color: #94a3b8;
      text-align: right;
      margin-top: 20px;
    }
    
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .document { padding: 20px; }
      .no-print { display: none; }
    }
  </style>
`;

const getHeader = (): string => `
  <div class="header">
    <img src="/images/logo.png" alt="Hasnahena Logo" class="logo" onerror="this.style.display='none'"/>
    <div class="org-name">HASNAHENA</div>
    <div class="org-name-bn">হাসনাহেনা সমবায় সমিতি</div>
    <div class="org-tagline">Hasnahena Multipurpose Cooperative Society Ltd.</div>
    <div class="org-contact">
      📍 Trishal, Mymensingh, Bangladesh | 📞 +880 1700-000000 | 📧 info@hasnahena.org
    </div>
  </div>
`;

const getFooter = (documentId: string, locale: string): string => `
  <div class="footer">
    <p>${locale === 'bn' ? 'এই ডকুমেন্টটি কম্পিউটার দ্বারা স্বয়ংক্রিয়ভাবে তৈরি এবং স্বাক্ষর ছাড়াই বৈধ।' : 'This is a computer-generated document and is valid without signature.'}</p>
    <p>© ${new Date().getFullYear()} Hasnahena Cooperative Society Ltd. All rights reserved.</p>
  </div>
  <div class="document-id">
    ${locale === 'bn' ? 'ডকুমেন্ট আইডি' : 'Document ID'}: ${documentId} | ${locale === 'bn' ? 'তৈরির তারিখ' : 'Generated'}: ${new Date().toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
  </div>
`;

export function generateReceiptHTML(data: ReceiptData, locale: string = 'bn'): string {
  const isDeposit = data.type === 'DEPOSIT';
  const title = locale === 'bn' 
    ? (isDeposit ? 'জমা রশিদ' : 'উত্তোলন রশিদ')
    : (isDeposit ? 'Deposit Receipt' : 'Withdrawal Receipt');
  
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
      <div class="watermark">HASNAHENA</div>
      <div class="document">
        ${getHeader()}
        
        <div class="doc-title">${title}</div>
        
        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'রশিদ নম্বর' : 'Receipt No.'}</div>
            <div class="info-value">${data.receiptNumber}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'তারিখ' : 'Date'}</div>
            <div class="info-value">${formatDate(data.date, locale)}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'সদস্যের নাম' : 'Member Name'}</div>
            <div class="info-value">${data.memberName}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'সদস্য আইডি' : 'Member ID'}</div>
            <div class="info-value">${data.memberId}</div>
          </div>
          <div class="info-box full-width">
            <div class="info-label">${locale === 'bn' ? 'মোবাইল নম্বর' : 'Phone Number'}</div>
            <div class="info-value">${data.memberPhone}</div>
          </div>
        </div>
        
        <div class="amount-box ${isDeposit ? '' : 'withdrawal'}">
          <div class="amount-label">${locale === 'bn' ? (isDeposit ? 'জমার পরিমাণ' : 'উত্তোলনের পরিমাণ') : (isDeposit ? 'Deposit Amount' : 'Withdrawal Amount')}</div>
          <div class="amount-value">${formatCurrency(data.amount, locale)}</div>
          ${data.notes ? `<div class="amount-words">${data.notes}</div>` : ''}
        </div>
        
        <div class="info-grid">
          <div class="info-box full-width">
            <div class="info-label">${locale === 'bn' ? 'লেনদেনের পর ব্যালেন্স' : 'Balance After Transaction'}</div>
            <div class="info-value">${formatCurrency(data.balanceAfter, locale)}</div>
          </div>
        </div>
        
        ${data.processedBy ? `
        <div class="info-grid">
          <div class="info-box full-width">
            <div class="info-label">${locale === 'bn' ? 'প্রক্রিয়াকারী' : 'Processed By'}</div>
            <div class="info-value">${data.processedBy}</div>
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
            <div class="signature-label">${locale === 'bn' ? 'কর্মকর্তার স্বাক্ষর' : 'Authorized Signature'}</div>
          </div>
        </div>
        
        ${getFooter(data.receiptNumber, locale)}
      </div>
    </body>
    </html>
  `;
}

export function generateLoanDocumentHTML(data: LoanDocumentData, locale: string = 'bn'): string {
  const title = locale === 'bn' ? 'ঋণ চুক্তিপত্র' : 'Loan Agreement';
  
  return `
    <!DOCTYPE html>
    <html lang="${locale}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - ${data.loanNumber}</title>
      ${getCommonStyles()}
      <style>
        .terms-section {
          background: #f8fafc;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
          border-left: 4px solid #0f766e;
        }
        .terms-title {
          font-weight: 600;
          margin-bottom: 10px;
          color: #0f766e;
        }
        .terms-list {
          list-style: decimal;
          padding-left: 20px;
        }
        .terms-list li {
          margin-bottom: 8px;
          line-height: 1.6;
        }
        .loan-summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
          margin: 25px 0;
        }
        .summary-item {
          text-align: center;
          padding: 15px;
          background: #f1f5f9;
          border-radius: 8px;
        }
        .summary-label {
          font-size: 10px;
          color: #64748b;
          text-transform: uppercase;
        }
        .summary-value {
          font-size: 18px;
          font-weight: 700;
          color: #0f766e;
          margin-top: 5px;
        }
      </style>
    </head>
    <body>
      <div class="watermark">HASNAHENA</div>
      <div class="document">
        ${getHeader()}
        
        <div class="doc-title">${title}</div>
        
        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'ঋণ নম্বর' : 'Loan Number'}</div>
            <div class="info-value">${data.loanNumber}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'বিতরণ তারিখ' : 'Disbursement Date'}</div>
            <div class="info-value">${data.disbursementDate ? formatDate(data.disbursementDate, locale) : '-'}</div>
          </div>
        </div>
        
        <h3 style="margin: 25px 0 15px; color: #0f766e;">${locale === 'bn' ? 'ঋণগ্রহীতার তথ্য' : 'Borrower Information'}</h3>
        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'নাম' : 'Name'}</div>
            <div class="info-value">${data.memberName}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'সদস্য আইডি' : 'Member ID'}</div>
            <div class="info-value">${data.memberId}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'মোবাইল' : 'Phone'}</div>
            <div class="info-value">${data.memberPhone}</div>
          </div>
          ${data.memberAddress ? `
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'ঠিকানা' : 'Address'}</div>
            <div class="info-value">${data.memberAddress}</div>
          </div>
          ` : ''}
        </div>
        
        ${data.guarantorName ? `
        <h3 style="margin: 25px 0 15px; color: #0f766e;">${locale === 'bn' ? 'জামিনদারের তথ্য' : 'Guarantor Information'}</h3>
        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'জামিনদারের নাম' : 'Guarantor Name'}</div>
            <div class="info-value">${data.guarantorName}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'মোবাইল' : 'Phone'}</div>
            <div class="info-value">${data.guarantorPhone || '-'}</div>
          </div>
        </div>
        ` : ''}
        
        <h3 style="margin: 25px 0 15px; color: #0f766e;">${locale === 'bn' ? 'ঋণের বিবরণ' : 'Loan Details'}</h3>
        <div class="loan-summary">
          <div class="summary-item">
            <div class="summary-label">${locale === 'bn' ? 'মূল ঋণ' : 'Principal'}</div>
            <div class="summary-value">${formatCurrency(data.principalAmount, locale)}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">${locale === 'bn' ? 'মোট কিস্তি' : 'Total Installments'}</div>
            <div class="summary-value">${data.totalInstallments}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">${locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly EMI'}</div>
            <div class="summary-value">${formatCurrency(data.installmentAmount, locale)}</div>
          </div>
        </div>
        
        ${data.purpose ? `
        <div class="info-box full-width" style="margin: 20px 0;">
          <div class="info-label">${locale === 'bn' ? 'ঋণের উদ্দেশ্য' : 'Loan Purpose'}</div>
          <div class="info-value">${data.purpose}</div>
        </div>
        ` : ''}
        
        <div class="terms-section">
          <div class="terms-title">${locale === 'bn' ? 'শর্তাবলী' : 'Terms & Conditions'}</div>
          <ol class="terms-list">
            <li>${locale === 'bn' ? 'ঋণগ্রহীতা প্রতি মাসে নির্ধারিত কিস্তি পরিশোধ করতে বাধ্য থাকবেন।' : 'The borrower shall pay the monthly installment on the due date.'}</li>
            <li>${locale === 'bn' ? 'কিস্তি পরিশোধে বিলম্ব হলে জরিমানা প্রযোজ্য হবে।' : 'Late payment will attract penalty charges as per society rules.'}</li>
            <li>${locale === 'bn' ? 'ঋণ খেলাপি হলে জামিনদারের জমা থেকে আদায় করা হবে।' : 'In case of default, the amount will be recovered from guarantor\'s deposit.'}</li>
            <li>${locale === 'bn' ? 'সকল বিরোধ সমিতির নিয়ম অনুযায়ী নিষ্পত্তি হবে।' : 'All disputes shall be resolved as per society by-laws.'}</li>
          </ol>
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
            <div class="signature-label">${locale === 'bn' ? 'সাক্ষী ১' : 'Witness 1'}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'কর্মকর্তার স্বাক্ষর ও সীল' : 'Authorized Signature & Seal'}</div>
          </div>
        </div>
        
        ${getFooter(data.loanNumber, locale)}
      </div>
    </body>
    </html>
  `;
}

export function generateStatementHTML(data: StatementData, locale: string = 'bn'): string {
  const title = locale === 'bn' ? 'অ্যাকাউন্ট স্টেটমেন্ট' : 'Account Statement';
  
  return `
    <!DOCTYPE html>
    <html lang="${locale}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - ${data.memberId}</title>
      ${getCommonStyles()}
      <style>
        .statement-summary {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 15px;
          margin: 25px 0;
        }
        .summary-card {
          text-align: center;
          padding: 20px 15px;
          border-radius: 12px;
        }
        .summary-card.opening { background: #f1f5f9; border: 1px solid #cbd5e1; }
        .summary-card.deposits { background: #ecfdf5; border: 1px solid #a7f3d0; }
        .summary-card.withdrawals { background: #fef2f2; border: 1px solid #fecaca; }
        .summary-card.closing { background: #f0fdfa; border: 2px solid #0f766e; }
        .summary-card .label {
          font-size: 10px;
          text-transform: uppercase;
          color: #64748b;
          margin-bottom: 5px;
        }
        .summary-card .value {
          font-size: 18px;
          font-weight: 700;
        }
        .summary-card.deposits .value { color: #059669; }
        .summary-card.withdrawals .value { color: #dc2626; }
        .summary-card.closing .value { color: #0f766e; }
        .deposit-row { color: #059669; }
        .withdrawal-row { color: #dc2626; }
        .transaction-table { font-size: 11px; }
        .transaction-table th { font-size: 10px; }
      </style>
    </head>
    <body>
      <div class="watermark">HASNAHENA</div>
      <div class="document">
        ${getHeader()}
        
        <div class="doc-title">${title}</div>
        
        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'সদস্যের নাম' : 'Member Name'}</div>
            <div class="info-value">${data.memberName}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'সদস্য আইডি' : 'Member ID'}</div>
            <div class="info-value">${data.memberId}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'সময়কাল' : 'Period'}</div>
            <div class="info-value">${formatDate(data.periodStart, locale)} - ${formatDate(data.periodEnd, locale)}</div>
          </div>
          <div class="info-box">
            <div class="info-label">${locale === 'bn' ? 'মোবাইল' : 'Phone'}</div>
            <div class="info-value">${data.memberPhone}</div>
          </div>
        </div>
        
        <div class="statement-summary">
          <div class="summary-card opening">
            <div class="label">${locale === 'bn' ? 'প্রারম্ভিক ব্যালেন্স' : 'Opening Balance'}</div>
            <div class="value">${formatCurrency(data.openingBalance, locale)}</div>
          </div>
          <div class="summary-card deposits">
            <div class="label">${locale === 'bn' ? 'মোট জমা' : 'Total Deposits'}</div>
            <div class="value">+${formatCurrency(data.totalDeposits, locale)}</div>
          </div>
          <div class="summary-card withdrawals">
            <div class="label">${locale === 'bn' ? 'মোট উত্তোলন' : 'Total Withdrawals'}</div>
            <div class="value">-${formatCurrency(data.totalWithdrawals, locale)}</div>
          </div>
          <div class="summary-card closing">
            <div class="label">${locale === 'bn' ? 'সমাপনী ব্যালেন্স' : 'Closing Balance'}</div>
            <div class="value">${formatCurrency(data.closingBalance, locale)}</div>
          </div>
        </div>
        
        <h3 style="margin: 25px 0 15px; color: #0f766e;">${locale === 'bn' ? 'লেনদেনের বিবরণ' : 'Transaction Details'}</h3>
        <table class="transaction-table">
          <thead>
            <tr>
              <th>${locale === 'bn' ? 'তারিখ' : 'Date'}</th>
              <th>${locale === 'bn' ? 'বিবরণ' : 'Description'}</th>
              <th>${locale === 'bn' ? 'রশিদ নং' : 'Receipt No.'}</th>
              <th style="text-align: right;">${locale === 'bn' ? 'জমা' : 'Credit'}</th>
              <th style="text-align: right;">${locale === 'bn' ? 'উত্তোলন' : 'Debit'}</th>
              <th style="text-align: right;">${locale === 'bn' ? 'ব্যালেন্স' : 'Balance'}</th>
            </tr>
          </thead>
          <tbody>
            ${data.transactions.map(txn => `
              <tr class="${txn.type === 'DEPOSIT' ? 'deposit-row' : 'withdrawal-row'}">
                <td>${formatDate(txn.date, locale)}</td>
                <td>${txn.description || (txn.type === 'DEPOSIT' ? (locale === 'bn' ? 'জমা' : 'Deposit') : (locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'))}</td>
                <td>${txn.receiptNumber || '-'}</td>
                <td style="text-align: right;">${txn.type === 'DEPOSIT' ? formatCurrency(txn.amount, locale) : '-'}</td>
                <td style="text-align: right;">${txn.type === 'WITHDRAWAL' ? formatCurrency(txn.amount, locale) : '-'}</td>
                <td style="text-align: right;">${formatCurrency(txn.balance, locale)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        
        <div class="signature-section">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'সদস্যের স্বাক্ষর' : 'Member Signature'}</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">${locale === 'bn' ? 'কর্মকর্তার স্বাক্ষর' : 'Authorized Signature'}</div>
          </div>
        </div>
        
        ${getFooter(`STM-${data.memberId}-${Date.now()}`, locale)}
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
    
    // Wait for content to load then print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 500);
    };
  }
}

export function downloadAsHTML(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
