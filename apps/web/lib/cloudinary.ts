import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
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

/**
 * The credentials are missing, not the image host.
 *
 * A distinct type because the two are different problems with different people
 * to wake up: this one is an environment variable nobody set on Render or
 * Vercel, and it must not be reported as "failed to upload" (WO-63).
 */
export class CloudinaryConfigurationError extends Error {
  constructor(missing: string[]) {
    super(`Cloudinary is not configured. Set ${missing.join(', ')}.`);
    this.name = 'CloudinaryConfigurationError';
  }
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
 * The options one upload is sent with.
 *
 * Pure, and exported, because this is the decision that cannot be seen
 * afterwards: `preserveOriginal` is what stops a registration document being
 * re-encoded, and an NID scan silently uploaded with the wrong settings is
 * unrecoverable in the same way a wrong balance is.
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
 * The stored size ceiling for each brand image, applied at upload time.
 *
 * The browser compresses before sending (`IMAGE_PRESETS` in lib/image-utils.ts)
 * and this repeats the ceiling on the server, because the two are answering
 * different questions. The browser's job is to get the file *through* — under
 * the Server Action body cap, over a phone connection in Jessore. This one's job
 * is that what ends up **stored** is bounded no matter what path it arrived by,
 * including a future admin API or a re-upload from a desktop with a fast link.
 *
 * `crop: 'limit'` never enlarges: a 300px logo stays 300px. Together with
 * `fetch_format: 'auto'` the delivered bytes are then WebP or AVIF to whoever
 * can read them, which is most of the Android phones this is for.
 *
 * Transparency is preserved throughout. There is deliberately no `format` here —
 * naming one would flatten a transparent PNG logo onto whatever background
 * Cloudinary chose, which is the same mistake the browser-side compressor avoids
 * by encoding WebP rather than JPEG for the `alpha` presets.
 */
export function settingsImageTransformation(imageType: string): Record<string, unknown>[] {
  if (imageType.includes('favicon')) {
    return [
      // **Padded to a square, not limited to one.** A favicon is drawn in a
      // square box by every browser and every Android launcher, so a 3:1 lockup
      // handed to this field would otherwise be squashed or cropped by whoever
      // renders it — a different wrong answer per surface. `pad` centres
      // whatever shape it is given on a 512x512 canvas and fills the rest with
      // **transparency**, so a wide logo becomes a correct square favicon with
      // margins and a square one is unchanged. Asking an admin to prepare a
      // square file is asking them to own a problem the image host can solve.
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
      // `auto:best` for the logo alone. It is the one brand image rendered at a
      // known small size on every single page, so the bytes are cheap and the
      // artefacts around a leaf's edges are not.
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
 * One asset per settings key, at a name that says what it is.
 *
 * `hasnahena/settings/logo/branding-logo`, not
 * `hasnahena/settings/logo/kf3n8xqz9vbt2p`. Two reasons, and the second is the
 * one that was asked for:
 *
 *  - **Replacing is replacing.** With a random public id, every re-upload left
 *    the previous asset behind and relied on a delete that runs after the fact
 *    and whose result nobody reads. With a fixed id and `overwrite`, the new
 *    image *is* the old one; there is nothing to orphan. `invalidate` clears the
 *    CDN copy, and the version segment in the returned URL changes anyway, so a
 *    reader never sees a stale image.
 *  - **Migrating off Cloudinary stays a copy.** The asset tree is then a
 *    readable directory of this application's own vocabulary, so moving to a VPS
 *    is `rsync` plus a rewrite of the URL prefix in `system_config` — rather
 *    than a reconciliation between opaque ids and the rows that point at them.
 */
export function settingsImagePublicId(imageType: string): string {
  return imageType.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
}

/**
 * Universal image upload to Cloudinary
 * @param file File object or Buffer
 * @param folder Cloudinary folder path
 * @param options Additional upload options
 */
export async function uploadImage(
  fileBuffer: Buffer,
  folder: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  try {
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
    // A missing secret is not an upload failure, and saying so cost an
    // operator the difference between reading one environment variable and
    // opening a support ticket with an image host (WO-63).
    if (error instanceof CloudinaryConfigurationError) throw error;
    console.error('Cloudinary upload error:', error);
    // `cause` keeps the quota message, the rejected file type, the timeout —
    // whatever Cloudinary actually said — attached to the error the caller
    // logs, instead of replacing all of them with one sentence.
    throw new Error('Failed to upload image to Cloudinary', { cause: error });
  }
}

/**
 * Delete image from Cloudinary by public ID
 * @param publicId The public ID of the image to delete
 */
export async function deleteImage(publicId: string): Promise<boolean> {
  try {
    ensureCloudinaryConfigured();
    const result = await cloudinary.uploader.destroy(publicId);
    if (result.result !== 'ok') {
      // Every caller ignores this boolean, so the log line is the only record
      // that an asset was left behind. `not found` here usually means the
      // public id was derived wrongly, not that the file is already gone.
      console.warn(`Cloudinary did not delete ${publicId}: ${result.result}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`Cloudinary delete error for ${publicId}:`, error);
    return false;
  }
}

/**
 * Extract public ID from Cloudinary URL
 * @param url Cloudinary URL
 */
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

    // Everything between `/upload/` and the public id is delivery instruction:
    // any number of chained transformation segments (`w_400,h_400`, `q_auto`,
    // `t_named_preset`) and at most one version (`v1712345678`), in that order.
    // Stripping only the version left `w_400,h_400/v1712/hasnahena/...` as the
    // "public id" — an id that names nothing, so `destroy` reported not-found
    // and every replaced avatar stayed in the account forever (WO-63).
    //
    // A transformation parameter is one to three letters, an underscore and a
    // value; a chained set is comma-separated. A folder named `id_cards` would
    // be ambiguous by the same rule, which is why this application uploads
    // everything under `hasnahena/` — see buildUploadOptions.
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
 * Where one person's images live, and why it is their account number.
 *
 * The asset tree is the only description of this account that survives leaving
 * it. `hasnahena/profiles/super_admin/cmob97efh00003zynz0as5knq/bqs94z5ywwgjchofjrs1`
 * — a role, a cuid and a random string — names nothing a human can look up: to
 * find out whose avatar that is you have to query the database, and after a
 * migration off Cloudinary you would have to have kept the mapping. Two levels
 * of opacity, and neither bought anything.
 *
 * `hasnahena/people/ACC-KH-33001/avatar` is the same asset, named after the one
 * identifier this platform gives a person ([ADR-023](../../../docs/decisions.md)) —
 * the one printed on their passbook and read aloud at the counter. Migrating
 * becomes `rsync` plus a prefix rewrite, and an operator staring at a bucket can
 * tell what they are looking at.
 *
 * **One folder per person, not one per role.** A member who is later hired as a
 * field worker keeps their account number and their folder; keying on the role
 * would have moved their files and orphaned the URL already stored on the row.
 *
 * `accountNo` exists before any upload that uses this folder: staff get theirs
 * when the account is created, and a member gets theirs at **approval** — which
 * is also the first moment a member can have an avatar. The `id` fallback exists
 * only so a row that somehow has no account number still gets a file rather than
 * an exception; it is not the intent.
 *
 * **Registration documents do not go here** — see `applicationFolder`. They are
 * submitted before anybody is a member, and an applicant has no account number
 * to name a folder with.
 */
export function personFolder(accountNo: string | null | undefined, fallbackId: string): string {
  const slug = (accountNo ?? '').trim();
  return `people/${slug || fallbackId}`;
}

/**
 * Where the four registration documents live — `applications/APP-2026-000001`.
 *
 * A separate tree from `people/`, and deliberately so on both counts:
 *
 * **It is named after something the applicant has.** They have no account number
 * — that is issued when they are admitted, not when they apply — so the only
 * meaningful name available is their application's own number.
 *
 * **It is the unit that gets deleted.** An NID scan is the most damaging thing
 * this foundation holds, and a refused applicant's scans serve no purpose the
 * written decision does not serve better. One prefix per application means the
 * whole set goes in one call, including anything a half-finished upload left
 * behind, rather than one `destroy` per row that a `documents` table happens to
 * still know about.
 *
 * An approved member's documents stay here rather than being moved. They belong
 * to the application that was accepted, `documents.url` already points at them,
 * and a cross-system move at approval time is a failure mode bought for tidiness.
 */
export function applicationFolder(
  formNumber: string | null | undefined,
  fallbackId: string,
): string {
  const slug = (formNumber ?? '').trim();
  return `applications/${slug || fallbackId}`;
}

/**
 * Upload avatar with face detection and cropping.
 *
 * Fixed public id, so replacing a profile picture **overwrites** it. Before this
 * every change left the previous file behind and relied on a delete that runs
 * after the fact and whose result nobody reads — see `deleteOldAvatar`, whose
 * whole existence is that clean-up. There is nothing to clean up now.
 */
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

/**
 * Upload gallery image with optimization
 * @param fileBuffer File buffer
 */
export async function uploadGalleryImage(
  fileBuffer: Buffer,
  takenOn?: Date
): Promise<UploadResult> {
  // `gallery/2026-08-27-k3f9x2` rather than `gallery/xclzbnipijgrhorlgmil`.
  //
  // A gallery photograph has no identifier of its own before the row exists, so
  // unlike a person's files this cannot be named after something meaningful —
  // but it can at least be **ordered and dated**. Listing the folder then reads
  // as a timeline, which is what a gallery is, and a photo can be found from its
  // caption's date without a database. The suffix keeps two photographs from the
  // same distribution apart.
  const day = (takenOn ?? new Date()).toISOString().slice(0, 10);
  const suffix = Math.random().toString(36).slice(2, 8);
  return uploadImage(fileBuffer, 'gallery', {
    publicId: `${day}-${suffix}`,
    uniqueFilename: false,
    useFilename: false,
    transformation: [
      // Height as well as width. A width-only limit lets a portrait photo
      // through at its full height — a phone shooting 3024x4032 stored 1200x1600
      // where the grid draws it at 400px, which is the case this misses.
      { width: 1600, height: 1600, crop: 'limit' },
      { quality: 'auto:good', fetch_format: 'auto' },
    ],
  });
}

/**
 * Delete **everything** under one folder, and the folder itself.
 *
 * Why a prefix rather than a list of public ids: the `documents` table is a
 * record of what was *recorded*, not of what is *stored*. An upload that
 * succeeded and whose row insert then failed, a retry that wrote a second asset,
 * a file put there by hand — none of those are in the table, and all of them are
 * still served publicly by a URL that nobody has to guess. Erasure that only
 * deletes what the database remembers is erasure that leaves behind exactly the
 * assets nothing is tracking.
 *
 * Returns the number of assets Cloudinary reported deleting, or `null` when the
 * call itself failed. `null` and `0` mean different things and the caller has to
 * be able to tell them apart: nothing to delete is a success, and an unreachable
 * image host is a member's NID scan still online after they were told it was
 * gone.
 *
 * `delete_resources_by_prefix` caps at 1000 assets per call and this is used on
 * folders holding at most five, so it is not paginated. Say so here rather than
 * find out from a folder that half-emptied.
 */
export async function deleteFolder(folder: string): Promise<number | null> {
  const prefix = `hasnahena/${folder}`;
  try {
    ensureCloudinaryConfigured();
    const result = (await cloudinary.api.delete_resources_by_prefix(prefix)) as {
      deleted?: Record<string, string>;
    };
    const deleted = Object.values(result.deleted ?? {}).filter((v) => v === 'deleted').length;
    // The now-empty folder. Cloudinary keeps it listed otherwise, so the asset
    // tree slowly fills with the names of people whose files were erased — which
    // is itself a record of who applied and was refused.
    try {
      await cloudinary.api.delete_folder(prefix);
    } catch {
      // A folder that will not delete is cosmetic; the assets are what matter,
      // and this throws routinely when the folder was already gone.
    }
    return deleted;
  } catch (error) {
    console.error(`Cloudinary prefix delete failed for ${prefix}:`, error);
    return null;
  }
}

/**
 * Move one asset to a new public id, keeping the bytes.
 *
 * Cloudinary has no "move a folder": a public id *is* the path, so relocating
 * `applications/APP-2026-000001/nid-front` to `people/ACC-KH-33001/nid-front` is
 * a rename of each asset. It is a metadata operation — the stored image is not
 * re-encoded, which matters here because these are NID scans uploaded with
 * `preserveOriginal` and re-uploading them would undo that.
 *
 * `overwrite` is deliberately **on**. The destination is a fixed name inside one
 * person's folder, so the only thing that can already be there is an earlier
 * attempt at this same move; refusing would leave the pair half-migrated with no
 * way to finish. `invalidate` clears the CDN copy of whatever it replaced.
 *
 * Returns the new secure URL, or `null` when the move did not happen. The caller
 * must be able to tell those apart: writing a `documents.url` that points at a
 * public id Cloudinary never created is a broken image on the approvals screen
 * and, worse, a row that no longer names where the file actually is.
 *
 * A missing source is `null` and not an exception. This is called after an
 * approval and is safe to call again, so "already moved" and "was never there"
 * are both ordinary — the caller checks the URL it already holds before asking.
 */
export async function moveAsset(fromPublicId: string, toPublicId: string): Promise<string | null> {
  if (fromPublicId === toPublicId) return null;
  try {
    ensureCloudinaryConfigured();
    const result = (await cloudinary.uploader.rename(fromPublicId, toPublicId, {
      overwrite: true,
      invalidate: true,
    })) as { secure_url?: string };
    return result.secure_url ?? null;
  } catch (error) {
    console.error(`Cloudinary rename failed for ${fromPublicId} -> ${toPublicId}:`, error);
    return null;
  }
}

/**
 * Delete a folder that is expected to be empty, and say nothing if it is not.
 *
 * `deleteFolder` empties a folder as an act of erasure. This one is the tail of
 * a *move*: the assets are already somewhere else, and all that is left is the
 * directory entry, which Cloudinary keeps listing until it is told not to. An
 * asset tree that accumulates the application numbers of every member ever
 * admitted is a second, unmanaged record of who applied.
 *
 * Deliberately does **not** delete resources. If anything is still inside, this
 * fails and leaves it alone — the one outcome that must never happen here is a
 * half-finished move being finished by deleting the half that did not move.
 */
export async function deleteEmptyFolder(folder: string): Promise<void> {
  try {
    ensureCloudinaryConfigured();
    await cloudinary.api.delete_folder(`hasnahena/${folder}`);
  } catch {
    // Routine: the folder is gone already, or something is still in it.
  }
}

/**
 * Upload settings image (logo, hero, etc.)
 * @param fileBuffer File buffer
 * @param imageType Type of settings image (logo, hero, partner, etc.)
 */
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

/**
 * Delete old avatar when uploading a new one
 * @param oldAvatarUrl The old avatar URL to delete
 */
export async function deleteOldAvatar(oldAvatarUrl: string | null): Promise<boolean> {
  if (!oldAvatarUrl) return true;

  // Hosted elsewhere: nothing of ours to remove, so nothing failed.
  if (!isCloudinaryUrl(oldAvatarUrl)) return true;

  const publicId = extractPublicId(oldAvatarUrl);
  if (!publicId) {
    // Callers ignore the boolean, so without this the asset is orphaned with
    // no record of it anywhere — a leak with no evidence.
    console.warn(`Could not derive a Cloudinary public id from ${oldAvatarUrl}; the old avatar was left in place.`);
    return false;
  }

  return deleteImage(publicId);
}

export default cloudinary;
