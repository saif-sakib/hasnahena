/**
 * Shared visual system for every official document.
 *
 * Constraints that shape this file:
 *  - html2canvas 1.4 cannot parse modern colour syntax, so every colour is hex/rgb.
 *  - `position: fixed` is resolved against the viewport during capture, so the
 *    watermark and every overlay are absolutely positioned inside `.document`.
 *  - The layout is print-first: A4 geometry, repeating table headers and
 *    break-avoid rules, so browser "Save as PDF" produces real selectable text.
 */

import { esc, isBn } from './format';
import type { OrgSettings } from './types';

export const BRAND_NAME_EN = 'Hasnahena Foundation';
export const BRAND_NAME_BN = 'হাসনাহেনা ফাউন্ডেশন';
export const BRAND_LOGO_PATH = '/images/logo/logo.png';

export const DEFAULT_ORG: OrgSettings = {
  name: BRAND_NAME_BN,
  nameEn: BRAND_NAME_EN,
  address: 'ভেকুটিয়া, সদর, যশোর, বাংলাদেশ',
  phone: '+880 1712-345678',
  email: 'info@hasnahenafoundation.com',
  website: 'hasnahenafoundation.com',
};

const LEDGER_NOTICE = {
  en: 'The foundation’s official ledger is the final record. This document is generated for member convenience and should be reconciled with the physical passbook.',
  bn: 'ফাউন্ডেশনের অফিসিয়াল লেজারই চূড়ান্ত রেকর্ড। এই ডকুমেন্টটি সদস্যের সুবিধার্থে তৈরি এবং ফিজিক্যাল পাস বইয়ের সাথে মিলিয়ে দেখতে হবে।',
};

const TAGLINE = {
  en: 'Interest-free cooperative finance · Qard al-Hasan',
  bn: 'সুদমুক্ত সমবায় আর্থিক সেবা · কর্জে হাসানাহ',
};

export const getOrgNameEn = (org: OrgSettings = DEFAULT_ORG): string => {
  const name = org.nameEn?.trim();
  return !name || name.toLowerCase() === 'hasnahena' ? BRAND_NAME_EN : name;
};

export const getOrgNameBn = (org: OrgSettings = DEFAULT_ORG): string => {
  const name = org.name?.trim();
  return !name || name === 'হাসনাহেনা' || name.includes('সমিতি') ? BRAND_NAME_BN : name;
};

/**
 * Loaded with <link> rather than @import: @import resolves asynchronously and
 * frequently loses the race with html2canvas, which is how Bengali text ends up
 * rendered in a fallback face.
 */
const FONT_LINKS = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
`;

export const A4 = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 14,
} as const;

const styles = (): string => `
<style>
  :root {
    --ink:        #16211f;
    --ink-soft:   #55655f;
    --ink-faint:  #8a9894;
    --brand:      #0f766e;
    --brand-dark: #0b544e;
    --brand-tint: #f2f9f7;
    --credit:     #047857;
    --debit:      #b91c1c;
    --rule:       #dbe5e2;
    --rule-soft:  #edf2f0;
    --paper:      #ffffff;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Noto Sans Bengali', 'Inter', 'Segoe UI', Arial, sans-serif;
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink);
    background: #eef2f1;
    -webkit-font-smoothing: antialiased;
  }

  .document {
    position: relative;
    width: ${A4.widthMm}mm;
    min-height: ${A4.heightMm}mm;
    margin: 16px auto;
    padding: ${A4.marginMm}mm;
    background: var(--paper);
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.10);
    overflow: hidden;
  }

  /* ---------- masthead ---------- */
  .masthead {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--brand);
  }
  .masthead-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand-logo { height: 60px; width: auto; max-width: 200px; display: block; }
  .brand-names { min-width: 0; }
  .org-name-en {
    font-family: 'Inter', 'Noto Sans Bengali', sans-serif;
    font-size: 19px; font-weight: 700; color: var(--brand-dark); line-height: 1.15;
  }
  .org-name-bn { font-size: 14px; font-weight: 600; color: var(--brand); margin-top: 2px; }
  .org-tagline { font-size: 10px; color: var(--ink-faint); margin-top: 3px; }

  .masthead-contact {
    text-align: right;
    font-size: 10px;
    color: var(--ink-soft);
    line-height: 1.7;
    white-space: nowrap;
  }
  .masthead-contact .reg { color: var(--ink-faint); }

  /* ---------- title bar ---------- */
  .doc-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-top: 16px;
    padding: 9px 14px;
    background: var(--brand-tint);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--brand);
    border-radius: 3px;
  }
  .doc-title h1 {
    font-size: 15px; font-weight: 700; letter-spacing: 0.4px;
    color: var(--brand-dark); text-transform: uppercase;
  }
  .doc-title .doc-ref { font-size: 10px; color: var(--ink-soft); text-align: right; white-space: nowrap; }
  .doc-title .doc-ref strong { color: var(--ink); font-size: 11px; }

  /* ---------- key/value blocks ---------- */
  .panel { margin-top: 16px; break-inside: avoid; }
  .panel-title {
    font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
    color: var(--ink-faint); padding-bottom: 5px; margin-bottom: 9px;
    border-bottom: 1px solid var(--rule);
  }
  .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 22px; }
  .kv { display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
        padding-bottom: 5px; border-bottom: 1px dotted var(--rule); }
  .kv.wide { grid-column: 1 / -1; }
  .kv-label { font-size: 11px; color: var(--ink-soft); }
  .kv-value { font-size: 11.5px; font-weight: 600; color: var(--ink); text-align: right; }

  /* ---------- amount hero (receipts) ---------- */
  .amount-hero {
    margin-top: 18px; padding: 16px 18px; border-radius: 4px;
    border: 1px solid var(--rule); background: #fafcfb; break-inside: avoid;
  }
  .amount-hero.credit { border-left: 4px solid var(--credit); }
  .amount-hero.debit  { border-left: 4px solid var(--debit); }
  .amount-hero .label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--ink-faint);
  }
  .amount-hero .value {
    font-size: 30px; font-weight: 700; line-height: 1.2; margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .amount-hero.credit .value { color: var(--credit); }
  .amount-hero.debit  .value { color: var(--debit); }
  .amount-hero .words {
    margin-top: 6px; padding-top: 6px; border-top: 1px dotted var(--rule);
    font-size: 11px; color: var(--ink-soft);
  }
  .amount-hero .words b { color: var(--ink); font-weight: 600; }
  .amount-hero .after {
    margin-top: 8px; font-size: 11px; color: var(--ink-soft);
  }
  .amount-hero .after strong { color: var(--brand-dark); font-variant-numeric: tabular-nums; }

  /* ---------- summary tiles ---------- */
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 16px; }
  .tiles.three { grid-template-columns: repeat(3, 1fr); }
  .tile {
    padding: 11px 12px; border: 1px solid var(--rule); border-radius: 4px;
    background: #fbfdfc; break-inside: avoid;
  }
  .tile .label {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--ink-faint);
  }
  .tile .value {
    font-size: 15px; font-weight: 700; margin-top: 3px; color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .tile.credit .value { color: var(--credit); }
  .tile.debit  .value { color: var(--debit); }
  .tile.accent { background: var(--brand-tint); border-color: #bfdcd6; }
  .tile.accent .value { color: var(--brand-dark); }

  /* ---------- ledger table ---------- */
  table.ledger { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
  table.ledger thead { display: table-header-group; }
  table.ledger tr { break-inside: avoid; page-break-inside: avoid; }
  table.ledger th {
    background: var(--brand-tint); color: var(--brand-dark);
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    text-align: left; padding: 8px 8px;
    border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
  }
  table.ledger td {
    padding: 7px 8px; border-bottom: 1px solid var(--rule-soft); vertical-align: top;
  }
  table.ledger .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.ledger .ref { white-space: nowrap; font-size: 10px; letter-spacing: -0.1px; }
  table.ledger .credit { color: var(--credit); }
  table.ledger .debit  { color: var(--debit); }
  table.ledger .balance { font-weight: 600; }
  table.ledger .muted { color: var(--ink-faint); }
  table.ledger tr.boundary td {
    background: #f7faf9; font-weight: 600; color: var(--ink-soft);
    border-bottom: 1px solid var(--rule);
  }
  table.ledger tfoot td {
    padding: 9px 8px; border-top: 2px solid var(--brand); border-bottom: none;
    font-weight: 700; background: #fbfdfc;
  }
  .empty-state {
    margin-top: 10px; padding: 26px; text-align: center;
    border: 1px dashed var(--rule); border-radius: 4px; color: var(--ink-faint); font-size: 11.5px;
  }

  /* ---------- notes, terms ---------- */
  .notice {
    margin-top: 16px; padding: 9px 12px; border-radius: 3px;
    border: 1px solid var(--rule); border-left: 3px solid var(--brand);
    background: #f8fbfa; font-size: 10.5px; line-height: 1.5; color: var(--ink-soft);
    break-inside: avoid;
  }
  .terms { margin-top: 16px; break-inside: avoid; }
  .terms ol { margin: 0; padding-left: 16px; }
  .terms li { font-size: 11px; margin-bottom: 6px; line-height: 1.55; }

  /* ---------- signatures ---------- */
  .signatures {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 48px;
    margin-top: 44px; break-inside: avoid;
  }
  .signatures.three { grid-template-columns: repeat(3, 1fr); gap: 28px; }
  .sign { text-align: center; }
  .sign .line { border-top: 1px solid var(--ink); margin-bottom: 6px; }
  .sign .role { font-size: 10.5px; color: var(--ink-soft); }
  .sign .who { font-size: 9.5px; color: var(--ink-faint); margin-top: 2px; }

  /* ---------- footer ---------- */
  .doc-footer {
    margin-top: 26px; padding-top: 9px; border-top: 1px solid var(--rule);
    display: flex; justify-content: space-between; gap: 14px;
    font-size: 9px; color: var(--ink-faint); line-height: 1.6;
  }
  .doc-footer .right { text-align: right; white-space: nowrap; }

  .watermark {
    position: absolute; top: 45%; left: 50%;
    transform: translate(-50%, -50%) rotate(-28deg);
    font-family: 'Inter', 'Noto Sans Bengali', sans-serif;
    font-size: 64px; font-weight: 700; white-space: nowrap;
    color: rgba(15, 118, 110, 0.045);
    pointer-events: none; z-index: 0;
  }
  .document > *:not(.watermark) { position: relative; z-index: 1; }

  .toolbar {
    position: absolute; top: 14px; right: 16px; display: flex; gap: 8px; z-index: 10;
  }
  .toolbar button {
    padding: 9px 18px; border: none; border-radius: 6px; cursor: pointer;
    font-family: inherit; font-size: 13px; font-weight: 600;
    background: var(--brand); color: #fff; box-shadow: 0 4px 12px rgba(15, 118, 110, 0.28);
  }
  .toolbar button:hover { background: var(--brand-dark); }

  @page { size: A4 portrait; margin: ${A4.marginMm}mm; }

  @media print {
    body { background: #fff; }
    .document {
      width: auto; min-height: auto; margin: 0; padding: 0;
      box-shadow: none; overflow: visible;
    }
    .toolbar { display: none !important; }
    .watermark { position: fixed; }
  }
</style>
`;

export interface ShellOptions {
  locale: string;
  org: OrgSettings;
  /** Uppercase document type, e.g. "ACCOUNT STATEMENT". */
  title: string;
  /** Reference line printed at the right of the title bar. */
  refLabel: string;
  refValue: string;
  documentId: string;
  /** Main content HTML. */
  body: string;
  /** Signature row HTML, already escaped. */
  signatures?: string;
  /** Browser tab / print title. */
  windowTitle: string;
  showLedgerNotice?: boolean;
}

const masthead = (locale: string, org: OrgSettings): string => {
  const bn = isBn(locale);
  return `
  <header class="masthead">
    <div class="masthead-brand">
      <img class="brand-logo" src="${BRAND_LOGO_PATH}" alt="${esc(getOrgNameEn(org))}" crossorigin="anonymous" />
      <div class="brand-names">
        <div class="org-name-en">${esc(getOrgNameEn(org))}</div>
        <div class="org-name-bn">${esc(getOrgNameBn(org))}</div>
        <div class="org-tagline">${bn ? TAGLINE.bn : TAGLINE.en}</div>
      </div>
    </div>
    <div class="masthead-contact">
      <div>${esc(org.address || DEFAULT_ORG.address)}</div>
      <div>${esc(org.phone || DEFAULT_ORG.phone)} · ${esc(org.email || DEFAULT_ORG.email)}</div>
      <div>${esc(org.website || DEFAULT_ORG.website)}</div>
      ${org.regNumber ? `<div class="reg">${bn ? 'রেজি. নং' : 'Reg. No'}: ${esc(org.regNumber)}</div>` : ''}
    </div>
  </header>`;
};

const footer = (locale: string, org: OrgSettings, documentId: string): string => {
  const bn = isBn(locale);
  const generated = new Date().toLocaleString(bn ? 'bn-BD' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `
  <footer class="doc-footer">
    <div>
      <div>${bn
        ? 'কম্পিউটারে তৈরি ডকুমেন্ট — সিল ও স্বাক্ষর ছাড়াই বৈধ।'
        : 'Computer-generated document — valid without seal or signature.'}</div>
      <div>© ${new Date().getFullYear()} ${esc(getOrgNameEn(org))}</div>
    </div>
    <div class="right">
      <div>${bn ? 'ডক. আইডি' : 'Doc ID'}: ${esc(documentId)}</div>
      <div>${bn ? 'তৈরি' : 'Generated'}: ${esc(generated)}</div>
    </div>
  </footer>`;
};

/** Compose a complete, standalone HTML document. */
export function renderShell(options: ShellOptions): string {
  const { locale, org, title, refLabel, refValue, documentId, body, signatures, windowTitle } = options;
  const bn = isBn(locale);

  return `<!DOCTYPE html>
<html lang="${bn ? 'bn' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(windowTitle)}</title>
  ${FONT_LINKS}
  ${styles()}
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">${bn ? 'প্রিন্ট করুন' : 'Print'}</button>
  </div>
  <div class="document">
    <div class="watermark">${esc(getOrgNameEn(org))}</div>
    ${masthead(locale, org)}
    <div class="doc-title">
      <h1>${esc(title)}</h1>
      <div class="doc-ref">${esc(refLabel)}<br/><strong>${esc(refValue)}</strong></div>
    </div>
    ${body}
    ${options.showLedgerNotice === false ? '' : `<div class="notice">${bn ? LEDGER_NOTICE.bn : LEDGER_NOTICE.en}</div>`}
    ${signatures ?? ''}
    ${footer(locale, org, documentId)}
  </div>
</body>
</html>`;
}

/** Signature row builder — keeps every document's sign-off consistent. */
export function renderSignatures(
  blocks: Array<{ role: string; who?: string }>,
): string {
  const cls = blocks.length === 3 ? 'signatures three' : 'signatures';
  return `
  <div class="${cls}">
    ${blocks
      .map(
        (block) => `
    <div class="sign">
      <div class="line"></div>
      <div class="role">${esc(block.role)}</div>
      ${block.who ? `<div class="who">${esc(block.who)}</div>` : ''}
    </div>`
      )
      .join('')}
  </div>`;
}
