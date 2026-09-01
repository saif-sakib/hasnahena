/**
 * Hand a Blob to the browser as a download, **in the task that is handling the
 * click**.
 *
 * Its own module, with no imports, deliberately. This used to live in
 * `lib/documents/export.ts` and be re-exported from the `@/lib/documents`
 * barrel — and `lib/document-files.ts` imported it from there to save a member's
 * NID scan. That barrel also re-exports `renderPDF`, which imports **jsPDF**, so
 * one named import for a fifteen-line function pulled a 400 kB PDF engine into
 * the approvals screen: `+44.3%` first-load JavaScript on a screen whose job is
 * to show a photograph, on the phones this platform is actually used on. The
 * bundle budget is what caught it (`scripts/assert-bundle-budget.mjs`).
 *
 * Every step below is deliberate, because the obvious version of this function
 * only works once per page load:
 *
 *   * The anchor is clicked synchronously. jsPDF's own `save()` defers its
 *     click by a `setTimeout(…, 0)`, which puts the download in a fresh task
 *     with no user activation attached to it. Chrome permits exactly **one**
 *     such download per page load and then requires the site's "Automatic
 *     downloads" permission — a permission nobody has granted and which, on
 *     Android, is refused with no prompt and no message. That is the whole of
 *     "the first receipt downloads and the second button does nothing until I
 *     reload": the second download was blocked, not broken.
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
