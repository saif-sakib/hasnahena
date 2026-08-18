import { describe, it, expect } from 'vitest';

import {
  buildReceipt,
  buildStatement,
  buildLoanAgreement,
  buildMembershipCertificate,
  renderHTML,
  renderPDF,
  type DocumentModel,
} from './index';
import { visibleText } from './builders.test';

// TEST-24 — the HTML and PDF renderers cannot drift.
//
// Two renderers, one document. A member prints from the browser; the office
// downloads the PDF; at a counter, months later, the two are compared. If a
// figure appears on one and not the other, neither is evidence of anything.
//
// Asserted structurally rather than by pixel: the question is not "do these
// look the same" — they deliberately do not, one is a web page and one is A4 —
// but "does every fact in the model reach both outputs". A screenshot diff
// would answer neither and break on every font update.

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/** Everything a reader would see in the HTML, with markup and entities removed. */
function textFromHTML(html: string): string {
  return html
    // Style and script bodies are not read by anyone.
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Everything the PDF actually draws.
 *
 * jsPDF keeps each page as an array of raw content-stream operators, and drawn
 * text is `(escaped) Tj`. Reading those is more honest than spying on the
 * `text()` calls: it is what ends up in the file, so a string passed to a
 * drawing call that never made it onto a page cannot pass this.
 */
function textFromPDF(pdf: { internal: { pages: string[][] } }): string {
  const chunks: string[] = [];
  for (const page of pdf.internal.pages) {
    if (!Array.isArray(page)) continue;
    for (const op of page) {
      for (const match of op.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
        chunks.push(
          match[1]
            .replace(/\\\(/g, '(')
            .replace(/\\\)/g, ')')
            .replace(/\\\\/g, '\\'),
        );
      }
    }
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The form both outputs are compared in.
 *
 * Two documented, deliberate differences are normalised away, and nothing else:
 *
 *  - **Case.** Titles, section headings, tile labels and column headers are
 *    drawn uppercase by the PDF and set `text-transform: uppercase` by the HTML
 *    — the same five places in each. Identical on the page, different in the
 *    source, so the comparison is case-insensitive.
 *  - **Typographic punctuation.** `toPdfSafe` transliterates it to Latin-1
 *    because the PDF fonts cannot draw it. The HTML keeps the real characters.
 *
 * Everything else that differs is drift, which is the point of the test.
 */
const normalise = (text: string): string =>
  text
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/…/g, '...')
    .replace(/•/g, '·')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const DOCUMENTS: Array<[string, () => DocumentModel]> = [
  [
    'receipt',
    () =>
      buildReceipt({
        receiptNumber: 'DEP-2026-000123',
        type: 'DEPOSIT',
        amount: 125000,
        date: '2026-08-17T10:30:00.000Z',
        memberName: 'Rahima Khatun',
        memberId: 'ACC-KH-33001',
        memberPhone: '01712345678',
        balanceAfter: 375000,
        processedBy: 'Abdul Karim',
        notes: 'Monthly deposit collected at the Bhekutia round',
      }),
  ],
  [
    'statement',
    () =>
      buildStatement({
        memberName: 'Rahima Khatun',
        memberId: 'ACC-KH-33001',
        memberPhone: '01712345678',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-31T00:00:00.000Z',
        openingBalance: 10000,
        closingBalance: 14000,
        totalDeposits: 6000,
        totalWithdrawals: 2000,
        transactions: [
          { date: '2026-07-05T00:00:00.000Z', type: 'DEPOSIT', amount: 6000, balance: 16000, receiptNumber: 'DEP-2026-000001' },
          { date: '2026-07-20T00:00:00.000Z', type: 'WITHDRAWAL', amount: 2000, balance: 14000, receiptNumber: 'WDR-2026-000002' },
        ],
      }),
  ],
  [
    'loan agreement',
    () =>
      buildLoanAgreement({
        loanNumber: 'LOAN-2026-000007',
        memberName: 'Rahima Khatun',
        memberId: 'ACC-KH-33001',
        memberPhone: '01712345678',
        memberAddress: 'Bhekutia, Sadar, Jashore',
        principalAmount: 50000,
        totalInstallments: 12,
        installmentAmount: 4166,
        disbursementDate: '2026-08-01T00:00:00.000Z',
        guarantorName: 'Abdul Karim',
        guarantorPhone: '01812345678',
        purpose: 'Sewing machine for tailoring work',
      }),
  ],
  [
    'membership certificate',
    () =>
      buildMembershipCertificate({
        memberName: 'Rahima Khatun',
        memberId: 'ACC-KH-33001',
        memberSince: '2024-03-15T00:00:00.000Z',
        phone: '01712345678',
        address: 'Bhekutia, Sadar, Jashore',
      }),
  ],
];

describe.each(DOCUMENTS)('%s renders the same content to both outputs', (_name, build) => {
  it('every value in the model reaches the HTML', () => {
    const model = build();
    const html = normalise(textFromHTML(renderHTML(model)));
    const missing = visibleText(model)
      .map(normalise)
      .filter((value) => value.length > 0 && !html.includes(value));
    expect(missing, `these strings are in the model but not in the HTML:\n  ${missing.join('\n  ')}`)
      .toEqual([]);
  });

  it('every value in the model reaches the PDF', async () => {
    const model = build();
    const pdf = await renderPDF(model);
    const drawn = normalise(textFromPDF(pdf as never));
    const missing = visibleText(model)
      .map(normalise)
      .filter((value) => value.length > 0 && !drawn.includes(value));
    expect(missing, `these strings are in the model but never drawn in the PDF:\n  ${missing.join('\n  ')}`)
      .toEqual([]);
  });

  it('the two outputs agree on every amount printed', async () => {
    // The narrowest thing worth pinning. A label that differs between the two
    // is a cosmetic bug; a *figure* that differs is a document that cannot be
    // reconciled against its own copy.
    const model = build();
    const amounts = (text: string) =>
      [...text.matchAll(/bdt\s[\d,]+/g)].map((m) => m[0].replace(/\s+/g, ' ')).sort();

    const fromHtml = amounts(normalise(textFromHTML(renderHTML(model))));
    const fromPdf = amounts(normalise(textFromPDF((await renderPDF(model)) as never)));

    // A membership certificate carries no money, and that is correct — so the
    // assertion is that the two agree, not that either is non-empty.
    expect(fromPdf).toEqual(fromHtml);
  });

  it('both carry the document id, so a printed page can be traced back', async () => {
    const model = build();
    const id = model.documentId.toLowerCase();
    expect(normalise(textFromHTML(renderHTML(model)))).toContain(id);
    expect(normalise(textFromPDF((await renderPDF(model)) as never))).toContain(id);
  });
});

describe('HTML escaping', () => {
  it('escapes member-supplied text rather than interpolating it as markup', () => {
    // Names, descriptions and notes are typed by people. A member called
    // `<script>` is unlikely; a note containing an ampersand is not.
    const model = buildReceipt({
      receiptNumber: 'DEP-2026-000999',
      type: 'DEPOSIT',
      amount: 100,
      date: '2026-08-17T10:30:00.000Z',
      memberName: '<script>alert(1)</script>',
      memberId: 'ACC & CO',
      memberPhone: '01712345678',
      balanceAfter: 100,
      notes: '"quoted" & <bold>',
    });
    const html = renderHTML(model);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('ACC &amp; CO');
    // …and the reader still sees the real text once the browser decodes it.
    expect(textFromHTML(html)).toContain('<script>alert(1)</script>');
    expect(textFromHTML(html)).toContain('"quoted" & <bold>');
  });
});
