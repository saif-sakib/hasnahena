/**
 * Hasnahena Official Document Generator
 * Professional document generation with official Hasnahena branding
 */

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

const getCommonStyles = (): string => `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Noto Sans Bengali', 'Segoe UI', sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: #1a1a1a;
      background: #f5f5f5;
    }
    
    .document {
      max-width: 210mm;
      min-height: 297mm;
      margin: 20px auto;
      padding: 25mm 20mm;
      background: white;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      position: relative;
    }
    
    .border-frame {
      position: absolute;
      top: 10mm;
      left: 10mm;
      right: 10mm;
      bottom: 10mm;
      border: 2px solid #0f766e;
      pointer-events: none;
    }
    
    .border-frame::before {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      right: 2px;
      bottom: 2px;
      border: 1px solid #0f766e;
    }
    
    .header {
      text-align: center;
      padding-bottom: 20px;
      margin-bottom: 25px;
      border-bottom: 3px double #0f766e;
      position: relative;
    }
    
    .logo-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
      margin-bottom: 10px;
    }
    
    .logo-svg {
      width: 70px;
      height: 70px;
    }
    
    .org-name-en {
      font-family: 'Playfair Display', serif;
      font-size: 32px;
      font-weight: 700;
      color: #0f766e;
      letter-spacing: 3px;
      text-transform: uppercase;
    }
    
    .org-name-bn {
      font-size: 22px;
      font-weight: 700;
      color: #0f766e;
      margin-top: 5px;
    }
    
    .org-tagline {
      font-size: 12px;
      color: #666;
      font-style: italic;
      margin-top: 8px;
    }
    
    .org-info {
      display: flex;
      justify-content: center;
      gap: 25px;
      margin-top: 12px;
      font-size: 11px;
      color: #555;
    }
    
    .org-info span {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    
    .doc-title {
      text-align: center;
      margin: 25px 0;
      position: relative;
    }
    
    .doc-title h1 {
      display: inline-block;
      padding: 12px 40px;
      background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%);
      color: white;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 2px;
      border-radius: 4px;
      box-shadow: 0 3px 10px rgba(15, 118, 110, 0.3);
    }
    
    .doc-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 25px;
      padding: 15px;
      background: #f8faf9;
      border-radius: 8px;
      border: 1px solid #e0e7e5;
    }
    
    .meta-item {
      text-align: center;
    }
    
    .meta-label {
      font-size: 10px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .meta-value {
      font-size: 14px;
      font-weight: 600;
      color: #0f766e;
      margin-top: 3px;
    }
    
    .info-section {
      margin-bottom: 25px;
    }
    
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #0f766e;
      margin-bottom: 12px;
      padding-bottom: 5px;
      border-bottom: 1px solid #e0e7e5;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }
    
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 10px 12px;
      background: #fafafa;
      border-radius: 6px;
      border-left: 3px solid #0f766e;
    }
    
    .info-item.full-width {
      grid-column: 1 / -1;
    }
    
    .info-label {
      font-size: 11px;
      color: #666;
    }
    
    .info-value {
      font-size: 13px;
      font-weight: 600;
      color: #1a1a1a;
    }
    
    .amount-highlight {
      text-align: center;
      padding: 25px;
      margin: 25px 0;
      border-radius: 12px;
      position: relative;
      overflow: hidden;
    }
    
    .amount-highlight.deposit {
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      border: 2px solid #10b981;
    }
    
    .amount-highlight.withdrawal {
      background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
      border: 2px solid #ef4444;
    }
    
    .amount-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1px;
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
      background: rgba(255,255,255,0.8);
      border-radius: 20px;
      font-size: 12px;
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
      border-bottom: 1px solid #e5e7eb;
    }
    
    th {
      background: #0f766e;
      color: white;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    tr:nth-child(even) {
      background: #f9fafb;
    }
    
    tr:hover {
      background: #f0fdfa;
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
      border-top: 2px solid #333;
      width: 180px;
      margin: 0 auto 10px;
      padding-top: 8px;
    }
    
    .signature-label {
      font-size: 12px;
      color: #666;
    }
    
    .signature-name {
      font-size: 11px;
      color: #999;
      margin-top: 5px;
    }
    
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 10px;
      color: #888;
    }
    
    .footer p {
      margin: 4px 0;
    }
    
    .document-id {
      position: absolute;
      bottom: 15mm;
      right: 15mm;
      font-size: 9px;
      color: #aaa;
    }
    
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 120px;
      font-weight: 700;
      color: rgba(15, 118, 110, 0.04);
      pointer-events: none;
      z-index: 0;
      white-space: nowrap;
      font-family: 'Playfair Display', serif;
      letter-spacing: 10px;
    }
    
    .terms-section {
      margin: 25px 0;
      padding: 20px;
      background: #f8faf9;
      border-radius: 8px;
      border-left: 4px solid #0f766e;
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
      content: '✓';
      position: absolute;
      left: 0;
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
      border-radius: 10px;
      background: linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%);
      border: 1px solid #99f6e4;
    }
    
    .summary-card .label {
      font-size: 10px;
      text-transform: uppercase;
      color: #666;
      letter-spacing: 1px;
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
    
    .stat-card.opening { background: #f1f5f9; border: 1px solid #cbd5e1; }
    .stat-card.deposits { background: #ecfdf5; border: 1px solid #a7f3d0; }
    .stat-card.withdrawals { background: #fef2f2; border: 1px solid #fecaca; }
    .stat-card.closing { background: #f0fdfa; border: 2px solid #0f766e; }
    
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
        padding: 15mm;
        min-height: auto;
      }
      .print-btn { display: none; }
      .border-frame { display: none; }
    }
  </style>
`;

const getLogoSVG = (): string => `
  <svg class="logo-svg" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" stroke="#0f766e" stroke-width="3" fill="#f0fdfa"/>
    <path d="M30 65 L50 25 L70 65 Z" fill="#0f766e" opacity="0.8"/>
    <circle cx="50" cy="55" r="12" fill="#14b8a6"/>
    <path d="M44 55 L48 59 L56 51" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

const getHeader = (): string => `
  <div class="header">
    <div class="logo-container">
      ${getLogoSVG()}
      <div>
        <div class="org-name-en">HASNAHENA</div>
        <div class="org-name-bn">হাসনাহেনা সমিতি লিমিটেড</div>
      </div>
    </div>
    <div class="org-tagline">Hasnahena Multipurpose Cooperative Society Limited</div>
    <div class="org-info">
      <span>📍 ত্রিশাল, ময়মনসিংহ</span>
      <span>📞 +880 1700-000000</span>
      <span>✉️ info@hasnahena.org</span>
      <span>🌐 hasnahena.org</span>
    </div>
  </div>
`;

const getFooter = (documentId: string, locale: string): string => `
  <div class="footer">
    <p>${locale === 'bn' ? 'এটি একটি কম্পিউটার জেনারেটেড ডকুমেন্ট। সিল ও স্বাক্ষর ছাড়াও বৈধ।' : 'This is a computer-generated document. Valid without seal and signature.'}</p>
    <p>© ${new Date().getFullYear()} Hasnahena Cooperative Society Ltd. | Reg. No: XXXX-XXXX</p>
  </div>
  <div class="document-id">
    Doc ID: ${documentId}<br/>
    ${new Date().toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
  </div>
`;

export function generateReceiptHTML(data: ReceiptData, locale: string = 'bn'): string {
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
      <div class="watermark">HASNAHENA</div>
      <button class="print-btn" onclick="window.print()">🖨️ ${locale === 'bn' ? 'প্রিন্ট করুন' : 'Print'}</button>
      
      <div class="document">
        <div class="border-frame"></div>
        ${getHeader()}
        
        <div class="doc-title">
          <h1>${title}</h1>
        </div>
        
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
          <div class="section-title">${locale === 'bn' ? '📋 সদস্য তথ্য' : '📋 Member Information'}</div>
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
            <div class="signature-name">Hasnahena Cooperative</div>
          </div>
        </div>
        
        ${getFooter(data.receiptNumber, locale)}
      </div>
    </body>
    </html>
  `;
}

export function generateLoanDocumentHTML(data: LoanDocumentData, locale: string = 'bn'): string {
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
      <div class="watermark">HASNAHENA</div>
      <button class="print-btn" onclick="window.print()">🖨️ ${locale === 'bn' ? 'প্রিন্ট করুন' : 'Print'}</button>
      
      <div class="document">
        <div class="border-frame"></div>
        ${getHeader()}
        
        <div class="doc-title">
          <h1>${title}</h1>
        </div>
        
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
          <div class="section-title">${locale === 'bn' ? '👤 ঋণগ্রহীতার তথ্য' : '👤 Borrower Information'}</div>
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
          <div class="section-title">${locale === 'bn' ? '🤝 জামিনদারের তথ্য' : '🤝 Guarantor Information'}</div>
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
          <div class="section-title">${locale === 'bn' ? '💰 ঋণের বিবরণ' : '💰 Loan Details'}</div>
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
          <div class="terms-title">${locale === 'bn' ? '📜 শর্তাবলী' : '📜 Terms & Conditions'}</div>
          <ul class="terms-list">
            <li>${locale === 'bn' ? 'ঋণগ্রহীতা প্রতি মাসে নির্ধারিত তারিখে কিস্তি পরিশোধ করতে বাধ্য থাকবেন।' : 'The borrower shall pay the monthly installment on the due date.'}</li>
            <li>${locale === 'bn' ? 'কিস্তি পরিশোধে ১৫ দিনের বেশি বিলম্ব হলে জরিমানা প্রযোজ্য হবে।' : 'Late payment beyond 15 days will attract penalty charges.'}</li>
            <li>${locale === 'bn' ? 'ঋণ খেলাপি হলে জামিনদারের জমা থেকে আদায় করা হবে।' : 'In case of default, the amount will be recovered from guarantor\'s deposit.'}</li>
            <li>${locale === 'bn' ? 'আংশিক বা সম্পূর্ণ অগ্রিম পরিশোধ করা যাবে।' : 'Partial or full prepayment is allowed.'}</li>
            <li>${locale === 'bn' ? 'সকল বিরোধ সমিতির নিয়ম অনুযায়ী নিষ্পত্তি হবে।' : 'All disputes shall be resolved as per society by-laws.'}</li>
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
            <div class="signature-name">Hasnahena Cooperative</div>
          </div>
        </div>
        
        ${getFooter(data.loanNumber, locale)}
      </div>
    </body>
    </html>
  `;
}

export function generateStatementHTML(data: StatementData, locale: string = 'bn'): string {
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
      <div class="watermark">HASNAHENA</div>
      <button class="print-btn" onclick="window.print()">🖨️ ${locale === 'bn' ? 'প্রিন্ট করুন' : 'Print'}</button>
      
      <div class="document">
        <div class="border-frame"></div>
        ${getHeader()}
        
        <div class="doc-title">
          <h1>${title}</h1>
        </div>
        
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
          <div class="section-title">${locale === 'bn' ? '📊 লেনদেনের বিবরণ' : '📊 Transaction Details'}</div>
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
            <div class="signature-name">Hasnahena Cooperative</div>
          </div>
        </div>
        
        ${getFooter(`STM-${data.memberId}-${Date.now()}`, locale)}
      </div>
    </body>
    </html>
  `;
}

export function generateMembershipCertificateHTML(data: MembershipCertificateData, locale: string = 'bn'): string {
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
      <div class="watermark">HASNAHENA</div>
      <button class="print-btn" onclick="window.print()">🖨️ ${locale === 'bn' ? 'প্রিন্ট করুন' : 'Print'}</button>

      <div class="document">
        <div class="border-frame"></div>
        ${getHeader()}

        <div class="doc-title">
          <h1>${title}</h1>
        </div>

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
              ? `, সদস্য আইডি <strong>${data.memberId}</strong>, হাসনাহেনা সমিতি লিমিটেড-এর একজন বৈধ সদস্য। সদস্য হিসেবে তিনি সংগঠনের সঞ্চয়, ঋণ ও সদস্যসেবামূলক কার্যক্রমে অংশগ্রহণের অধিকারী।`
              : `, Member ID <strong>${data.memberId}</strong>, is a valid member of Hasnahena Samiti Limited and is entitled to participate in its savings, loan, and member service activities.`}
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
            <div class="signature-name">Hasnahena Cooperative</div>
          </div>
        </div>

        ${getFooter(`CERT-${data.memberId}-${Date.now()}`, locale)}
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
