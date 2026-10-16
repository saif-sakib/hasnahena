/**
 * Hand a Blob to the browser as a download, IN THE CLICK'S TASK. No imports on
 * purpose — the documents barrel pulls in jsPDF (+44% first load).
 *   - Click synchronously: a deferred click has no user activation, and Chrome
 *     then blocks every download after the first (silently on Android).
 *   - Revoke the object URL on a later turn, or slow phones get a truncated file.
 * Awaiting cached data first is fine; a fresh network round trip is not.
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
