import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export interface UploadOptions {
  folder?: string;
  transformation?: any;
  resource_type?: 'image' | 'video' | 'raw' | 'auto';
  format?: string;
  quality?: string | number;
  useFilename?: boolean;
  uniqueFilename?: boolean;
  overwrite?: boolean;
  preserveOriginal?: boolean;
  /** Fixed name within the folder, so a replacement overwrites rather than orphans. */
  publicId?: string;
  /** Purge the CDN copy when overwriting an existing public id. */
  invalidate?: boolean;
}

export interface UploadResult {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
}

/** Missing credentials — a config problem, not an upload failure (WO-63). */
export class CloudinaryConfigurationError extends Error {
  constructor(missing: string[]) {
    super(`Cloudinary is not configured. Set ${missing.join(', ')}.`);
    this.name = 'CloudinaryConfigurationError';
  }
}

/** A test run tried to upload to the real image host. */
export class CloudinaryTestTargetError extends Error {
  constructor() {
    super(
      'Refusing to upload from a test run: TEST_DATABASE_URL is set, so this process is ' +
        'serving a test stack, and this Cloudinary account holds real members\' NID scans. ' +
        'Set ALLOW_TEST_IMAGE_UPLOADS=yes only with credentials for a disposable cloud.',
    );
    this.name = 'CloudinaryTestTargetError';
  }
}

/**
 * Refuse uploads from a test stack: the database has a test double, the image
 * host does not. TEST_DATABASE_URL marks the test rig; ALLOW_TEST_IMAGE_UPLOADS=yes
 * only with a disposable cloud. Unreachable in production.
 */
function ensureUploadTargetIsDisposable() {
  if (!process.env.TEST_DATABASE_URL) return;
  if (process.env.ALLOW_TEST_IMAGE_UPLOADS === 'yes') return;
  throw new CloudinaryTestTargetError();
}

function ensureCloudinaryConfigured() {
  const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter(
    (key) => !process.env[key],
  );
  if (missing.length > 0) {
    throw new CloudinaryConfigurationError(missing);
  }
}

/**
 * The options one upload is sent with. `preserveOriginal` keeps registration
 * documents from being re-encoded.
 */
export function buildUploadOptions(folder: string, options: UploadOptions = {}): Record<string, unknown> {
  const uploadOptions: Record<string, unknown> = {
    folder: `hasnahena/${folder}`,
    resource_type: options.resource_type || 'image',
    transformation: options.transformation,
    format: options.format,
    use_filename: options.useFilename,
    unique_filename: options.uniqueFilename,
    overwrite: options.overwrite,
    public_id: options.publicId,
    invalidate: options.invalidate,
  };
  if (!options.preserveOriginal) {
    uploadOptions.quality = options.quality || 'auto';
    uploadOptions.fetch_format = 'auto';
  }
  return uploadOptions;
}

/** Square, cropped to the face — see uploadAvatar. */
export const AVATAR_TRANSFORMATION = [
  { width: 400, height: 400, crop: 'fill', gravity: 'face' },
  { quality: 'auto', fetch_format: 'auto' },
] as const;

/** Which settings folder an image belongs in. */
export function settingsImageFolder(imageType: string): string {
  if (imageType.includes('partner')) return 'settings/partners';
  if (imageType.includes('logo')) return 'settings/logo';
  if (imageType.includes('hero')) return 'settings/hero';
  return 'settings/icons';
}

/**
 * Stored size ceiling for each brand image, enforced server-side whatever the
 * client sent. `crop: 'limit'` never enlarges. No `format`, so transparency survives.
 */
export function settingsImageTransformation(imageType: string): Record<string, unknown>[] {
  if (imageType.includes('favicon')) {
    return [
      // Padded to a transparent 512 square, so any logo shape becomes a valid favicon.
      { width: 512, height: 512, crop: 'pad', background: 'transparent' },
      { quality: 'auto:good', fetch_format: 'auto' },
    ];
  }
  if (imageType.includes('partner')) {
    return [
      { width: 600, height: 600, crop: 'limit' },
      { quality: 'auto:good', fetch_format: 'auto' },
    ];
  }
  if (imageType.includes('logo')) {
    return [
      { width: 800, height: 800, crop: 'limit' },
      // `auto:best` for the logo alone: small, on every page.
      { quality: 'auto:best', fetch_format: 'auto' },
    ];
  }
  if (imageType.includes('hero')) {
    return [
      { width: 2000, height: 2000, crop: 'limit' },
      { quality: 'auto:good', fetch_format: 'auto' },
    ];
  }
  return [{ quality: 'auto:good', fetch_format: 'auto' }];
}

/**
 * One asset per settings key at a readable fixed name, so re-uploading
 * overwrites (nothing orphaned) and the tree migrates as a plain copy.
 */
export function settingsImagePublicId(imageType: string): string {
  return imageType.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
}

/** Universal image upload to Cloudinary. */
export async function uploadImage(
  fileBuffer: Buffer,
  folder: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  try {
    ensureUploadTargetIsDisposable();
    ensureCloudinaryConfigured();
    const result = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        buildUploadOptions(folder, options),
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      uploadStream.end(fileBuffer);
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
    };
  } catch (error) {
    if (error instanceof CloudinaryConfigurationError) throw error;
    if (error instanceof CloudinaryTestTargetError) throw error;
    console.error('Cloudinary upload error:', error);
    // `cause` keeps what Cloudinary actually said.
    throw new Error('Failed to upload image to Cloudinary', { cause: error });
  }
}

/** Delete an image by public ID. */
export async function deleteImage(publicId: string): Promise<boolean> {
  try {
    ensureCloudinaryConfigured();
    const result = await cloudinary.uploader.destroy(publicId);
    if (result.result !== 'ok') {
      // Callers ignore the boolean; "not found" usually means a wrongly derived id.
      console.warn(`Cloudinary did not delete ${publicId}: ${result.result}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`Cloudinary delete error for ${publicId}:`, error);
    return false;
  }
}

/** Extract the public ID from a Cloudinary URL. */
export function extractPublicId(url: string): string | null {
  try {
    if (!isCloudinaryUrl(url)) {
      return null;
    }

    const parsed = new URL(url);
    const pathWithoutQuery = parsed.pathname;
    const uploadMarker = '/upload/';
    const uploadIndex = pathWithoutQuery.indexOf(uploadMarker);
    if (uploadIndex === -1) {
      return null;
    }

    const uploadPath = pathWithoutQuery.slice(uploadIndex + uploadMarker.length);

    // Strip every delivery segment between `/upload/` and the id: chained
    // transformations (`w_400,h_400`, `t_preset`) and one version (`v123`).
    // Stripping only the version left ids that named nothing (WO-63). Everything
    // is uploaded under `hasnahena/`, so a folder like `id_cards` is never ambiguous.
    const isTransformation = (segment: string) =>
      segment.includes(',') || /^[a-z]{1,3}_[^/]*$/.test(segment);
    const isVersion = (segment: string) => /^v\d+$/.test(segment);

    const segments = uploadPath.split('/');
    while (segments.length > 1 && isTransformation(segments[0])) segments.shift();
    if (segments.length > 1 && isVersion(segments[0])) segments.shift();

    const normalizedPath = segments.join('/');
    const lastDotIndex = normalizedPath.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return normalizedPath;
    }

    return normalizedPath.slice(0, lastDotIndex);
  } catch (error) {
    console.error('Error extracting public ID:', error);
    return null;
  }
}

function isCloudinaryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('res.cloudinary.com');
  } catch {
    return false;
  }
}

/**
 * One folder per PERSON, named by account number (ADR-023):
 * `hasnahena/people/ACC-KH-33001/avatar`. Not per role, so a member hired as
 * staff keeps their files. Registration documents go in applicationFolder.
 */
export function personFolder(accountNo: string | null | undefined, fallbackId: string): string {
  const slug = (accountNo ?? '').trim();
  return `people/${slug || fallbackId}`;
}

/**
 * `applications/APP-2026-000001` — the four registration documents, named by
 * application number (an applicant has no account number). One prefix per
 * application, so a refusal deletes the whole set (ADR-038, ADR-040).
 */
export function applicationFolder(
  formNumber: string | null | undefined,
  fallbackId: string,
): string {
  const slug = (formNumber ?? '').trim();
  return `applications/${slug || fallbackId}`;
}

/** Upload an avatar, face-cropped, at a fixed id so a replacement overwrites. */
export async function uploadAvatar(
  fileBuffer: Buffer,
  accountNo: string | null | undefined,
  fallbackId: string
): Promise<UploadResult> {
  return uploadImage(fileBuffer, personFolder(accountNo, fallbackId), {
    transformation: AVATAR_TRANSFORMATION,
    format: 'jpg',
    publicId: 'avatar',
    overwrite: true,
    invalidate: true,
    uniqueFilename: false,
    useFilename: false,
  });
}

/** Upload a gallery image with optimisation. */
export async function uploadGalleryImage(
  fileBuffer: Buffer,
  takenOn?: Date
): Promise<UploadResult> {
  // Dated name (`gallery/2026-08-27-k3f9x2`), so the folder reads as a timeline.
  const day = (takenOn ?? new Date()).toISOString().slice(0, 10);
  const suffix = Math.random().toString(36).slice(2, 8);
  return uploadImage(fileBuffer, 'gallery', {
    publicId: `${day}-${suffix}`,
    uniqueFilename: false,
    useFilename: false,
    transformation: [
      // Height too, or portraits are stored at full height.
      { width: 1600, height: 1600, crop: 'limit' },
      { quality: 'auto:good', fetch_format: 'auto' },
    ],
  });
}

/**
 * Delete everything under a folder, and the folder itself — by prefix, because
 * the documents table does not know about orphaned uploads. Returns the count,
 * or null on failure (null ≠ 0). Not paginated: folders hold ≤ 5 assets.
 */
export async function deleteFolder(folder: string): Promise<number | null> {
  const prefix = `hasnahena/${folder}`;
  try {
    ensureCloudinaryConfigured();
    const result = (await cloudinary.api.delete_resources_by_prefix(prefix)) as {
      deleted?: Record<string, string>;
    };
    const deleted = Object.values(result.deleted ?? {}).filter((v) => v === 'deleted').length;
    // The empty folder name is itself a record of who applied.
    try {
      await cloudinary.api.delete_folder(prefix);
    } catch {
      // Cosmetic, and throws routinely when already gone.
    }
    return deleted;
  } catch (error) {
    console.error(`Cloudinary prefix delete failed for ${prefix}:`, error);
    return null;
  }
}

/**
 * Move one asset to a new public id without re-encoding (the bytes keep
 * `preserveOriginal`). Overwrite is on — only an earlier attempt can be there.
 * Returns the new URL, or null when nothing moved (a missing source is null).
 */
export async function moveAsset(fromPublicId: string, toPublicId: string): Promise<string | null> {
  if (fromPublicId === toPublicId) return null;
  try {
    ensureCloudinaryConfigured();
    const result = (await cloudinary.uploader.rename(fromPublicId, toPublicId, {
      overwrite: true,
      invalidate: true,
    })) as { secure_url?: string };
    await placeInAssetFolder(toPublicId);
    return result.secure_url ?? null;
  } catch (error) {
    console.error(`Cloudinary rename failed for ${fromPublicId} -> ${toPublicId}:`, error);
    return null;
  }
}

/**
 * Second half of a move: this account uses dynamic folder mode, where
 * `asset_folder` is separate from `public_id` and rename only changes the
 * latter. Logged, not thrown — the URL is already right.
 * scripts/cloudinary-reconcile.mjs repairs anything left behind.
 */
async function placeInAssetFolder(publicId: string): Promise<void> {
  const cut = publicId.lastIndexOf('/');
  if (cut <= 0) return;
  const assetFolder = publicId.slice(0, cut);
  const displayName = publicId.slice(cut + 1);
  try {
    await cloudinary.api.update(publicId, {
      asset_folder: assetFolder,
      display_name: displayName,
    });
  } catch (error) {
    console.warn(
      `Cloudinary asset_folder update failed for ${publicId}; it is served correctly but ` +
        `still listed under its old folder. See scripts/cloudinary-reconcile.mjs.`,
      error,
    );
  }
}

/**
 * Delete a folder expected to be empty after a move. Never deletes resources:
 * if anything remains, it fails and leaves it alone.
 */
export async function deleteEmptyFolder(folder: string): Promise<void> {
  try {
    ensureCloudinaryConfigured();
    await cloudinary.api.delete_folder(`hasnahena/${folder}`);
  } catch {
    // Routine: the folder is gone already, or something is still in it.
  }
}

/** Upload a settings image (logo, hero, partner…). */
export async function uploadSettingsImage(
  fileBuffer: Buffer,
  imageType: string
): Promise<UploadResult> {
  return uploadImage(fileBuffer, settingsImageFolder(imageType), {
    transformation: settingsImageTransformation(imageType),
    publicId: settingsImagePublicId(imageType),
    overwrite: true,
    invalidate: true,
    uniqueFilename: false,
    useFilename: false,
  });
}

/** Delete the old avatar when uploading a new one. */
export async function deleteOldAvatar(oldAvatarUrl: string | null): Promise<boolean> {
  if (!oldAvatarUrl) return true;

  // Hosted elsewhere: nothing of ours to remove, so nothing failed.
  if (!isCloudinaryUrl(oldAvatarUrl)) return true;

  const publicId = extractPublicId(oldAvatarUrl);
  if (!publicId) {
    console.warn(`Could not derive a Cloudinary public id from ${oldAvatarUrl}; the old avatar was left in place.`);
    return false;
  }

  return deleteImage(publicId);
}

export default cloudinary;
