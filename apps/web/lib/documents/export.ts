/** Document output; every entry point takes the same document model. */

import { saveBlob } from '@/lib/save-blob';

import { documentFilename } from './format';
import { renderHTML } from './render/html';
import { renderPDF } from './render/pdf';
import type { DocumentModel } from './types';

/** Download as an A4 PDF via output('blob') + saveBlob, not jsPDF save(). */
export async function downloadDocumentPDF(model: DocumentModel): Promise<void> {
  const pdf = await renderPDF(model);
  saveBlob(pdf.output('blob'), `${documentFilename(model.filename)}.pdf`);
}

export { renderHTML, renderPDF };
