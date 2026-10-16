/**
 * PDF renderer — real vector text (English only, ADR-012, so no shaping).
 * Explicit pagination before CONTENT_BOTTOM; footers painted per page last.
 */

import jsPDF from 'jspdf';
import { toPdfSafe } from '../format';
import {
  BRAND_LOGO_PRINT_PATH,
  BRAND_LOGO_RATIO,
  COLORS,
  CONTENT_BOTTOM,
  CONTENT_WIDTH,
  FOOTER_NOTE,
  PAGE,
  TAGLINE,
  getOrgNameEn,
  orgField,
} from '../theme';
import type { ColorName } from '../theme';
import type { Block, Cell, DocumentModel, Field, Tone } from '../types';

/** Points to millimetres. */
const PT = 0.352778;
/** Vertical advance for a line of text at the given point size. */
const lineHeight = (pt: number, factor = 1.32): number => pt * PT * factor;

const LEFT = PAGE.marginX;
const RIGHT = PAGE.marginX + CONTENT_WIDTH;

const TONE_COLOR: Record<Tone, ColorName> = {
  default: 'ink',
  credit: 'credit',
  debit: 'debit',
  muted: 'inkFaint',
  accent: 'brandDark',
};

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

let logoPromise: Promise<string | null> | null = null;

/** Fetch the masthead logo once per session and keep it as a data URL. */
function loadLogo(): Promise<string | null> {
  if (logoPromise) return logoPromise;
  logoPromise = (async () => {
    try {
      const response = await fetch(BRAND_LOGO_PRINT_PATH);
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null; // the masthead falls back to text-only
    }
  })();
  return logoPromise;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

class PdfWriter {
  private readonly doc: jsPDF;
  private y: number = PAGE.marginTop;

  constructor(
    private readonly model: DocumentModel,
    private readonly logo: string | null
  ) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    this.doc.setProperties({
      title: `${model.title} — ${model.refValue}`,
      subject: `${getOrgNameEn(model.org)} official document`,
      author: getOrgNameEn(model.org),
      keywords: model.documentId,
      creator: orgField(model.org, 'website'),
    });
  }

  // -- primitives ----------------------------------------------------------

  private fill(color: ColorName): void {
    const [r, g, b] = COLORS[color];
    this.doc.setFillColor(r, g, b);
  }

  private stroke(color: ColorName): void {
    const [r, g, b] = COLORS[color];
    this.doc.setDrawColor(r, g, b);
  }

  private ink(color: ColorName): void {
    const [r, g, b] = COLORS[color];
    this.doc.setTextColor(r, g, b);
  }

  private font(size: number, weight: 'normal' | 'bold' = 'normal', color: ColorName = 'ink'): void {
    this.doc.setFont('helvetica', weight);
    this.doc.setFontSize(size);
    this.ink(color);
  }

  private wrap(text: string, width: number): string[] {
    return this.doc.splitTextToSize(text || '', width) as string[];
  }

  private rule(y: number, color: ColorName = 'rule', width = 0.2, dotted = false): void {
    this.stroke(color);
    this.doc.setLineWidth(width);
    if (dotted) this.doc.setLineDashPattern([0.6, 0.8], 0);
    this.doc.line(LEFT, y, RIGHT, y);
    if (dotted) this.doc.setLineDashPattern([], 0);
  }

  /** Start a new page when `height` will not fit in the remaining space. */
  private ensure(height: number): void {
    if (this.y + height <= CONTENT_BOTTOM) return;
    this.newPage();
  }

  private newPage(): void {
    this.doc.addPage();
    this.y = PAGE.marginTop;
    this.runningHeader();
  }

  // -- page furniture ------------------------------------------------------

  private masthead(): void {
    const org = this.model.org;
    const name = getOrgNameEn(org);
    const top = this.y;

    let textLeft = LEFT;
    if (this.logo) {
      const height = 14;
      const width = height / BRAND_LOGO_RATIO;
      try {
        this.doc.addImage(this.logo, 'PNG', LEFT, top, width, height);
        textLeft = LEFT + width + 4;
      } catch {
        /* an undecodable logo must not stop the document */
      }
    }

    this.font(13.5, 'bold', 'brandDark');
    this.doc.text(name, textLeft, top + 6.5);
    this.font(7.5, 'normal', 'inkFaint');
    this.doc.text(TAGLINE, textLeft, top + 11);

    const contact = [
      orgField(org, 'address'),
      `${orgField(org, 'phone')} · ${orgField(org, 'email')}`,
      orgField(org, 'website'),
    ];
    if (org.regNumber) contact.push(`Reg. No: ${org.regNumber}`);

    this.font(7.5, 'normal', 'inkSoft');
    contact.forEach((line, index) => {
      this.doc.text(line, RIGHT, top + 4 + index * 3.4, { align: 'right' });
    });

    const bottom = Math.max(top + 16, top + 2 + contact.length * 3.4);
    this.rule(bottom, 'brand', 0.7);
    this.y = bottom + 6;
  }

  private runningHeader(): void {
    const top = this.y;
    this.font(9, 'bold', 'brandDark');
    this.doc.text(getOrgNameEn(this.model.org), LEFT, top + 3);
    this.font(8, 'normal', 'inkSoft');
    this.doc.text(`${this.model.title} · ${this.model.refValue}`, RIGHT, top + 3, {
      align: 'right',
    });
    this.rule(top + 5.5, 'rule', 0.3);
    this.y = top + 10;
  }

  private titleBar(): void {
    const height = 12;
    this.fill('brandTint');
    this.stroke('rule');
    this.doc.setLineWidth(0.2);
    this.doc.rect(LEFT, this.y, CONTENT_WIDTH, height, 'FD');
    this.fill('brand');
    this.doc.rect(LEFT, this.y, 1.2, height, 'F');

    this.font(12, 'bold', 'brandDark');
    this.doc.text(this.model.title.toUpperCase(), LEFT + 5, this.y + 7.8);

    this.font(7, 'normal', 'inkSoft');
    this.doc.text(this.model.refLabel, RIGHT - 5, this.y + 5, { align: 'right' });
    this.font(9, 'bold', 'ink');
    this.doc.text(this.model.refValue, RIGHT - 5, this.y + 9.4, { align: 'right' });

    this.y += height + 6;
  }

  private sectionTitle(title: string): void {
    this.ensure(10);
    this.font(7.5, 'bold', 'inkFaint');
    this.doc.text(title.toUpperCase(), LEFT, this.y + 2.6);
    this.rule(this.y + 4.6);
    this.y += 8;
  }

  /** Footers are painted last, once the page total is known. */
  private paintFooters(): void {
    const total = this.doc.getNumberOfPages();
    const org = getOrgNameEn(this.model.org);
    const generated = new Date().toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const ruleY = PAGE.height - PAGE.footerHeight + 1.5;

    for (let page = 1; page <= total; page++) {
      this.doc.setPage(page);
      this.rule(ruleY, 'rule', 0.2);

      this.font(6.5, 'normal', 'inkFaint');
      this.doc.text(FOOTER_NOTE, LEFT, ruleY + 4);
      this.doc.text(`© ${new Date().getFullYear()} ${org}`, LEFT, ruleY + 7.4);
      this.doc.text(`Doc ID: ${this.model.documentId}`, RIGHT, ruleY + 4, { align: 'right' });
      this.doc.text(`Generated: ${generated}`, RIGHT, ruleY + 7.4, { align: 'right' });

      this.font(6.5, 'bold', 'inkFaint');
      this.doc.text(`Page ${page} of ${total}`, PAGE.width / 2, ruleY + 11, { align: 'center' });
    }
  }

  // -- blocks --------------------------------------------------------------

  /** Draw one label/value pair inside a column; returns the height consumed. */
  private field(x: number, width: number, field: Field, measureOnly: boolean): number {
    const padding = 1.5;
    let height: number;

    this.font(8, 'normal', 'inkSoft');
    const labelWidth = field.label ? this.doc.getTextWidth(field.label) + 5 : 0;
    this.font(8.5, 'bold', 'ink');
    const inline = field.label ? this.wrap(field.value, width - labelWidth) : [];

    if (field.label && inline.length === 1) {
      // Comfortable case: label on the left, value flush right on the same line.
      height = 5.4;
      if (!measureOnly) {
        this.font(8, 'normal', 'inkSoft');
        this.doc.text(field.label, x, this.y + 3.4);
        this.font(8.5, 'bold', 'ink');
        this.doc.text(inline[0], x + width, this.y + 3.4, { align: 'right' });
      }
    } else {
      // Long value: stack it under the label and let it wrap across the column.
      const lines = this.wrap(field.value, width);
      const lead = field.label ? 4 : 0;
      height = lead + lines.length * lineHeight(8.5) + 1.4;
      if (!measureOnly) {
        if (field.label) {
          this.font(8, 'normal', 'inkSoft');
          this.doc.text(field.label, x, this.y + 3);
        }
        // A value long enough to wrap is prose, so it reads better unbolded.
        this.font(8.5, field.label && lines.length === 1 ? 'bold' : 'normal', 'ink');
        lines.forEach((line, index) => {
          this.doc.text(line, x, this.y + lead + 3 + index * lineHeight(8.5));
        });
      }
    }

    if (!measureOnly && field.label) {
      this.stroke('rule');
      this.doc.setLineWidth(0.15);
      this.doc.setLineDashPattern([0.5, 0.7], 0);
      this.doc.line(x, this.y + height - 0.6, x + width, this.y + height - 0.6);
      this.doc.setLineDashPattern([], 0);
    }

    return height + padding;
  }

  private fields(block: Extract<Block, { kind: 'fields' }>): void {
    this.sectionTitle(block.title);

    const gap = 8;
    const columnWidth = (CONTENT_WIDTH - gap) / 2;
    const queue = [...block.fields];

    while (queue.length > 0) {
      const first = queue.shift() as Field;

      if (first.wide) {
        const height = this.field(LEFT, CONTENT_WIDTH, first, true);
        this.ensure(height);
        this.field(LEFT, CONTENT_WIDTH, first, false);
        this.y += height;
        continue;
      }

      const second = queue[0] && !queue[0].wide ? (queue.shift() as Field) : null;
      const height = Math.max(
        this.field(LEFT, columnWidth, first, true),
        second ? this.field(LEFT + columnWidth + gap, columnWidth, second, true) : 0
      );
      this.ensure(height);
      this.field(LEFT, columnWidth, first, false);
      if (second) this.field(LEFT + columnWidth + gap, columnWidth, second, false);
      this.y += height;
    }

    this.y += 4;
  }

  private tiles(block: Extract<Block, { kind: 'tiles' }>): void {
    const count = block.tiles.length;
    if (count === 0) return;

    const gap = 4;
    const width = (CONTENT_WIDTH - gap * (count - 1)) / count;
    const height = 15;
    this.ensure(height + 4);

    block.tiles.forEach((tile, index) => {
      const x = LEFT + index * (width + gap);
      this.fill(tile.tone === 'accent' ? 'brandTint' : 'panel');
      this.stroke('rule');
      this.doc.setLineWidth(0.2);
      this.doc.rect(x, this.y, width, height, 'FD');

      this.font(6.5, 'normal', 'inkFaint');
      this.doc.text(tile.label.toUpperCase(), x + 3.5, this.y + 5);
      this.font(11, 'bold', TONE_COLOR[tile.tone ?? 'default']);
      this.doc.text(this.wrap(tile.value, width - 7)[0] ?? '', x + 3.5, this.y + 11);
    });

    this.y += height + 6;
  }

  private amount(block: Extract<Block, { kind: 'amount' }>): void {
    const tone: ColorName = block.tone;
    const height = block.after ? 32 : 25;
    this.ensure(height + 4);

    this.fill('panel');
    this.stroke('rule');
    this.doc.setLineWidth(0.2);
    this.doc.rect(LEFT, this.y, CONTENT_WIDTH, height, 'FD');
    this.fill(tone);
    this.doc.rect(LEFT, this.y, 1.5, height, 'F');

    this.font(7, 'normal', 'inkFaint');
    this.doc.text(block.label.toUpperCase(), LEFT + 6, this.y + 6);
    this.font(20, 'bold', tone);
    this.doc.text(block.value, LEFT + 6, this.y + 15);

    this.stroke('rule');
    this.doc.setLineWidth(0.15);
    this.doc.setLineDashPattern([0.5, 0.7], 0);
    this.doc.line(LEFT + 6, this.y + 18.5, RIGHT - 6, this.y + 18.5);
    this.doc.setLineDashPattern([], 0);

    this.font(8, 'normal', 'inkSoft');
    this.doc.text('In words:', LEFT + 6, this.y + 22.5);
    const wordsX = LEFT + 6 + this.doc.getTextWidth('In words: ');
    this.font(8, 'bold', 'ink');
    this.doc.text(this.wrap(block.words, RIGHT - 6 - wordsX)[0] ?? '', wordsX, this.y + 22.5);

    if (block.after) {
      this.font(8, 'normal', 'inkSoft');
      this.doc.text(`${block.after.label}:`, LEFT + 6, this.y + 28);
      const afterX = LEFT + 6 + this.doc.getTextWidth(`${block.after.label}: `);
      this.font(8, 'bold', 'brandDark');
      this.doc.text(block.after.value, afterX, this.y + 28);
    }

    this.y += height + 6;
  }

  private table(block: Extract<Block, { kind: 'table' }>): void {
    if (block.title) this.sectionTitle(block.title);

    const widths = block.columns.map((column) => column.width * CONTENT_WIDTH);
    const offsets = widths.map((_, index) =>
      widths.slice(0, index).reduce((sum, width) => sum + width, 0)
    );
    const padding = 2;
    const headerHeight = 7.5;

    const drawHeader = (): void => {
      this.fill('brandTint');
      this.stroke('rule');
      this.doc.setLineWidth(0.2);
      this.doc.rect(LEFT, this.y, CONTENT_WIDTH, headerHeight, 'FD');
      this.font(6.5, 'bold', 'brandDark');
      block.columns.forEach((column, index) => {
        const right = column.align === 'right';
        const x = LEFT + offsets[index] + (right ? widths[index] - padding : padding);
        this.doc.text(column.header.toUpperCase(), x, this.y + 5, {
          align: right ? 'right' : 'left',
        });
      });
      this.y += headerHeight;
    };

    const cellLines = (cell: Cell, index: number): string[] => {
      this.font(8, cell.bold ? 'bold' : 'normal');
      return this.wrap(cell.text, widths[index] - padding * 2);
    };

    this.ensure(headerHeight + 12);
    drawHeader();

    block.rows.forEach((row) => {
      const lines = row.cells.map(cellLines);
      const height = Math.max(
        7,
        Math.max(...lines.map((entry) => entry.length)) * lineHeight(8) + 3.4
      );

      if (this.y + height > CONTENT_BOTTOM) {
        this.newPage();
        drawHeader();
      }

      if (row.variant === 'boundary') {
        this.fill('brandTint');
        this.doc.rect(LEFT, this.y, CONTENT_WIDTH, height, 'F');
      }

      row.cells.forEach((cell, index) => {
        const column = block.columns[index];
        const align = cell.align ?? column?.align ?? 'left';
        const x = LEFT + offsets[index] + (align === 'right' ? widths[index] - padding : padding);
        this.font(8, cell.bold ? 'bold' : 'normal', TONE_COLOR[cell.tone ?? 'default']);
        lines[index].forEach((line, lineIndex) => {
          this.doc.text(line, x, this.y + 4.6 + lineIndex * lineHeight(8), { align });
        });
      });

      this.rule(this.y + height, 'ruleSoft', 0.15);
      this.y += height;
    });

    if (block.foot) {
      const height = 8;
      if (this.y + height > CONTENT_BOTTOM) {
        this.newPage();
        drawHeader();
      }
      this.fill('panel');
      this.doc.rect(LEFT, this.y, CONTENT_WIDTH, height, 'F');
      this.rule(this.y, 'brand', 0.5);
      block.foot.forEach((cell, index) => {
        const column = block.columns[index];
        const align = cell.align ?? column?.align ?? 'left';
        const x = LEFT + offsets[index] + (align === 'right' ? widths[index] - padding : padding);
        this.font(8, 'bold', TONE_COLOR[cell.tone ?? 'default']);
        this.doc.text(cell.text, x, this.y + 5.2, { align });
      });
      this.y += height;
    }

    this.y += 6;
  }

  private certify(block: Extract<Block, { kind: 'certify' }>): void {
    const centre = PAGE.width / 2;
    this.y += 6;

    this.font(10, 'normal', 'inkSoft');
    this.doc.text(block.intro, centre, this.y, { align: 'center' });
    this.y += 10;

    this.font(19, 'bold', 'brandDark');
    this.doc.text(block.name, centre, this.y, { align: 'center' });
    this.y += 6;

    this.font(8, 'normal', 'inkFaint');
    this.doc.text(block.subtitle, centre, this.y, { align: 'center' });
    this.y += 9;

    this.font(9.5, 'normal', 'ink');
    const lines = this.wrap(block.body, 140);
    lines.forEach((line) => {
      this.doc.text(line, centre, this.y, { align: 'center' });
      this.y += lineHeight(9.5, 1.6);
    });

    this.y += 6;
  }

  private notice(block: Extract<Block, { kind: 'notice' }>): void {
    this.font(8, 'normal', 'inkSoft');
    const lines = this.wrap(block.text, CONTENT_WIDTH - 12);
    const height = lines.length * lineHeight(8, 1.4) + 5;
    this.ensure(height + 4);

    this.fill('panel');
    this.stroke('rule');
    this.doc.setLineWidth(0.2);
    this.doc.rect(LEFT, this.y, CONTENT_WIDTH, height, 'FD');
    this.fill('brand');
    this.doc.rect(LEFT, this.y, 1.2, height, 'F');

    this.font(8, 'normal', 'inkSoft');
    lines.forEach((line, index) => {
      this.doc.text(line, LEFT + 6, this.y + 4.5 + index * lineHeight(8, 1.4));
    });

    this.y += height + 6;
  }

  private terms(block: Extract<Block, { kind: 'terms' }>): void {
    this.sectionTitle(block.title);
    const indent = 6;

    block.items.forEach((item, index) => {
      this.font(8.5, 'normal', 'ink');
      const lines = this.wrap(item, CONTENT_WIDTH - indent);
      const height = lines.length * lineHeight(8.5, 1.4) + 2;
      this.ensure(height);

      this.font(8.5, 'bold', 'brandDark');
      this.doc.text(`${index + 1}.`, LEFT, this.y + 3);
      this.font(8.5, 'normal', 'ink');
      lines.forEach((line, lineIndex) => {
        this.doc.text(line, LEFT + indent, this.y + 3 + lineIndex * lineHeight(8.5, 1.4));
      });
      this.y += height;
    });

    this.y += 4;
  }

  private placeholder(block: Extract<Block, { kind: 'placeholder' }>): void {
    const height = 22;
    this.ensure(height + 4);
    this.stroke('rule');
    this.doc.setLineWidth(0.3);
    this.doc.setLineDashPattern([1.2, 1.2], 0);
    this.doc.rect(LEFT, this.y, CONTENT_WIDTH, height, 'S');
    this.doc.setLineDashPattern([], 0);

    this.font(9, 'normal', 'inkFaint');
    this.doc.text(block.text, PAGE.width / 2, this.y + height / 2 + 1.5, { align: 'center' });
    this.y += height + 6;
  }

  private signatures(block: Extract<Block, { kind: 'signatures' }>): void {
    const count = block.signatures.length;
    if (count === 0) return;

    // A signature row is never split across pages.
    const height = 26;
    this.ensure(height);
    this.y += 12;

    const gap = count === 3 ? 10 : 18;
    const width = (CONTENT_WIDTH - gap * (count - 1)) / count;

    block.signatures.forEach((signature, index) => {
      const x = LEFT + index * (width + gap);
      const centre = x + width / 2;
      this.stroke('ink');
      this.doc.setLineWidth(0.25);
      this.doc.line(x, this.y, x + width, this.y);

      this.font(8, 'normal', 'inkSoft');
      this.doc.text(signature.role, centre, this.y + 4, { align: 'center' });
      if (signature.who) {
        this.font(7, 'normal', 'inkFaint');
        this.doc.text(signature.who, centre, this.y + 7.6, { align: 'center' });
      }
    });

    this.y += 14;
  }

  private block(block: Block): void {
    switch (block.kind) {
      case 'fields':
        return this.fields(block);
      case 'amount':
        return this.amount(block);
      case 'tiles':
        return this.tiles(block);
      case 'table':
        return this.table(block);
      case 'certify':
        return this.certify(block);
      case 'notice':
        return this.notice(block);
      case 'terms':
        return this.terms(block);
      case 'placeholder':
        return this.placeholder(block);
      case 'signatures':
        return this.signatures(block);
    }
  }

  render(): jsPDF {
    this.masthead();
    this.titleBar();
    this.model.blocks.forEach((block) => this.block(block));
    this.paintFooters();
    return this.doc;
  }
}

/** Strip unencodable glyphs everywhere in the model at once. */
function sanitize<T>(value: T): T {
  if (typeof value === 'string') return toPdfSafe(value) as unknown as T;
  if (Array.isArray(value)) return value.map(sanitize) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitize(entry)])
    ) as T;
  }
  return value;
}

/** Render a document model to a paginated, text-selectable A4 PDF. */
export async function renderPDF(model: DocumentModel): Promise<jsPDF> {
  const logo = await loadLogo();
  return new PdfWriter(sanitize(model), logo).render();
}
