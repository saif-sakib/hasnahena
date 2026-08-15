/**
 * Document output. Every entry point takes a document model, so the printed,
 * saved, and downloaded copies are always the same document.
 */

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

const save = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/** Download the document as a paginated, text-selectable A4 PDF. */
export async function downloadDocumentPDF(model: DocumentModel): Promise<void> {
  const pdf = await renderPDF(model);
  pdf.save(`${documentFilename(model.filename)}.pdf`);
}

/** Download the standalone HTML — useful for emailing or archiving. */
export function downloadDocumentHTML(model: DocumentModel): void {
  save(
    new Blob([renderHTML(model)], { type: 'text/html;charset=utf-8' }),
    `${documentFilename(model.filename)}.html`
  );
}

export { renderHTML, renderPDF };
