/**
 * Client-side image validation utilities
 */

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

/** Common accepted types for different upload scenarios */
export const UPLOAD_TYPES = {
  avatar: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  gallery: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
  settings: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml'],
} as const;

/** Common size limits in MB */
export const UPLOAD_SIZE_LIMITS = {
  avatar: 5,
  gallery: 10,
  favicon: 2,
  default: 5,
} as const;

/**
 * Validate image file before upload (works on both client and server)
 */
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

/**
 * Validate image dimensions
 */
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

/**
 * Complete image validation (type, size, and dimensions)
 */
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
 * Shrink a photo in the browser before it is uploaded.
 *
 * Why this exists
 * ---------------
 * Registration asks for four photographs, and the people filling it in are on
 * Android phones in Jessore. A modern phone camera writes 3–8 MB per shot, so a
 * complete honest submission is 12–32 MB — and the serverless platform in front
 * of this app rejects request bodies over 4.5 MB before any of our code runs.
 * The member sees a failure with no field to fix and no way to comply, because
 * the thing that is wrong is their camera, not their form.
 *
 * Downscaling to a 1600px long edge at quality 0.82 keeps an NID and a
 * signature perfectly legible (an NID is 8.6cm wide — 1600px is ~470dpi across
 * it) while landing each file around 200–500 KB.
 *
 * `createImageBitmap(..., { imageOrientation: 'from-image' })` is the important
 * detail: phone cameras record rotation in EXIF rather than in the pixels, and
 * drawing to a canvas discards EXIF. Without this, a portrait photo of an NID
 * is stored on its side and an approver has to tilt their head to read it.
 *
 * Never enlarges, and returns the original file whenever re-encoding did not
 * actually make it smaller — a 40 KB PNG signature should stay a 40 KB PNG.
 */
export async function downscaleImageFile(
  file: File,
  options: { maxEdge?: number; quality?: number } = {}
): Promise<File> {
  const { maxEdge = 1600, quality = 0.82 } = options;

  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return file;
  }
  // Vector and animated sources have nothing to gain and plenty to lose here.
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // A file the decoder refuses is a file the server would refuse too; let the
    // normal validation path report it rather than failing here.
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

    // JPEG has no alpha. Without this, a transparent PNG signature re-encodes
    // with a black background and the signature disappears into it.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (!blob || blob.size >= file.size) {
      return file;
    }

    const baseName = file.name.replace(/\.[^./\\]+$/, '') || 'upload';
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Create a preview URL for an image file
 */
export function createImagePreview(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * Revoke a preview URL to free memory
 */
export function revokeImagePreview(url: string): void {
  URL.revokeObjectURL(url);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get initials from name for avatar fallback
 */
export function getInitials(name: string): string {
  if (!name) return '?';

  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }

  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Generate a random color for avatar background
 */
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
