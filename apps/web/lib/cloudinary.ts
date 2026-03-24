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
}

export interface UploadResult {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
}

function ensureCloudinaryConfigured() {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
  }
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
        {
          folder: `hasnahena/${folder}`,
          resource_type: options.resource_type || 'image',
          transformation: options.transformation,
          format: options.format,
          quality: options.quality || 'auto',
          fetch_format: 'auto',
          ...options,
        },
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
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image to Cloudinary');
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
    return result.result === 'ok';
  } catch (error) {
    console.error('Cloudinary delete error:', error);
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
    const normalizedPath = uploadPath.replace(/^v\d+\//, '');
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

export function isCloudinaryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('res.cloudinary.com');
  } catch {
    return false;
  }
}

/**
 * Upload avatar with face detection and cropping
 * @param fileBuffer File buffer
 * @param userId User ID
 * @param role User role (admin, worker, member)
 */
export async function uploadAvatar(
  fileBuffer: Buffer,
  userId: string,
  role: string
): Promise<UploadResult> {
  return uploadImage(fileBuffer, `profiles/${role}/${userId}`, {
    transformation: [
      { width: 400, height: 400, crop: 'fill', gravity: 'face' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
    format: 'jpg',
  });
}

/**
 * Upload gallery image with optimization
 * @param fileBuffer File buffer
 */
export async function uploadGalleryImage(
  fileBuffer: Buffer
): Promise<UploadResult> {
  return uploadImage(fileBuffer, 'gallery', {
    transformation: [
      { width: 1200, crop: 'limit' },
      { quality: 'auto:good', fetch_format: 'auto' },
    ],
  });
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
  const folder = imageType.includes('partner')
    ? 'settings/partners'
    : imageType.includes('logo')
    ? 'settings/logo'
    : imageType.includes('hero')
    ? 'settings/hero'
    : 'settings/icons';

  return uploadImage(fileBuffer, folder, {
    transformation: [
      { quality: 'auto:best', fetch_format: 'auto' },
    ],
  });
}

/**
 * Delete old avatar when uploading a new one
 * @param oldAvatarUrl The old avatar URL to delete
 */
export async function deleteOldAvatar(oldAvatarUrl: string | null): Promise<boolean> {
  if (!oldAvatarUrl) return true;

  if (!isCloudinaryUrl(oldAvatarUrl)) return true;

  const publicId = extractPublicId(oldAvatarUrl);
  if (!publicId) return false;

  return deleteImage(publicId);
}

export default cloudinary;
