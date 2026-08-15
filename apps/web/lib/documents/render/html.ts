/**
 * HTML renderer — on-screen preview and the browser print path.
 *
 * Print-first: A4 `@page` geometry, repeating table headers, and break-avoid
 * rules, so the browser's own "Save as PDF" also produces real selectable text.
 * The downloadable PDF is drawn separately by `render/pdf.ts`; both consume the
 * same document model, so the two outputs cannot drift apart.
 */

import { esc } from '../format';
import {
  BRAND_LOGO_PATH,
  FOOTER_NOTE,
  PAGE,
  TAGLINE,
  getOrgNameEn,
  hex,
  orgField,
} from '../theme';
import type { Block, Cell, DocumentModel, Tone } from '../types';

const toneClass = (tone?: Tone): string => (tone && tone !== 'default' ? ` ${tone}` : '');

const cellHtml = (cell: Cell, align?: 'left' | 'right'): string => {
  const alignment = cell.align ?? align ?? 'left';
  const classes = [
    alignment === 'right' ? 'num' : '',
    cell.tone && cell.tone !== 'default' ? cell.tone : '',
    cell.bold ? 'strong' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<td${classes ? ` class="${classes}"` : ''}>${esc(cell.text)}</td>`;
};

function renderTable(block: Extract<Block, { kind: 'table' }>): string {
  const head = block.columns
    .map(
      (column) =>
        `<th style="width:${(column.width * 100).toFixed(2)}%${
          column.align === 'right' ? ';text-align:right' : ''
        }">${esc(column.header)}</th>`
    )
    .join('');

  const body = block.rows
    .map(
      (row) =>
        `<tr${row.variant === 'boundary' ? ' class="boundary"' : ''}>${row.cells
          .map((cell, index) => cellHtml(cell, block.columns[index]?.align))
          .join('')}</tr>`
    )
    .join('');

  const foot = block.foot
    ? `<tfoot><tr>${block.foot
        .map((cell, index) => cellHtml(cell, block.columns[index]?.align))
        .join('')}</tr></tfoot>`
    : '';

  return `
    <section class="panel">
      ${block.title ? `<div class="panel-title">${esc(block.title)}</div>` : ''}
      <table class="ledger">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
        ${foot}
      </table>
    </section>`;
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'fields':
      return `
    <section class="panel">
      <div class="panel-title">${esc(block.title)}</div>
      <div class="kv-grid">
        ${block.fields
          .map(
            (field) => `
        <div class="kv${field.wide ? ' wide' : ''}${field.label ? '' : ' free'}">
          ${field.label ? `<span class="kv-label">${esc(field.label)}</span>` : ''}
          <span class="kv-value">${esc(field.value)}</span>
        </div>`
          )
          .join('')}
      </div>
    </section>`;

    case 'amount':
      return `
    <div class="amount-hero ${block.tone}">
      <div class="label">${esc(block.label)}</div>
      <div class="value">${esc(block.value)}</div>
      <div class="words">In words: <b>${esc(block.words)}</b></div>
      ${block.after
        ? `<div class="after">${esc(block.after.label)}: <strong>${esc(block.after.value)}</strong></div>`
        : ''}
    </div>`;

    case 'tiles':
      return `
    <div class="tiles${block.tiles.length === 3 ? ' three' : ''}">
      ${block.tiles
        .map(
          (tile) => `
      <div class="tile${toneClass(tile.tone)}">
        <div class="label">${esc(tile.label)}</div>
        <div class="value">${esc(tile.value)}</div>
      </div>`
        )
        .join('')}
    </div>`;

    case 'table':
      return renderTable(block);

    case 'certify':
      return `
    <section class="certify">
      <div class="intro">${esc(block.intro)}</div>
      <div class="name">${esc(block.name)}</div>
      <div class="subtitle">${esc(block.subtitle)}</div>
      <p>${esc(block.body)}</p>
    </section>`;

    case 'notice':
      return `<div class="notice">${esc(block.text)}</div>`;

    case 'terms':
      return `
    <section class="terms">
      <div class="panel-title">${esc(block.title)}</div>
      <ol>${block.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>
    </section>`;

    case 'placeholder':
      return `<div class="empty-state">${esc(block.text)}</div>`;

    case 'signatures':
      return `
    <div class="signatures${block.signatures.length === 3 ? ' three' : ''}">
      ${block.signatures
        .map(
          (signature) => `
      <div class="sign">
        <div class="line"></div>
        <div class="role">${esc(signature.role)}</div>
        ${signature.who ? `<div class="who">${esc(signature.who)}</div>` : ''}
      </div>`
        )
        .join('')}
    </div>`;
  }
}

const styles = (): string => `
<style>
  :root {
    --ink: ${hex('ink')};
    --ink-soft: ${hex('inkSoft')};
    --ink-faint: ${hex('inkFaint')};
    --brand: ${hex('brand')};
    --brand-dark: ${hex('brandDark')};
    --brand-tint: ${hex('brandTint')};
    --credit: ${hex('credit')};
    --debit: ${hex('debit')};
    --rule: ${hex('rule')};
    --rule-soft: ${hex('ruleSoft')};
    --panel: ${hex('panel')};
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink);
    background: #eef2f1;
    -webkit-font-smoothing: antialiased;
  }

  .document {
    position: relative;
    width: ${PAGE.width}mm;
    min-height: ${PAGE.height}mm;
    margin: 16px auto;
    padding: ${PAGE.marginTop}mm ${PAGE.marginX}mm;
    background: #fff;
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.10);
  }

  /* masthead */
  .masthead {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 18px;
    padding-bottom: 10px; border-bottom: 2px solid var(--brand);
  }
  .masthead-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand-logo { height: 58px; width: auto; max-width: 200px; display: block; }
  .org-name-en { font-size: 19px; font-weight: 700; color: var(--brand-dark); line-height: 1.15; }
  .org-tagline { font-size: 10px; color: var(--ink-faint); margin-top: 3px; }
  .masthead-contact {
    text-align: right; font-size: 10px; color: var(--ink-soft); line-height: 1.7; white-space: nowrap;
  }
  .masthead-contact .reg { color: var(--ink-faint); }

  /* title bar */
  .doc-title {
    display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
    margin-top: 14px; padding: 9px 14px;
    background: var(--brand-tint); border: 1px solid var(--rule);
    border-left: 3px solid var(--brand); border-radius: 3px;
  }
  .doc-title h1 {
    font-size: 15px; font-weight: 700; letter-spacing: 0.4px;
    color: var(--brand-dark); text-transform: uppercase;
  }
  .doc-title .doc-ref { font-size: 10px; color: var(--ink-soft); text-align: right; white-space: nowrap; }
  .doc-title .doc-ref strong { color: var(--ink); font-size: 11px; }

  /* field grid */
  .panel { margin-top: 15px; break-inside: avoid; }
  .panel-title {
    font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
    color: var(--ink-faint); padding-bottom: 5px; margin-bottom: 9px; border-bottom: 1px solid var(--rule);
  }
  .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 22px; }
  .kv {
    display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
    padding-bottom: 5px; border-bottom: 1px dotted var(--rule);
  }
  .kv.wide { grid-column: 1 / -1; }
  .kv.free { border-bottom: none; }
  .kv.free .kv-value { text-align: left; font-weight: 400; }
  .kv-label { font-size: 11px; color: var(--ink-soft); }
  .kv-value { font-size: 11.5px; font-weight: 600; color: var(--ink); text-align: right; }

  /* receipt amount */
  .amount-hero {
    margin-top: 16px; padding: 16px 18px; border-radius: 4px;
    border: 1px solid var(--rule); background: var(--panel); break-inside: avoid;
  }
  .amount-hero.credit { border-left: 4px solid var(--credit); }
  .amount-hero.debit { border-left: 4px solid var(--debit); }
  .amount-hero .label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--ink-faint);
  }
  .amount-hero .value {
    font-size: 28px; font-weight: 700; line-height: 1.2; margin-top: 2px; font-variant-numeric: tabular-nums;
  }
  .amount-hero.credit .value { color: var(--credit); }
  .amount-hero.debit .value { color: var(--debit); }
  .amount-hero .words {
    margin-top: 6px; padding-top: 6px; border-top: 1px dotted var(--rule);
    font-size: 11px; color: var(--ink-soft);
  }
  .amount-hero .words b { color: var(--ink); font-weight: 600; }
  .amount-hero .after { margin-top: 8px; font-size: 11px; color: var(--ink-soft); }
  .amount-hero .after strong { color: var(--brand-dark); font-variant-numeric: tabular-nums; }

  /* tiles */
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 15px; }
  .tiles.three { grid-template-columns: repeat(3, 1fr); }
  .tile { padding: 11px 12px; border: 1px solid var(--rule); border-radius: 4px; background: var(--panel); break-inside: avoid; }
  .tile .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--ink-faint); }
  .tile .value { font-size: 14px; font-weight: 700; margin-top: 3px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .tile.credit .value { color: var(--credit); }
  .tile.debit .value { color: var(--debit); }
  .tile.accent { background: var(--brand-tint); border-color: #bfdcd6; }
  .tile.accent .value { color: var(--brand-dark); }

  /* ledger */
  table.ledger { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; }
  table.ledger thead { display: table-header-group; }
  table.ledger tr { break-inside: avoid; page-break-inside: avoid; }
  table.ledger th {
    background: var(--brand-tint); color: var(--brand-dark);
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    text-align: left; padding: 8px;
    border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
  }
  table.ledger td { padding: 7px 8px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
  table.ledger .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.ledger .credit { color: var(--credit); }
  table.ledger .debit { color: var(--debit); }
  table.ledger .strong { font-weight: 600; }
  table.ledger .muted { color: var(--ink-faint); white-space: nowrap; }
  table.ledger tr.boundary td {
    background: #f7faf9; color: var(--ink-soft); border-bottom: 1px solid var(--rule);
  }
  table.ledger tfoot td {
    padding: 9px 8px; border-top: 2px solid var(--brand); border-bottom: none;
    font-weight: 700; background: var(--panel);
  }
  .empty-state {
    margin-top: 12px; padding: 26px; text-align: center;
    border: 1px dashed var(--rule); border-radius: 4px; color: var(--ink-faint); font-size: 11.5px;
  }

  /* certificate */
  .certify { margin-top: 22px; text-align: center; break-inside: avoid; }
  .certify .intro { font-size: 13px; color: var(--ink-soft); letter-spacing: 0.4px; }
  .certify .name { font-size: 24px; font-weight: 700; color: var(--brand-dark); margin: 10px 0 4px; }
  .certify .subtitle { font-size: 11px; color: var(--ink-faint); }
  .certify p { margin: 18px auto 0; max-width: 150mm; font-size: 12.5px; line-height: 1.95; }

  /* notices, terms */
  .notice {
    margin-top: 15px; padding: 9px 12px; border-radius: 3px;
    border: 1px solid var(--rule); border-left: 3px solid var(--brand);
    background: var(--panel); font-size: 10.5px; line-height: 1.5; color: var(--ink-soft);
    break-inside: avoid;
  }
  .terms { margin-top: 15px; break-inside: avoid; }
  .terms ol { margin: 0; padding-left: 16px; }
  .terms li { font-size: 11px; margin-bottom: 6px; line-height: 1.55; }

  /* signatures */
  .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 48px; margin-top: 42px; break-inside: avoid; }
  .signatures.three { grid-template-columns: repeat(3, 1fr); gap: 28px; }
  .sign { text-align: center; }
  .sign .line { border-top: 1px solid var(--ink); margin-bottom: 6px; }
  .sign .role { font-size: 10.5px; color: var(--ink-soft); }
  .sign .who { font-size: 9.5px; color: var(--ink-faint); margin-top: 2px; }

  /* footer */
  .doc-footer {
    margin-top: 24px; padding-top: 9px; border-top: 1px solid var(--rule);
    display: flex; justify-content: space-between; gap: 14px;
    font-size: 9px; color: var(--ink-faint); line-height: 1.6;
  }
  .doc-footer .right { text-align: right; white-space: nowrap; }

  .toolbar { position: absolute; top: 14px; right: 16px; display: flex; gap: 8px; z-index: 10; }
  .toolbar button {
    padding: 9px 18px; border: none; border-radius: 6px; cursor: pointer;
    font: inherit; font-size: 13px; font-weight: 600;
    background: var(--brand); color: #fff; box-shadow: 0 4px 12px rgba(15, 118, 110, 0.28);
  }
  .toolbar button:hover { background: var(--brand-dark); }

  @page { size: A4 portrait; margin: ${PAGE.marginTop}mm ${PAGE.marginX}mm; }

  @media print {
    body { background: #fff; }
    .document { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; }
    .toolbar { display: none !important; }
  }
</style>`;

/** Render a document model as a standalone, print-ready HTML page. */
export function renderHTML(model: DocumentModel): string {
  const { org } = model;
  const orgName = getOrgNameEn(org);
  const generated = new Date().toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(`${model.title} · ${model.refValue}`)}</title>
  ${styles()}
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Print</button></div>
  <div class="document">
    <header class="masthead">
      <div class="masthead-brand">
        <img class="brand-logo" src="${BRAND_LOGO_PATH}" alt="${esc(orgName)}" />
        <div>
          <div class="org-name-en">${esc(orgName)}</div>
          <div class="org-tagline">${esc(TAGLINE)}</div>
        </div>
      </div>
      <div class="masthead-contact">
        <div>${esc(orgField(org, 'address'))}</div>
        <div>${esc(orgField(org, 'phone'))} · ${esc(orgField(org, 'email'))}</div>
        <div>${esc(orgField(org, 'website'))}</div>
        ${org.regNumber ? `<div class="reg">Reg. No: ${esc(org.regNumber)}</div>` : ''}
      </div>
    </header>

    <div class="doc-title">
      <h1>${esc(model.title)}</h1>
      <div class="doc-ref">${esc(model.refLabel)}<br/><strong>${esc(model.refValue)}</strong></div>
    </div>

    ${model.blocks.map(renderBlock).join('\n')}

    <footer class="doc-footer">
      <div>
        <div>${esc(FOOTER_NOTE)}</div>
        <div>© ${new Date().getFullYear()} ${esc(orgName)}</div>
      </div>
      <div class="right">
        <div>Doc ID: ${esc(model.documentId)}</div>
        <div>Generated: ${esc(generated)}</div>
      </div>
    </footer>
  </div>
</body>
</html>`;
}
