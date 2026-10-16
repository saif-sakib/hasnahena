/** Document output; every entry point takes the same document model. */

import { saveBlob } from '@/lib/save-blob';

import { documentFilename } from './format';
import { renderHTML } from './render/html';
import { renderPDF } from './render/pdf';
import type { DocumentModel } from './types';

/** Open the document in a new tab with the browser print dialog available. */
export function printDocument(model: DocumentModel): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    console.warn('Print window was blocked by the browser.');
    return;
  }
  printWindow.document.write(renderHTML(model));
  printWindow.document.close();
  printWindow.document.title = `${model.title} · ${model.refValue}`;
  printWindow.focus();
}

/** Download as an A4 PDF via output('blob') + saveBlob, not jsPDF save(). */
export async function downloadDocumentPDF(model: DocumentModel): Promise<void> {
  const pdf = await renderPDF(model);
  saveBlob(pdf.output('blob'), `${documentFilename(model.filename)}.pdf`);
}

/** Download the standalone HTML — useful for emailing or archiving. */
export function downloadDocumentHTML(model: DocumentModel): void {
  saveBlob(
    new Blob([renderHTML(model)], { type: 'text/html;charset=utf-8' }),
    `${documentFilename(model.filename)}.html`
  );
}

export { renderHTML, renderPDF };
