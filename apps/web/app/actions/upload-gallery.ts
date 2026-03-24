'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { verifyHs256Jwt } from '@/lib/jwt';
import { uploadGalleryImage, extractPublicId, deleteImage } from '@/lib/cloudinary';
import { revalidatePath } from 'next/cache';

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

/**
 * Upload gallery image server action
 * Only admins can upload to gallery
 */
export async function uploadGalleryAction(
  formData: FormData
): Promise<UploadGalleryResult> {
  try {
    const authTokenFromForm = formData.get('authToken');
    const cookieStore = cookies();
    const authToken =
      (typeof authTokenFromForm === 'string' && authTokenFromForm.trim().length > 0
        ? authTokenFromForm.trim()
        : null) ?? cookieStore.get('auth-token')?.value;

    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    // Verify token
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return { success: false, error: 'Server configuration error' };
    }

    let claims;
    try {
      claims = verifyHs256Jwt(authToken, secret);
    } catch (error) {
      return { success: false, error: 'Invalid authentication token' };
    }

    // Check if user is admin
    const role = String(claims.role ?? '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return { success: false, error: 'Unauthorized. Only admins can upload gallery images.' };
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

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return { success: false, error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.' };
    }

    // Validate file size (10MB max for gallery)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return { success: false, error: 'File too large. Maximum size is 10MB.' };
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

    // Revalidate gallery pages
    revalidatePath('/gallery');
    revalidatePath('/[locale]/gallery');
    revalidatePath('/[locale]/dashboard/admin/gallery');

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
    const cookieStore = cookies();
    const authToken =
      (authTokenFromClient?.trim() ? authTokenFromClient.trim() : null) ??
      cookieStore.get('auth-token')?.value;

    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    // Verify token
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return { success: false, error: 'Server configuration error' };
    }

    let claims;
    try {
      claims = verifyHs256Jwt(authToken, secret);
    } catch (error) {
      return { success: false, error: 'Invalid authentication token' };
    }

    // Check if user is admin
    const role = String(claims.role ?? '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return { success: false, error: 'Unauthorized. Only admins can delete gallery images.' };
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

    // Revalidate gallery pages
    revalidatePath('/gallery');
    revalidatePath('/[locale]/gallery');
    revalidatePath('/[locale]/dashboard/admin/gallery');

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
    const cookieStore = cookies();
    const authToken =
      (typeof authTokenFromForm === 'string' && authTokenFromForm.trim().length > 0
        ? authTokenFromForm.trim()
        : null) ?? cookieStore.get('auth-token')?.value;

    if(!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    // Verify token
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return { success: false, error: 'Server configuration error' };
    }

    let claims;
    try {
      claims = verifyHs256Jwt(authToken, secret);
    } catch (error) {
      return { success: false, error: 'Invalid authentication token' };
    }

    // Check if user is admin
    const role = String(claims.role ?? '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return { success: false, error: 'Unauthorized. Only admins can update gallery images.' };
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

    // Validate file
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return { success: false, error: 'Invalid file type.' };
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return { success: false, error: 'File too large. Maximum size is 10MB.' };
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

    // Revalidate
    revalidatePath('/gallery');
    revalidatePath('/[locale]/gallery');
    revalidatePath('/[locale]/dashboard/admin/gallery');

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
