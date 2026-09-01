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

/**
 * Hand a Blob to the browser as a download, **in the task that is handling the
 * click**.
 *
 * Every step here is deliberate, because the obvious version of this function
 * only works once per page load:
 *
 *   * The anchor is clicked synchronously. jsPDF's own `save()` defers its
 *     click by a `setTimeout(…, 0)`, which puts the download in a fresh task
 *     with no user activation attached to it. Chrome permits exactly **one**
 *     such download per page load and then requires the site's "Automatic
 *     downloads" permission for the rest — a permission nobody has granted and
 *     which, on Android, is refused with no prompt and no message. That is the
 *     whole of "the first receipt downloads and the second button does
 *     nothing until I reload": the second download was blocked, not broken.
 *   * The object URL is revoked on a later turn, not immediately. Revoking it
 *     in the same task can race the browser's own fetch of the blob, which
 *     shows up as an empty or truncated file on slower phones.
 *
 * The gesture must therefore still be live when this is called. Awaiting a
 * cached settings read or an already-loaded logo is fine — activation survives
 * microtasks and five seconds of real time — but a fresh network round trip
 * before this point is not.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Download the document as a paginated, text-selectable A4 PDF.
 *
 * `output('blob')` rather than jsPDF's `save()` — see `saveBlob` for why the
 * difference decides whether the button works a second time.
 */
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
