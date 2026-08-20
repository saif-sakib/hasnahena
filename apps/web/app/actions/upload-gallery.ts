'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { uploadGalleryImage, extractPublicId, deleteImage } from '@/lib/cloudinary';
import { revalidatePath, updateTag } from 'next/cache';
import { GALLERY_TAG } from '@/lib/public-content';
import { authorizeServerActionRoles } from '@/lib/server-auth';
import { validateImageFile, UPLOAD_TYPES, UPLOAD_SIZE_LIMITS } from '@/lib/image-utils';

interface UploadGalleryResult {
  success: boolean;
  galleryItem?: {
    id: string;
    imageUrl: string;
    captionEn: string | null;
    captionBn: string | null;
    date: string;
  };
  error?: string;
}

interface DeleteGalleryResult {
  success: boolean;
  error?: string;
}

/** Revalidate all gallery-related paths */
function revalidateGalleryPaths() {
  // WO-73: the homepage and /gallery both read through `getPublicGalleryItems`,
  // which is cached under this tag. Without the bust an admin uploads a photo,
  // sees nothing on the homepage, and uploads it again.
  // updateTag, not revalidateTag: this runs in a Server Action, where the
  // admin who just uploaded the image is the very next reader of the page.
  updateTag(GALLERY_TAG);
  revalidatePath('/gallery');
  revalidatePath('/[locale]/gallery');
  // Both staff dashboards render the same Content & Media screen.
  revalidatePath('/[locale]/dashboard/admin/content');
  revalidatePath('/[locale]/dashboard/worker/content');
}

/**
 * Upload gallery image server action.
 *
 * Staff, not admins. The gallery is a field worker's tool — they are the ones at
 * the distribution with a phone — and it is one of the two management screens a
 * worker was given. Nothing else on Content & Media is theirs: the public copy
 * and the brand assets go through `PUT /api/v1/settings`, which is admin-only,
 * and the screen hides those sections rather than letting them 403.
 */
export async function uploadGalleryAction(
  formData: FormData
): Promise<UploadGalleryResult> {
  try {
    const authTokenFromForm = formData.get('authToken');
    const cookieStore = await cookies();
    const authToken =
      (typeof authTokenFromForm === 'string' && authTokenFromForm.trim().length > 0
        ? authTokenFromForm.trim()
        : null) ?? cookieStore.get('auth-token')?.value;

    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    const auth = await authorizeServerActionRoles(
      authToken,
      ['ADMIN', 'SUPER_ADMIN', 'WORKER'],
      'Unauthorized. Only staff can upload gallery images.'
    );
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    // Get file from form data
    const file = formData.get('image') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Get captions and date
    const captionEn = formData.get('captionEn') as string | null;
    const captionBn = formData.get('captionBn') as string | null;
    const dateStr = formData.get('date') as string | null;

    // Validate file using shared utilities
    const validation = validateImageFile(file, {
      acceptedTypes: UPLOAD_TYPES.gallery,
      maxSizeMB: UPLOAD_SIZE_LIMITS.gallery,
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Upload to Cloudinary
    const uploadResult = await uploadGalleryImage(buffer);

    // Create gallery item in database
    const galleryItem = await prisma.galleryItem.create({
      data: {
        imageUrl: uploadResult.url,
        captionEn: captionEn || null,
        captionBn: captionBn || null,
        date: dateStr ? new Date(dateStr) : new Date(),
      },
    });

    revalidateGalleryPaths();

    return {
      success: true,
      galleryItem: {
        id: galleryItem.id,
        imageUrl: galleryItem.imageUrl,
        captionEn: galleryItem.captionEn,
        captionBn: galleryItem.captionBn,
        date: galleryItem.date.toISOString(),
      },
    };
  } catch (error) {
    console.error('Upload gallery error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload gallery image',
    };
  }
}

/**
 * Delete gallery item server action
 * Deletes from database and Cloudinary
 */
export async function deleteGalleryAction(
  id: string,
  authTokenFromClient?: string
): Promise<DeleteGalleryResult> {
  try {
    const cookieStore = await cookies();
    const authToken =
      (authTokenFromClient?.trim() ? authTokenFromClient.trim() : null) ??
      cookieStore.get('auth-token')?.value;

    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    const auth = await authorizeServerActionRoles(
      authToken,
      ['ADMIN', 'SUPER_ADMIN', 'WORKER'],
      'Unauthorized. Only staff can delete gallery images.'
    );
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    // Get gallery item
    const galleryItem = await prisma.galleryItem.findUnique({
      where: { id },
      select: { imageUrl: true },
    });

    if (!galleryItem) {
      return { success: false, error: 'Gallery item not found' };
    }

    // Delete from database first
    await prisma.galleryItem.delete({
      where: { id },
    });

    // Extract public ID and delete from Cloudinary (async, don't wait)
    const publicId = extractPublicId(galleryItem.imageUrl);
    if (publicId) {
      deleteImage(publicId).catch(error => {
        console.error('Failed to delete image from Cloudinary:', error);
      });
    }

    revalidateGalleryPaths();

    return { success: true };
  } catch (error) {
    console.error('Delete gallery error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete gallery item',
    };
  }
}

/**
 * Update gallery item with new image
 */
export async function updateGalleryImageAction(
  id: string,
  formData: FormData
): Promise<UploadGalleryResult> {
  try {
    const authTokenFromForm = formData.get('authToken');
    const cookieStore = await cookies();
    const authToken =
      (typeof authTokenFromForm === 'string' && authTokenFromForm.trim().length > 0
        ? authTokenFromForm.trim()
        : null) ?? cookieStore.get('auth-token')?.value;

    if(!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    const auth = await authorizeServerActionRoles(
      authToken,
      ['ADMIN', 'SUPER_ADMIN', 'WORKER'],
      'Unauthorized. Only staff can update gallery images.'
    );
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    // Get existing gallery item
    const existingItem = await prisma.galleryItem.findUnique({
      where: { id },
      select: { imageUrl: true },
    });

    if (!existingItem) {
      return { success: false, error: 'Gallery item not found' };
    }

    // Get file from form data
    const file = formData.get('image') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Get captions and date
    const captionEn = formData.get('captionEn') as string | null;
    const captionBn = formData.get('captionBn') as string | null;
    const dateStr = formData.get('date') as string | null;

    // Validate file using shared utilities
    const validation = validateImageFile(file, {
      acceptedTypes: UPLOAD_TYPES.gallery,
      maxSizeMB: UPLOAD_SIZE_LIMITS.gallery,
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Upload new image
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const uploadResult = await uploadGalleryImage(buffer);

    // Update database
    const updatedItem = await prisma.galleryItem.update({
      where: { id },
      data: {
        imageUrl: uploadResult.url,
        captionEn: captionEn || null,
        captionBn: captionBn || null,
        date: dateStr ? new Date(dateStr) : undefined,
      },
    });

    // Delete old image from Cloudinary (async)
    const oldPublicId = extractPublicId(existingItem.imageUrl);
    if (oldPublicId) {
      deleteImage(oldPublicId).catch(error => {
        console.error('Failed to delete old gallery image:', error);
      });
    }

    revalidateGalleryPaths();

    return {
      success: true,
      galleryItem: {
        id: updatedItem.id,
        imageUrl: updatedItem.imageUrl,
        captionEn: updatedItem.captionEn,
        captionBn: updatedItem.captionBn,
        date: updatedItem.date.toISOString(),
      },
    };
  } catch (error) {
    console.error('Update gallery error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update gallery item',
    };
  }
}
