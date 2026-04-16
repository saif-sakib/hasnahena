const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:$|\?)/i;

function parseFilenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;

  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1]).trim();
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return null;
}

export function isImageDocument(url: string, mimeType?: string): boolean {
  const normalizedMime = (mimeType || '').toLowerCase();
  if (normalizedMime.startsWith('image/')) {
    return true;
  }
  return IMAGE_FILE_PATTERN.test(url);
}

export function guessFileNameFromUrl(url: string, fallback = 'document'): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = pathname[pathname.length - 1];
    if (!lastSegment) return fallback;

    const decoded = decodeURIComponent(lastSegment);
    return decoded || fallback;
  } catch {
    return fallback;
  }
}

export async function downloadDocumentFile(url: string, preferredFileName?: string): Promise<void> {
  const response = await fetch(url, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch document');
  }

  const blob = await response.blob();
  const headerFileName = parseFilenameFromContentDisposition(response.headers.get('content-disposition'));
  const fileName = (
    preferredFileName?.trim()
    || headerFileName
    || guessFileNameFromUrl(url, 'document')
  );

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

