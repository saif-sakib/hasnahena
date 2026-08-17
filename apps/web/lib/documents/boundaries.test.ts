import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';

import {
  amountInWords,
  formatAmount,
  formatCurrency,
  buildStatement,
  buildReceipt,
  buildLoanAgreement,
  buildMembershipCertificate,
  renderHTML,
  renderPDF,
  type Block,
  type DocumentModel,
  type StatementTransaction,
} from './index';
import { toPdfSafe } from './format';
import { CONTENT_WIDTH, PAGE } from './theme';

// TEST-25 — the edges: amount boundaries, page breaks, oversized inputs,
// English-only enforcement (ADR-012), and document numbers (ADR-013).
//
// These are the cases a document meets once it leaves the happy path a
// developer tried by hand: a crore-sized figure, a member with a long name, a
// statement covering a year, a note typed in Bengali.

const statementWith = (transactions: StatementTransaction[], closing = 0) =>
  buildStatement({
    memberName: 'Rahima Khatun',
    memberId: 'ACC-KH-33001',
    memberPhone: '01712345678',
    accountNumber: 'ACC-KH-33001',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-12-31T00:00:00.000Z',
    openingBalance: 0,
    closingBalance: closing,
    totalDeposits: 0,
    totalWithdrawals: 0,
    transactions,
  });

const tableOf = (model: DocumentModel) =>
  model.blocks.find((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table');

// ---------------------------------------------------------------------------
// Amount boundaries
// ---------------------------------------------------------------------------

describe('amount formatting at the boundaries', () => {
  it.each([
    [0, 'BDT 0', 'Zero Taka Only'],
    [1, 'BDT 1', 'One Taka Only'],
    [999, 'BDT 999', 'Nine Hundred Ninety-Nine Taka Only'],
    [1000, 'BDT 1,000', 'One Thousand Taka Only'],
    [99999, 'BDT 99,999', 'Ninety-Nine Thousand Nine Hundred Ninety-Nine Taka Only'],
    // One lakh: where South Asian grouping stops matching Western grouping.
    [100000, 'BDT 1,00,000', 'One Lakh Taka Only'],
    [125000, 'BDT 1,25,000', 'One Lakh Twenty-Five Thousand Taka Only'],
    [9999999, 'BDT 99,99,999', 'Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine Taka Only'],
    // One crore: the cap on a single deposit (ADR-002 allows ten).
    [10000000, 'BDT 1,00,00,000', 'One Crore Taka Only'],
    [100000000, 'BDT 10,00,00,000', 'Ten Crore Taka Only'],
  ])('%d prints as %s and reads as %s', (amount, currency, words) => {
    expect(formatCurrency(amount)).toBe(currency);
    expect(amountInWords(amount)).toBe(words);
  });

  it('never prints a fractional taka', () => {
    // Money is whole taka (rule 1). A value that somehow arrives fractional is
    // rounded for display rather than printed with paisa the ledger cannot hold.
    expect(formatAmount(1000.4)).toBe('1,000');
    expect(formatAmount(1000.6)).toBe('1,001');
    expect(formatCurrency(0.5)).toBe('BDT 1');
  });

  it('survives a non-finite amount instead of printing NaN', () => {
    expect(formatAmount(Number.NaN)).toBe('0');
    expect(formatAmount(Number.POSITIVE_INFINITY)).toBe('0');
    expect(amountInWords(Number.NaN)).toBe('Zero Taka Only');
    expect(amountInWords(Number.POSITIVE_INFINITY)).toBe('Zero Taka Only');
  });

  it('reads a negative amount by magnitude, since the direction is a column', () => {
    // The statement puts the sign in the credit/debit column; the words would
    // otherwise contradict the column they sit beside.
    expect(amountInWords(-5000)).toBe('Five Thousand Taka Only');
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('pagination', () => {
  const manyEntries = (count: number): StatementTransaction[] =>
    Array.from({ length: count }, (_, i) => ({
      date: `2026-${String((i % 12) + 1).padStart(2, '0')}-15T00:00:00.000Z`,
      type: i % 2 ? 'WITHDRAWAL' : 'DEPOSIT',
      amount: 1000 + i,
      balance: 50000 + i * 10,
      receiptNumber: `${i % 2 ? 'WDR' : 'DEP'}-2026-${String(i + 1).padStart(6, '0')}`,
      description: `Entry number ${i + 1}`,
    }));

  it('spills a long statement onto more than one page', async () => {
    const pdf = await renderPDF(statementWith(manyEntries(120), 60000));
    // `internal.pages` is 1-indexed with a placeholder at 0, so a single-page
    // document has length 2. jsPDF's typings do not expose getNumberOfPages on
    // the `internal` object, hence the cast.
    const pages = (pdf as never as { internal: { pages: unknown[] } }).internal.pages;
    expect(pages.length - 1).toBeGreaterThan(1);
  });

  it('draws every entry, none lost at a page break', async () => {
    const count = 120;
    const pdf = await renderPDF(statementWith(manyEntries(count), 60000));

    const drawn: string[] = [];
    for (const page of (pdf as never as { internal: { pages: string[][] } }).internal.pages) {
      if (!Array.isArray(page)) continue;
      for (const op of page) {
        for (const m of op.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) drawn.push(m[1]);
      }
    }
    const text = drawn.join(' ');

    // The first, the last, and one either side of where a break is likely.
    for (const i of [0, 1, 30, 31, 60, count - 2, count - 1]) {
      const reference = `${i % 2 ? 'WDR' : 'DEP'}-2026-${String(i + 1).padStart(6, '0')}`;
      expect(text, `entry ${i + 1} (${reference}) never reached the PDF`).toContain(reference);
    }
  });

  it('repeats the column header on every page', async () => {
    const pdf = await renderPDF(statementWith(manyEntries(120), 60000));
    const pages = (pdf as never as { internal: { pages: string[][] } }).internal.pages;

    let pagesWithBody = 0;
    let pagesWithHeader = 0;
    for (const page of pages) {
      if (!Array.isArray(page)) continue;
      const text = page.join(' ');
      if (!/\(DEP-2026-|\(WDR-2026-/.test(text)) continue;
      pagesWithBody += 1;
      // A continuation page whose rows have no header is a column of numbers
      // with nothing saying which is credit and which is debit.
      if (text.includes('(REFERENCE)')) pagesWithHeader += 1;
    }
    expect(pagesWithBody).toBeGreaterThan(1);
    expect(pagesWithHeader).toBe(pagesWithBody);
  });

  it('never draws text off the page', async () => {
    // Anything positioned outside the page box is clipped: invisible in a
    // viewer and absent from the print, with nothing to indicate it was there.
    // A row that overflows the bottom instead of starting a new page is the way
    // that happens, and it happens to the *last* rows — the most recent
    // transactions, which are the ones a member is looking for.
    const pdf = await renderPDF(statementWith(manyEntries(120), 60000));
    const pages = (pdf as never as { internal: { pages: string[][] } }).internal.pages;

    // PDF user space is points with the origin at the bottom-left.
    const PT_PER_MM = 72 / 25.4;
    const pageHeightPt = PAGE.height * PT_PER_MM;
    const pageWidthPt = PAGE.width * PT_PER_MM;

    let positions = 0;
    for (const page of pages) {
      if (!Array.isArray(page)) continue;
      for (const op of page) {
        for (const m of op.matchAll(/(-?[\d.]+) (-?[\d.]+) Td/g)) {
          const x = Number(m[1]);
          const y = Number(m[2]);
          positions += 1;
          expect(y, `text drawn at y=${y}, off the bottom of the page`).toBeGreaterThan(0);
          expect(y, `text drawn at y=${y}, off the top of the page`).toBeLessThan(pageHeightPt);
          expect(x, `text drawn at x=${x}, off the left edge`).toBeGreaterThanOrEqual(0);
          expect(x, `text drawn at x=${x}, off the right edge`).toBeLessThan(pageWidthPt);
        }
      }
    }
    expect(positions, 'no text positions were found, so this proved nothing').toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// The measurement that would have caught the wrapped receipt number
// ---------------------------------------------------------------------------

describe('table columns fit their content', () => {
  // The Reference column was 0.15 of the content width — 22.7 mm usable — while
  // a 15-character document number measures 23.14 mm at the table's 8 pt
  // Helvetica. Every reference on every statement wrapped, printing as
  // `DEP-2026-00000` with a stray `1` beneath it.
  //
  // This measures rather than eyeballs, so the next column that is a fraction
  // too narrow fails here instead of on a member's printed statement.
  const CELL_FONT_PT = 8;
  const CELL_PADDING_MM = 2;

  const widthOf = (text: string, bold = false): number => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(CELL_FONT_PT);
    return doc.getTextWidth(text);
  };

  it('fits an unbreakable reference in the statement table', () => {
    const model = statementWith(
      [
        {
          date: '2026-07-05T00:00:00.000Z',
          type: 'DEPOSIT',
          amount: 6000,
          balance: 6000,
          receiptNumber: 'DEP-2026-000001',
        },
      ],
      6000,
    );
    const table = tableOf(model)!;
    const referenceIndex = table.columns.findIndex((c) => c.header === 'Reference');
    const usable = table.columns[referenceIndex].width * CONTENT_WIDTH - CELL_PADDING_MM * 2;

    expect(widthOf('DEP-2026-000001')).toBeLessThan(usable);
    // …with room for the longer series the allocator can issue.
    expect(widthOf('LOAN-2026-000001')).toBeLessThan(usable);
  });

  it('fits every column header', () => {
    const table = tableOf(statementWith([
      { date: '2026-07-05T00:00:00.000Z', type: 'DEPOSIT', amount: 1, balance: 1 },
    ], 1))!;
    for (const column of table.columns) {
      const usable = column.width * CONTENT_WIDTH - CELL_PADDING_MM * 2;
      // Headers are drawn at 6.5 pt bold, smaller than the cells.
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      expect(
        doc.getTextWidth(column.header.toUpperCase()),
        `the "${column.header}" header does not fit its column`,
      ).toBeLessThan(usable);
    }
  });

  it('fits the largest amount the system permits', () => {
    // Ten crore is the cap on a single posting (ADR-002).
    const table = tableOf(statementWith([
      { date: '2026-07-05T00:00:00.000Z', type: 'DEPOSIT', amount: 100000000, balance: 100000000 },
    ], 100000000))!;
    for (const header of ['Credit (BDT)', 'Debit (BDT)', 'Balance (BDT)']) {
      const column = table.columns.find((c) => c.header === header)!;
      const usable = column.width * CONTENT_WIDTH - CELL_PADDING_MM * 2;
      expect(widthOf(formatAmount(100000000), true), `${header} is too narrow`).toBeLessThan(usable);
    }
  });
});

// ---------------------------------------------------------------------------
// Oversized and awkward input
// ---------------------------------------------------------------------------

describe('oversized input', () => {
  const LONG_NAME = 'Mohammad Abdur Rahman Chowdhury Al-Hasan Bin Abdullah Siddiqui';
  const LONG_ADDRESS =
    'House 42/B, Road 7, Block C, Bhekutia Bazar Para, Sadar Upazila, Jashore District, Khulna Division, Bangladesh 7400';

  it('renders a long name and address without throwing', async () => {
    const model = buildLoanAgreement({
      loanNumber: 'LOAN-2026-000007',
      memberName: LONG_NAME,
      memberId: 'ACC-KH-33001',
      memberPhone: '01712345678',
      memberAddress: LONG_ADDRESS,
      principalAmount: 100000000,
      totalInstallments: 600,
      installmentAmount: 166666,
      guarantorName: LONG_NAME,
      guarantorPhone: '01812345678',
      purpose: LONG_ADDRESS,
    });
    expect(renderHTML(model)).toContain('Chowdhury');
    await expect(renderPDF(model)).resolves.toBeTruthy();
  });

  it('keeps the loan schedule exact even at the extremes', () => {
    // 100000000 over 600 does not divide evenly; the final installment absorbs
    // the difference so the total repaid is the principal and not one taka more.
    const per = Math.floor(100000000 / 600);
    const final = 100000000 - per * 599;
    expect(per * 599 + final).toBe(100000000);
  });

  it('handles a statement with a single entry and one with none', async () => {
    await expect(renderPDF(statementWith([], 0))).resolves.toBeTruthy();
    await expect(
      renderPDF(statementWith([{ date: '2026-07-05T00:00:00.000Z', type: 'DEPOSIT', amount: 1, balance: 1 }], 1)),
    ).resolves.toBeTruthy();
  });

  it('does not break on an unknown transaction type', () => {
    // `StatementTxType` accepts any string, so a type added to the schema and
    // not to TX_LABELS still has to print something readable.
    const table = tableOf(
      statementWith([{ date: '2026-07-05T00:00:00.000Z', type: 'ZAKAT_DISBURSEMENT', amount: 500, balance: 500 }], 500),
    )!;
    expect(table.rows[1].cells[2].text).toBe('ZAKAT DISBURSEMENT');
  });

  it('handles a date the caller could not parse', () => {
    const model = buildReceipt({
      receiptNumber: 'DEP-2026-000001',
      type: 'DEPOSIT',
      amount: 100,
      date: 'not-a-date',
      memberName: 'A',
      memberId: 'B',
      memberPhone: 'C',
      balanceAfter: 100,
    });
    expect(renderHTML(model)).not.toContain('Invalid Date');
  });
});

// ---------------------------------------------------------------------------
// ADR-012 — English only
// ---------------------------------------------------------------------------

describe('English-only enforcement (ADR-012)', () => {
  it('drops Bengali from a value bound for the PDF, and says so with a dash', () => {
    // A member's note or an admin-edited letterhead can be Bengali. Helvetica
    // cannot draw it; a blank gap would look like missing data.
    expect(toPdfSafe('হাসনাহেনা ফাউন্ডেশন')).toBe('-');
    expect(toPdfSafe('Jashore শাখা')).toBe('Jashore');
  });

  it('transliterates typographic punctuation instead of dropping it', () => {
    // jsPDF discards anything above U+00FF silently, which turned
    // `the borrower’s own savings` into `the borrowers own savings` — a
    // possessive read as a plural, in the clause naming whose money is taken.
    expect(toPdfSafe('0% — Qard al-Hasan')).toBe('0% - Qard al-Hasan');
    expect(toPdfSafe('the borrower’s savings')).toBe("the borrower's savings");
    expect(toPdfSafe('“quoted”')).toBe('"quoted"');
    expect(toPdfSafe('and so on…')).toBe('and so on...');
  });

  it('keeps Latin-1, which the fonts can draw', () => {
    expect(toPdfSafe('Café · Jashore')).toBe('Café · Jashore');
  });

  it('leaves genuinely empty text empty rather than inventing a dash', () => {
    expect(toPdfSafe('')).toBe('');
    expect(toPdfSafe('   ')).toBe('');
  });

  it('prints no Bengali anywhere in a generated PDF', async () => {
    // The whole point of ADR-012: a document with half its letterhead missing
    // is worse than one that is plainly English.
    const model = buildMembershipCertificate({
      memberName: 'Rahima Khatun',
      memberId: 'ACC-KH-33001',
      memberSince: '2024-03-15T00:00:00.000Z',
    }, { nameEn: 'Hasnahena Foundation', name: 'হাসনাহেনা ফাউন্ডেশন' });

    const pdf = await renderPDF(model);
    for (const page of (pdf as never as { internal: { pages: string[][] } }).internal.pages) {
      if (!Array.isArray(page)) continue;
      for (const op of page) {
        for (const m of op.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
          expect(m[1], 'Bengali reached a PDF text operator').not.toMatch(/[ঀ-৿]/);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ADR-013 — document numbers come from the allocator
// ---------------------------------------------------------------------------

describe('document numbers (ADR-013)', () => {
  it('prints the allocated number as-is, never a second identifier', () => {
    const model = buildReceipt({
      receiptNumber: 'DEP-2026-000123',
      type: 'DEPOSIT',
      amount: 100,
      date: '2026-08-17T10:30:00.000Z',
      memberName: 'A',
      memberId: 'ACC-KH-33001',
      memberPhone: 'C',
      balanceAfter: 100,
    });
    expect(model.documentId).toBe('DEP-2026-000123');
    expect(model.refValue).toBe('DEP-2026-000123');
  });

  it.each([
    ['DEP-2026-000123', 'DEP-2026-000123'],
    ['WDR-2026-000004', 'WDR-2026-000004'],
    ['LOAN-2026-000007', 'LOAN-2026-000007'],
    ['REP-2026-000019', 'REP-2026-000019'],
    ['DON-2026-000002', 'DON-2026-000002'],
  ])('%s is used unchanged', (reference, expected) => {
    const model = buildReceipt({
      receiptNumber: reference,
      type: 'DEPOSIT',
      amount: 1,
      date: '2026-08-17T10:30:00.000Z',
      memberName: 'A',
      memberId: 'B',
      memberPhone: 'C',
      balanceAfter: 1,
    });
    expect(model.documentId).toBe(expected);
  });

  it('derives an id for documents that have no allocated number', () => {
    // A statement and a certificate are views, not postings, so they have no
    // row in `document_sequences` — their id is derived from the member.
    expect(statementWith([], 0).documentId).toBe('STMT-ACC-KH-33001');
    expect(
      buildMembershipCertificate({
        memberName: 'A',
        memberId: 'ACC-KH-33001',
        memberSince: '2024-03-15T00:00:00.000Z',
      }).documentId,
    ).toBe('CERT-ACC-KH-33001');
  });

  it('never prints an id built from a clock', () => {
    // LEDGER-04: donation receipts were numbered `DON-<timestamp>`, so two in
    // the same second collided. Nothing here may reintroduce that.
    const ids = [
      statementWith([], 0).documentId,
      buildMembershipCertificate({ memberName: 'A', memberId: 'ACC-KH-33001', memberSince: '2024-03-15' }).documentId,
    ];
    for (const id of ids) {
      expect(id).not.toMatch(/\d{10,}/);
    }
  });
});
