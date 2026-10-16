import { describe, it, expect } from 'vitest';

import {
  buildReceipt,
  buildStatement,
  buildLoanAgreement,
  buildMembershipCertificate,
  type Block,
  type DocumentModel,
} from './index';

// TEST-23 — the four document builders, asserting what a member would dispute
// (structure, not a snapshot everyone re-blesses).

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every string a reader would see, flattened, so a test can ask "is it on the page?" */
export function visibleText(model: DocumentModel): string[] {
  const out: string[] = [model.title, model.refLabel, model.refValue, model.documentId];
  for (const block of model.blocks) {
    switch (block.kind) {
      case 'fields':
        out.push(block.title);
        for (const f of block.fields) out.push(f.label, f.value);
        break;
      case 'amount':
        out.push(block.label, block.value, block.words);
        if (block.after) out.push(block.after.label, block.after.value);
        break;
      case 'tiles':
        for (const t of block.tiles) out.push(t.label, t.value);
        break;
      case 'table':
        if (block.title) out.push(block.title);
        for (const c of block.columns) out.push(c.header);
        for (const r of block.rows) for (const c of r.cells) out.push(c.text);
        if (block.foot) for (const c of block.foot) out.push(c.text);
        break;
      case 'certify':
        out.push(block.intro, block.name, block.subtitle, block.body);
        break;
      case 'notice':
        out.push(block.text);
        break;
      case 'terms':
        out.push(block.title, ...block.items);
        break;
      case 'placeholder':
        out.push(block.text);
        break;
      case 'signatures':
        for (const s of block.signatures) out.push(s.role, s.who ?? '');
        break;
    }
  }
  return out.filter((s) => s.length > 0);
}

const findBlock = <K extends Block['kind']>(model: DocumentModel, kind: K) =>
  model.blocks.find((b): b is Extract<Block, { kind: K }> => b.kind === kind);

const fieldValue = (model: DocumentModel, label: string): string | undefined => {
  for (const block of model.blocks) {
    if (block.kind !== 'fields') continue;
    const found = block.fields.find((f) => f.label === label);
    if (found) return found.value;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

const RECEIPT = {
  receiptNumber: 'DEP-2026-000123',
  type: 'DEPOSIT' as const,
  amount: 125000,
  date: '2026-08-17T10:30:00.000Z',
  memberName: 'Rahima Khatun',
  accountNo: 'ACC-KH-33001',
  memberPhone: '01712345678',
  balanceAfter: 375000,
  processedBy: 'Abdul Karim',
  notes: 'Monthly deposit collected at the Bhekutia round',
};

describe('buildReceipt', () => {
  it('prints the amount, its words, and the balance after', () => {
    const model = buildReceipt(RECEIPT);
    const amount = findBlock(model, 'amount');

    expect(amount?.value).toBe('BDT 1,25,000');
    // The words are the tamper check a Bangladeshi receipt is required to
    // carry: a figure can be altered with a pen, a sentence cannot.
    expect(amount?.words).toBe('One Lakh Twenty-Five Thousand Taka Only');
    expect(amount?.after?.value).toBe('BDT 3,75,000');
    expect(amount?.tone).toBe('credit');
  });

  it('reads a withdrawal as a debit', () => {
    const model = buildReceipt({ ...RECEIPT, type: 'WITHDRAWAL', receiptNumber: 'WDR-2026-000004' });
    expect(findBlock(model, 'amount')?.tone).toBe('debit');
    expect(model.title).toBe('Withdrawal Receipt');
  });

  it('carries the member, the operator and the reference', () => {
    const model = buildReceipt(RECEIPT);
    expect(fieldValue(model, 'Name')).toBe('Rahima Khatun');
    expect(fieldValue(model, 'Account No')).toBe('ACC-KH-33001');
    expect(fieldValue(model, 'Processed by')).toBe('Abdul Karim');
    expect(model.refValue).toBe('DEP-2026-000123');
  });

  it('uses the receipt number as the document id rather than prefixing it again', () => {
    // Already a document number (ADR-013); no second prefix.
    expect(buildReceipt(RECEIPT).documentId).toBe('DEP-2026-000123');
  });

  it('omits the remarks block when there are no notes', () => {
    const withNotes = buildReceipt(RECEIPT);
    const without = buildReceipt({ ...RECEIPT, notes: '   ' });
    expect(withNotes.blocks.filter((b) => b.kind === 'fields')).toHaveLength(2);
    expect(without.blocks.filter((b) => b.kind === 'fields')).toHaveLength(1);
  });

  it('never prints "undefined" for a missing optional', () => {
    const model = buildReceipt({ ...RECEIPT, processedBy: undefined, notes: undefined });
    expect(visibleText(model).join(' ')).not.toContain('undefined');
    expect(fieldValue(model, 'Processed by')).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

const STATEMENT = {
  memberName: 'Rahima Khatun',
  accountNo: 'ACC-KH-33001',
  memberPhone: '01712345678',
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-07-31T00:00:00.000Z',
  openingBalance: 10000,
  closingBalance: 14000,
  totalDeposits: 6000,
  totalWithdrawals: 2000,
  transactions: [
    { date: '2026-07-20T00:00:00.000Z', type: 'WITHDRAWAL', amount: 2000, balance: 14000, receiptNumber: 'WDR-2026-000002' },
    { date: '2026-07-05T00:00:00.000Z', type: 'DEPOSIT', amount: 6000, balance: 16000, receiptNumber: 'DEP-2026-000001' },
  ],
};

describe('buildStatement', () => {
  it('sorts entries chronologically whatever order they arrive in', () => {
    const table = findBlock(buildStatement(STATEMENT), 'table');
    // Row 0 is the opening-balance boundary row.
    expect(table?.rows[1]?.cells[3]?.text).toBe('DEP-2026-000001');
    expect(table?.rows[2]?.cells[3]?.text).toBe('WDR-2026-000002');
  });

  it('ties out: opening + credits − debits = closing', () => {
    const model = buildStatement(STATEMENT);
    const tiles = findBlock(model, 'tiles')!.tiles;
    const value = (label: string) =>
      Number(tiles.find((t) => t.label === label)!.value.replace(/[^0-9-]/g, ''));

    const opening = value('Opening balance');
    const credits = value('Total credits');
    const debits = value('Total debits');
    const closing = value('Closing balance');

    // The reconciliation a member does with a pencil. If this fails, the
    // statement is internally inconsistent and no explanation will help.
    expect(opening + credits - debits).toBe(closing);
  });

  it('shows a reconciling line when the period is a slice of a longer history', () => {
    // Closing does not follow from the rows alone: something happened outside
    // the window. Naming it beats leaving the reader to find the gap.
    const model = buildStatement({ ...STATEMENT, closingBalance: 20000 });
    const table = findBlock(model, 'table')!;
    const last = table.rows[table.rows.length - 1];
    expect(last.cells[2].text).toBe('Other entries outside this statement');
    expect(last.variant).toBe('boundary');

    const tiles = findBlock(model, 'tiles')!.tiles;
    const value = (label: string) => Number(tiles.find((t) => t.label === label)!.value.replace(/[^0-9-]/g, ''));
    expect(value('Opening balance') + value('Total credits') - value('Total debits'))
      .toBe(value('Closing balance'));
  });

  it('shows a placeholder rather than an empty table for a quiet period', () => {
    const model = buildStatement({ ...STATEMENT, transactions: [], closingBalance: 14000 });
    expect(findBlock(model, 'table')).toBeUndefined();
    expect(findBlock(model, 'placeholder')?.text).toContain('No transactions');
  });

  it('puts a credit in the credit column and a debit in the debit column, never both', () => {
    const table = findBlock(buildStatement(STATEMENT), 'table')!;
    for (const row of table.rows.slice(1)) {
      const credit = row.cells[4].text;
      const debit = row.cells[5].text;
      expect(Boolean(credit) && Boolean(debit)).toBe(false);
    }
  });

  it('states the closing balance in words', () => {
    expect(findBlock(buildStatement(STATEMENT), 'notice')?.text)
      .toBe('Closing balance: BDT 14,000 — Fourteen Thousand Taka Only');
  });

  it('column widths sum to exactly 1', () => {
    // The PDF renderer multiplies these by the content width. A set summing to
    // 0.98 silently narrows the table; 1.02 runs it off the page edge.
    const table = findBlock(buildStatement(STATEMENT), 'table')!;
    const total = table.columns.reduce((sum, c) => sum + c.width, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);
  });

  it('gives the footer one cell per column', () => {
    const table = findBlock(buildStatement(STATEMENT), 'table')!;
    expect(table.foot).toHaveLength(table.columns.length);
    for (const row of table.rows) expect(row.cells).toHaveLength(table.columns.length);
  });
});

// ---------------------------------------------------------------------------
// Loan agreement
// ---------------------------------------------------------------------------

const LOAN = {
  loanNumber: 'LOAN-2026-000007',
  memberName: 'Rahima Khatun',
  accountNo: 'ACC-KH-33001',
  memberPhone: '01712345678',
  memberAddress: 'Bhekutia, Sadar, Jashore',
  principalAmount: 50000,
  totalInstallments: 12,
  installmentAmount: 4166,
  disbursementDate: '2026-08-01T00:00:00.000Z',
  guarantorName: 'Abdul Karim',
  guarantorPhone: '01812345678',
  purpose: 'Sewing machine for tailoring work',
};

describe('buildLoanAgreement', () => {
  it('states zero interest, and the one office-expense payment, explicitly', () => {
    // Zero interest stated (rule 3); the ৳500 office expense is separate and the
    // total equals the principal (ADR-045).
    const model = buildLoanAgreement(LOAN);
    expect(fieldValue(model, 'Interest rate')).toBe('0% — Qard al-Hasan');
    expect(fieldValue(model, 'Office expense')).toBe(
      'BDT 500 at application, non-refundable — not part of this loan',
    );
  });

  it('makes the total repayable exactly the principal', () => {
    const model = buildLoanAgreement(LOAN);
    expect(fieldValue(model, 'Total repayable')).toBe('BDT 50,000');
    expect(fieldValue(model, 'Total repayable')).toBe(
      findBlock(model, 'tiles')!.tiles.find((t) => t.label === 'Principal')!.value,
    );
  });

  it('absorbs rounding in the final installment rather than inflating the total', () => {
    // 12 × 4,166 = 49,992, eight taka short. Rounding the installment up to
    // 4,167 would bill 50,004 — four taka of riba, which is still riba.
    const model = buildLoanAgreement(LOAN);
    expect(fieldValue(model, 'Final installment (adjusted)')).toBe('BDT 4,174');
    expect(4166 * 11 + 4174).toBe(50000);
    expect(fieldValue(model, 'Repayment schedule')).toContain('the total repaid equals the principal exactly');
  });

  it('omits the adjustment when the schedule already divides evenly', () => {
    const model = buildLoanAgreement({ ...LOAN, principalAmount: 48000, installmentAmount: 4000 });
    expect(fieldValue(model, 'Final installment (adjusted)')).toBeUndefined();
    expect(fieldValue(model, 'Repayment schedule')).toBeUndefined();
  });

  it('omits the guarantor block for a loan below the threshold', () => {
    const model = buildLoanAgreement({ ...LOAN, guarantorName: undefined, guarantorPhone: undefined });
    const titles = model.blocks.filter((b) => b.kind === 'fields').map((b) => b.title);
    expect(titles).not.toContain('Guarantor');
    // The signature line stays: the form is the same document either way, and a
    // blank line is honest where a missing one looks like a different contract.
    expect(findBlock(model, 'signatures')?.signatures.map((s) => s.role))
      .toContain('Guarantor signature');
  });

  it('prints the terms, including the recovery order a member is agreeing to', () => {
    const terms = findBlock(buildLoanAgreement(LOAN), 'terms')!;
    expect(terms.items.join(' ')).toContain('no interest, profit, or markup');
    expect(terms.items.join(' ')).toContain('not added to the loan');
    expect(terms.items.join(' ')).toContain(
      'the borrower’s own savings, then the guarantor’s savings, then the donation pool',
    );
    // The late fee is denied, not omitted (T-05).
    expect(terms.items.join(' ')).toContain('No late fee, penalty, or additional charge');
  });

  it('states the principal in words', () => {
    expect(fieldValue(buildLoanAgreement(LOAN), 'Principal in words'))
      .toBe('Fifty Thousand Taka Only');
  });
});

// ---------------------------------------------------------------------------
// Membership certificate
// ---------------------------------------------------------------------------

const CERT = {
  memberName: 'Rahima Khatun',
  accountNo: 'ACC-KH-33001',
  memberSince: '2024-03-15T00:00:00.000Z',
  phone: '01712345678',
  address: 'Bhekutia, Sadar, Jashore',
};

describe('buildMembershipCertificate', () => {
  it('certifies the named member of the named organisation', () => {
    const certify = findBlock(buildMembershipCertificate(CERT), 'certify')!;
    expect(certify.name).toBe('Rahima Khatun');
    expect(certify.subtitle).toBe('Account No: ACC-KH-33001');
    expect(certify.body).toContain('Hasnahena Foundation');
    expect(certify.body).toContain('Qard al-Hasan');
  });

  it('uses the organisation name from settings when one is configured', () => {
    // The letterhead is admin-editable; a certificate naming the wrong body is
    // not proof of anything.
    const certify = findBlock(
      buildMembershipCertificate(CERT, { nameEn: 'Hasnahena Cooperative Society' }),
      'certify',
    )!;
    expect(certify.body).toContain('Hasnahena Cooperative Society');
  });

  it('prints the joining date, not today, as "member since"', () => {
    expect(fieldValue(buildMembershipCertificate(CERT), 'Member since')).toBe('15 Mar 2024');
  });
});

// ---------------------------------------------------------------------------
// Properties every document shares
// ---------------------------------------------------------------------------

const ALL: Array<[string, () => DocumentModel]> = [
  ['receipt', () => buildReceipt(RECEIPT)],
  ['statement', () => buildStatement(STATEMENT)],
  ['loan agreement', () => buildLoanAgreement(LOAN)],
  ['membership certificate', () => buildMembershipCertificate(CERT)],
];

describe.each(ALL)('every document (%s)', (_name, build) => {
  it('has a title, a reference and a document id', () => {
    const model = build();
    expect(model.title.length).toBeGreaterThan(0);
    expect(model.refLabel.length).toBeGreaterThan(0);
    expect(model.refValue.length).toBeGreaterThan(0);
    expect(model.documentId).toMatch(/^[A-Z]{2,6}-[A-Z0-9-]+$/);
  });

  it('has a filename safe for a filesystem and a Content-Disposition header', () => {
    expect(build().filename).toMatch(/^[\w.-]+$/);
  });

  it('ends with a signature block', () => {
    const blocks = build().blocks;
    expect(blocks[blocks.length - 1].kind).toBe('signatures');
  });

  it('prints no "undefined", "null" or "NaN"', () => {
    const text = visibleText(build()).join(' ');
    expect(text).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b/);
  });
});

// ---------------------------------------------------------------------------
// ADR-023 — a member is identified once per document.
// ---------------------------------------------------------------------------

/** ADR-023: whatever a document calls the member, it uses one name for the id. */
describe('a document identifies the member exactly once', () => {
  const ACCOUNT_NO = 'ACC-KH-33001';

  /** Every field value, plus the reference block, as a reader would see them. */
  function occurrencesOfAccountNo(model: DocumentModel): string[] {
    const labels: string[] = [];
    if (model.refValue === ACCOUNT_NO) labels.push(model.refLabel);
    for (const block of model.blocks) {
      if (block.kind === 'fields') {
        for (const f of block.fields) if (f.value === ACCOUNT_NO) labels.push(f.label);
      }
      if (block.kind === 'tiles') {
        for (const t of block.tiles) if (t.value === ACCOUNT_NO) labels.push(t.label);
      }
    }
    return labels;
  }

  // About names, not counts: the id may repeat, but under one label.
  it('the statement gives it a single name', () => {
    const labels = occurrencesOfAccountNo(buildStatement({ ...STATEMENT, accountNo: ACCOUNT_NO }));
    expect(labels.length).toBeGreaterThan(0);
    expect([...new Set(labels)]).toEqual(['Account No']);
  });

  it('the membership certificate gives it a single name', () => {
    const labels = occurrencesOfAccountNo(buildMembershipCertificate({ ...CERT, accountNo: ACCOUNT_NO }));
    expect(labels.length).toBeGreaterThan(0);
    expect([...new Set(labels)]).toEqual(['Account No']);
  });

  // ADR-029: all four documents pinned to the same name.
  it('the receipt gives it a single name', () => {
    const labels = occurrencesOfAccountNo(buildReceipt({ ...RECEIPT, accountNo: ACCOUNT_NO }));
    expect(labels.length).toBeGreaterThan(0);
    expect([...new Set(labels)]).toEqual(['Account No']);
  });

  it('the loan agreement gives it a single name', () => {
    const labels = occurrencesOfAccountNo(buildLoanAgreement({ ...LOAN, accountNo: ACCOUNT_NO }));
    expect(labels.length).toBeGreaterThan(0);
    expect([...new Set(labels)]).toEqual(['Account No']);
  });

  // The name itself, in one place, so a rename shows up here as a decision
  // rather than as four quiet edits.
  it('never calls it a member id', () => {
    const documents = [
      buildStatement({ ...STATEMENT, accountNo: ACCOUNT_NO }),
      buildMembershipCertificate({ ...CERT, accountNo: ACCOUNT_NO }),
      buildReceipt({ ...RECEIPT, accountNo: ACCOUNT_NO }),
      buildLoanAgreement({ ...LOAN, accountNo: ACCOUNT_NO }),
    ];
    for (const model of documents) {
      expect(JSON.stringify(model)).not.toMatch(/member\s*id/i);
    }
  });
});
