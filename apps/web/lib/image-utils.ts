/** Client-side image validation and compression. */

export interface ImageValidationOptions {
  maxSizeMB?: number;
  acceptedTypes?: readonly string[];
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Accepted types per upload scenario. Raster only — an SVG can carry script. */
export const UPLOAD_TYPES = {
  avatar: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  gallery: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
  settings: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
} as const;

/**
 * Size limits in MB, checked AFTER compression — so an oversize file is one the
 * compressor refused. Each must stay under the Server Action body limit
 * (image-uploads.test.ts), so that we, not the infrastructure, say no.
 */
export const UPLOAD_SIZE_LIMITS = {
  avatar: 4,
  gallery: 4,
  favicon: 2,
  default: 4,
} as const;

/** Validate an image file before upload (client and server). */
export function validateImageFile(
  file: File,
  options: ImageValidationOptions = {}
): ValidationResult {
  const {
    maxSizeMB = 10,
    acceptedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
  } = options;

  // Check file type
  if (!acceptedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Accepted types: ${acceptedTypes.map(t => t.split('/')[1]).join(', ')}`,
    };
  }

  // Check file size
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > maxSizeMB) {
    return {
      valid: false,
      error: `File size exceeds ${maxSizeMB}MB. Current size: ${sizeMB.toFixed(2)}MB`,
    };
  }

  return { valid: true };
}

/** Validate image dimensions. */
async function validateImageDimensions(
  file: File,
  options: ImageValidationOptions = {}
): Promise<ValidationResult> {
  const { minWidth, minHeight, maxWidth, maxHeight } = options;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      if (minWidth && img.width < minWidth) {
        resolve({
          valid: false,
          error: `Image width must be at least ${minWidth}px. Current: ${img.width}px`,
        });
        return;
      }

      if (minHeight && img.height < minHeight) {
        resolve({
          valid: false,
          error: `Image height must be at least ${minHeight}px. Current: ${img.height}px`,
        });
        return;
      }

      if (maxWidth && img.width > maxWidth) {
        resolve({
          valid: false,
          error: `Image width must not exceed ${maxWidth}px. Current: ${img.width}px`,
        });
        return;
      }

      if (maxHeight && img.height > maxHeight) {
        resolve({
          valid: false,
          error: `Image height must not exceed ${maxHeight}px. Current: ${img.height}px`,
        });
        return;
      }

      resolve({ valid: true });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({
        valid: false,
        error: 'Failed to load image',
      });
    };

    img.src = url;
  });
}

/** Complete image validation (type, size, dimensions). */
export async function validateImage(
  file: File,
  options: ImageValidationOptions = {}
): Promise<ValidationResult> {
  // First check type and size
  const basicValidation = validateImageFile(file, options);
  if (!basicValidation.valid) {
    return basicValidation;
  }

  // Then check dimensions if specified
  if (options.minWidth || options.minHeight || options.maxWidth || options.maxHeight) {
    return validateImageDimensions(file, options);
  }

  return { valid: true };
}

/**
 * How small each kind of image needs to be — a ceiling, never a target.
 * `alpha: true` encodes WebP to keep transparency (JPEG would put a white box
 * behind a logo); photographs go to JPEG. Sizes follow where each is drawn.
 */
export const IMAGE_PRESETS = {
  logo: { maxEdge: 800, quality: 0.9, alpha: true },
  favicon: { maxEdge: 512, quality: 0.9, alpha: true },
  hero: { maxEdge: 2000, quality: 0.82, alpha: false },
  partner: { maxEdge: 600, quality: 0.9, alpha: true },
  gallery: { maxEdge: 1600, quality: 0.82, alpha: false },
  avatar: { maxEdge: 800, quality: 0.85, alpha: false },
  document: { maxEdge: 1600, quality: 0.82, alpha: false },
} as const;

export type ImagePresetName = keyof typeof IMAGE_PRESETS;

export interface CompressOptions {
  maxEdge?: number;
  quality?: number;
  /** Keep transparency, encoding to WebP instead of flattening onto white. */
  alpha?: boolean;
}

/** Encoders every browser this platform targets can write. */
function canEncode(type: string): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL(type).startsWith(`data:${type}`);
}

/**
 * Shrink an image in the browser before upload. Phone photos (3-8 MB) exceed
 * the 4.5 MB platform cap and the Server Action cap. A 1600px long edge at
 * q0.82 keeps an NID legible (~470dpi). `imageOrientation: 'from-image'`
 * applies EXIF rotation, which a canvas otherwise drops. Never enlarges; returns
 * the original whenever re-encoding did not make it smaller.
 */
export async function compressImageFile(
  file: File,
  options: CompressOptions = {}
): Promise<File> {
  const { maxEdge = 1600, quality = 0.82, alpha = false } = options;

  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return file;
  }
  // Vectors and animations lose too much (an SVG stops being vector; a GIF loses frames).
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Let normal validation report an undecodable file.
    return file;
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // Keep alpha via WebP when asked; otherwise fill white first, or a
    // transparent PNG becomes JPEG on black.
    const keepAlpha = alpha && canEncode('image/webp');
    const mimeType = keepAlpha ? 'image/webp' : 'image/jpeg';
    if (!keepAlpha) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mimeType, quality);
    });
    // Larger than the source: keep the source, but only if it fits the ceiling.
    if (!blob || (blob.size >= file.size && scale === 1)) {
      return file;
    }

    const extension = keepAlpha ? 'webp' : 'jpg';
    const baseName = file.name.replace(/\.[^./\\]+$/, '') || 'upload';
    return new File([blob], `${baseName}.${extension}`, {
      type: mimeType,
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}

/** The registration path's compression: the document preset (NIDs are read). */
export async function downscaleImageFile(
  file: File,
  options: { maxEdge?: number; quality?: number } = {}
): Promise<File> {
  return compressImageFile(file, { ...IMAGE_PRESETS.document, ...options });
}

/** Create a preview URL for an image file. */
export function createImagePreview(file: File): string {
  return URL.createObjectURL(file);
}

/** Revoke a preview URL to free memory. */
export function revokeImagePreview(url: string): void {
  URL.revokeObjectURL(url);
}

/** Format file size for display. */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/** Initials for the avatar fallback. */
export function getInitials(name: string): string {
  if (!name) return '?';

  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }

  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** A deterministic colour for the avatar background. */
export function getAvatarColor(name: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-yellow-500',
    'bg-red-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-teal-500',
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}
