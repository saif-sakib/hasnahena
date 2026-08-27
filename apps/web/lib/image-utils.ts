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

/**
 * Common accepted types for different upload scenarios.
 *
 * `settings` used to list `image/svg+xml` and the uploader on Content & Media
 * never offered it — `ImageUpload`'s own default excluded SVG, so the server
 * accepted a format no admin could select. The two agree now, at raster, and
 * that is the safe direction to have resolved it: an SVG is a document that can
 * carry script, and it is the one format `compressImageFile` must refuse to
 * touch because rasterising a vector destroys it.
 */
export const UPLOAD_TYPES = {
  avatar: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  gallery: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
  settings: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
} as const;

/**
 * Common size limits in MB, checked **after** the browser has compressed.
 *
 * These are deliberately not the sizes a phone camera produces. Every uploader
 * runs `compressImageFile` first, so a 6 MB photograph reaches this check at
 * roughly 300 KB — and a file that is still over the limit afterwards is one
 * the compressor refused (an animated GIF, a file the decoder could not read),
 * which is exactly when a member should be told the size rather than have it
 * silently fixed.
 *
 * **None of them may exceed the Server Action body limit**, and that is why they
 * came down: `avatar` and `default` were 5 MB and `gallery` was 10, against a
 * framework cap of 1 MB and a hosting-platform cap of 4.5 MB. A file in the gap
 * was refused by infrastructure rather than by this check, so the uploader
 * reported a failure that named no size, no field and no remedy — the thing that
 * has to be true is that *we* are the ones who say no. `image-uploads.test.ts`
 * compares the two numbers so they cannot drift apart again.
 */
export const UPLOAD_SIZE_LIMITS = {
  avatar: 4,
  gallery: 4,
  favicon: 2,
  default: 4,
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
 * How small each kind of image needs to be, and why.
 *
 * Every upload in this application now goes through one of these. A preset is a
 * *ceiling*, not a target: `compressImageFile` never enlarges, and returns the
 * original file untouched whenever re-encoding failed to make it smaller.
 *
 * `alpha: true` is the half that is easy to get wrong. A logo, a favicon and a
 * partner mark are transparent PNGs, and JPEG has no alpha — flattening one onto
 * white puts a white rectangle behind the leaf on every coloured header it sits
 * in. Those presets encode to WebP, which keeps the transparency and is still
 * three to five times smaller than the PNG. Photographs have no alpha to lose
 * and go to JPEG, which is smaller again for a photograph.
 *
 * The numbers come from where each image is actually drawn:
 *
 *   logo         renders at most 96 CSS px tall in the header; 800px on the long
 *                edge is a 4x device-pixel-ratio reserve and then some
 *   favicon      the largest size a browser or an Android home screen asks for
 *   hero         full-bleed background on a desktop viewport
 *   partner      a small mark in a row of three
 *   gallery      opened full-screen on a phone, so more generous
 *   avatar       Cloudinary crops this to 400x400 anyway (AVATAR_TRANSFORMATION)
 *   document     an NID must stay legible — see the registration note below
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
 * Shrink an image in the browser before it is uploaded.
 *
 * Why this exists
 * ---------------
 * Registration asks for four photographs, and the people filling it in are on
 * Android phones in Jessore. A modern phone camera writes 3-8 MB per shot, so a
 * complete honest submission is 12-32 MB — and the serverless platform in front
 * of this app rejects request bodies over 4.5 MB before any of our code runs.
 * The member sees a failure with no field to fix and no way to comply, because
 * the thing that is wrong is their camera, not their form.
 *
 * The **Server Actions** in `app/actions/` have a tighter limit again, and that
 * one is ours: Next caps a Server Action body at 1 MB by default. Content &
 * Media validated brand images up to 5 MB and sent them uncompressed, so every
 * logo an admin picked off a phone or exported from Canva was refused by the
 * framework before `uploadSettingsImageAction` was entered — an upload that
 * failed with no message naming a size. `next.config.js` now raises that ceiling
 * *and* every uploader compresses first, because the limit is a backstop and the
 * compression is the fix.
 *
 * Downscaling to a 1600px long edge at quality 0.82 keeps an NID and a
 * signature perfectly legible (an NID is 8.6cm wide — 1600px is ~470dpi across
 * it) while landing each file around 200-500 KB.
 *
 * `createImageBitmap(..., { imageOrientation: 'from-image' })` is the important
 * detail: phone cameras record rotation in EXIF rather than in the pixels, and
 * drawing to a canvas discards EXIF. Without this, a portrait photo of an NID
 * is stored on its side and an approver has to tilt their head to read it.
 *
 * Never enlarges, and returns the original file whenever re-encoding did not
 * actually make it smaller — a 40 KB PNG signature should stay a 40 KB PNG.
 */
export async function compressImageFile(
  file: File,
  options: CompressOptions = {}
): Promise<File> {
  const { maxEdge = 1600, quality = 0.82, alpha = false } = options;

  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return file;
  }
  // Vector and animated sources have nothing to gain and plenty to lose here.
  // An SVG re-encoded to a raster is no longer a vector; a GIF loses its frames.
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

    // WebP carries alpha; JPEG does not. Where the caller asked to keep
    // transparency and the browser can write WebP, nothing is painted behind the
    // image. Otherwise the canvas is filled white first — without that, a
    // transparent PNG signature re-encodes to JPEG with a *black* background and
    // the signature disappears into it.
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
    // Bigger than what we started with means the source was already better
    // compressed than anything we can produce. Keep it — but only if it also
    // fits the ceiling we were asked for, otherwise a 20 MB PNG would sail
    // through on the grounds that our WebP of it was larger still.
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

/**
 * The registration path's compression, unchanged.
 *
 * Kept as its own name because four call sites and two documents' worth of
 * commentary refer to it, and because its defaults are the *document* preset:
 * an NID scan is the one image here that is read rather than looked at.
 */
export async function downscaleImageFile(
  file: File,
  options: { maxEdge?: number; quality?: number } = {}
): Promise<File> {
  return compressImageFile(file, { ...IMAGE_PRESETS.document, ...options });
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
