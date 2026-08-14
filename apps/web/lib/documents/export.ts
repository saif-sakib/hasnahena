/**
 * Document output: print window, raw HTML, and paginated PDF.
 *
 * Why the PDF is rasterised rather than drawn with jsPDF text primitives:
 * jsPDF cannot shape complex scripts, so Bengali conjuncts and matras come out
 * reordered or broken. Rendering in the browser and capturing the result is the
 * only route that produces correct Bengali. The trade-off is a non-selectable
 * PDF, so the print path (real text, native pagination) stays available and is
 * the better option whenever the user just wants a file from the print dialog.
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { A4 } from './theme';

/** Reserved strip at the foot of every page for the page counter. */
const FOOTER_STRIP_MM = 7;
const CONTENT_WIDTH_MM = A4.widthMm - A4.marginMm * 2;
const CONTENT_HEIGHT_MM = A4.heightMm - A4.marginMm * 2 - FOOTER_STRIP_MM;

/** Canvases beyond this height fail to allocate in some browsers. */
const MAX_CANVAS_HEIGHT_PX = 16000;
/** JPEG keeps multi-page statements to a sane size; 0.95 is visually lossless for text at 2x. */
const JPEG_QUALITY = 0.95;

const sanitiseFilename = (name: string): string =>
  (name || 'document').replace(/[^\w\-.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

export function openPrintWindow(html: string, title: string): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    console.warn('Print window was blocked by the browser.');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.document.title = title;
  printWindow.focus();
}

export function downloadAsHTML(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitiseFilename(filename)}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Wait for webfonts and images so nothing is captured half-loaded. */
async function waitForAssets(root: HTMLElement): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts) {
    try {
      await Promise.all([
        fonts.load('700 24px "Noto Sans Bengali"'),
        fonts.load('400 12px "Noto Sans Bengali"'),
        fonts.load('700 19px "Inter"'),
      ]);
      await fonts.ready;
    } catch {
      /* font loading is best-effort — never block the download on it */
    }
  }

  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
    )
  );

  // One frame for layout to settle after fonts swap in.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
}

/**
 * Find a horizontal band of blank pixels near the intended cut so a page break
 * never slices through a line of text. Returns the ideal cut when the canvas is
 * tainted or no clean row exists.
 */
function findCleanCut(canvas: HTMLCanvasElement, idealY: number, searchPx: number): number {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return idealY;

  const top = Math.max(1, Math.floor(idealY - searchPx));
  const height = Math.max(1, Math.floor(idealY) - top);
  if (height < 2) return idealY;

  let data: Uint8ClampedArray;
  try {
    data = context.getImageData(0, top, canvas.width, height).data;
  } catch {
    return idealY; // cross-origin content tainted the canvas
  }

  const step = Math.max(1, Math.floor(canvas.width / 240)); // sample ~240 columns
  for (let row = height - 1; row >= 0; row--) {
    let blank = true;
    for (let x = 0; x < canvas.width; x += step) {
      const i = (row * canvas.width + x) * 4;
      // Anything materially darker than the paper counts as content.
      if (data[i] < 244 || data[i + 1] < 244 || data[i + 2] < 244) {
        blank = false;
        break;
      }
    }
    if (blank) return top + row;
  }
  return idealY;
}

/**
 * Render the document HTML to a paginated A4 PDF.
 * Content taller than one page is split across pages instead of being clipped.
 */
export async function downloadAsPDF(html: string, filename: string): Promise<void> {
  const host = document.createElement('div');
  host.innerHTML = html;
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '-10000px',
    width: `${CONTENT_WIDTH_MM}mm`,
    background: '#ffffff',
    zIndex: '-1',
  } satisfies Partial<CSSStyleDeclaration>);

  host.querySelector('.toolbar')?.remove();
  document.body.appendChild(host);

  try {
    const page = host.querySelector('.document') as HTMLElement | null;
    if (!page) throw new Error('Document root (.document) not found in generated HTML');

    // The PDF supplies the page margins, so strip the on-screen paper chrome.
    Object.assign(page.style, {
      width: `${CONTENT_WIDTH_MM}mm`,
      minHeight: '0',
      margin: '0',
      padding: '0',
      boxShadow: 'none',
      overflow: 'visible',
    } satisfies Partial<CSSStyleDeclaration>);

    await waitForAssets(host);

    let scale = 2;
    const estimatedHeight = page.scrollHeight * scale;
    if (estimatedHeight > MAX_CANVAS_HEIGHT_PX) {
      scale = Math.max(1, MAX_CANVAS_HEIGHT_PX / page.scrollHeight);
    }

    const canvas = await html2canvas(page, {
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: page.scrollWidth,
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pdf.setProperties({
      title: filename,
      subject: 'Hasnahena Foundation official document',
      author: 'Hasnahena Foundation',
      creator: 'hasnahenafoundation.com',
    });

    const pxPerMm = canvas.width / CONTENT_WIDTH_MM;
    const pageHeightPx = CONTENT_HEIGHT_MM * pxPerMm;
    const searchPx = pageHeightPx * 0.08; // look back up to 8% of a page for a blank row

    // Slice the tall canvas into page-sized strips.
    const slices: Array<{ top: number; height: number }> = [];
    let cursor = 0;
    while (cursor < canvas.height) {
      const remaining = canvas.height - cursor;
      if (remaining <= pageHeightPx + 2) {
        slices.push({ top: cursor, height: remaining });
        break;
      }
      const ideal = cursor + pageHeightPx;
      const cut = Math.max(cursor + pageHeightPx * 0.5, findCleanCut(canvas, ideal, searchPx));
      slices.push({ top: cursor, height: cut - cursor });
      cursor = cut;
    }

    const buffer = document.createElement('canvas');
    const bufferCtx = buffer.getContext('2d');
    if (!bufferCtx) throw new Error('Unable to acquire a 2D context for PDF pagination');

    slices.forEach((slice, index) => {
      buffer.width = canvas.width;
      buffer.height = Math.ceil(slice.height);
      bufferCtx.fillStyle = '#ffffff';
      bufferCtx.fillRect(0, 0, buffer.width, buffer.height);
      bufferCtx.drawImage(
        canvas,
        0, slice.top, canvas.width, slice.height,
        0, 0, canvas.width, slice.height
      );

      if (index > 0) pdf.addPage();
      pdf.addImage(
        buffer.toDataURL('image/jpeg', JPEG_QUALITY),
        'JPEG',
        A4.marginMm,
        A4.marginMm,
        CONTENT_WIDTH_MM,
        slice.height / pxPerMm,
        undefined,
        'FAST'
      );

      pdf.setFontSize(8);
      pdf.setTextColor(138, 152, 148);
      pdf.text(
        `${index + 1} / ${slices.length}`,
        A4.widthMm / 2,
        A4.heightMm - A4.marginMm + 2,
        { align: 'center' }
      );
    });

    pdf.save(`${sanitiseFilename(filename)}.pdf`);
  } finally {
    document.body.removeChild(host);
  }
}
