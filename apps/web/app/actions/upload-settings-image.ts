'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { verifyHs256Jwt } from '@/lib/jwt';
import { uploadSettingsImage, extractPublicId, deleteImage } from '@/lib/cloudinary';
import { revalidatePath } from 'next/cache';

interface UploadSettingsImageResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

type SettingImageType =
  | 'branding.logo'
  | 'branding.dashboardLogo'
  | 'branding.favicon'
  | 'hero.backgroundImage'
  | 'hero.partnerLogo1'
  | 'hero.partnerLogo2'
  | 'hero.partnerLogo3';

/**
 * Upload settings image server action
 * Only admins can upload settings images
 */
export async function uploadSettingsImageAction(
  imageType: SettingImageType,
  formData: FormData
): Promise<UploadSettingsImageResult> {
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
      return { success: false, error: 'Unauthorized. Only admins can upload settings images.' };
    }

    // Get file from form data
    const file = formData.get('image') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      return { success: false, error: 'Invalid file type. Only JPEG, PNG, WebP, and SVG are allowed.' };
    }

    // Validate file size (different limits for different types)
    const maxSize = imageType.includes('favicon') ? 2 * 1024 * 1024 : 5 * 1024 * 1024; // 2MB for favicon, 5MB for others
    if (file.size > maxSize) {
      const maxSizeMB = maxSize / (1024 * 1024);
      return { success: false, error: `File too large. Maximum size is ${maxSizeMB}MB.` };
    }

    // Get existing setting to delete old image
    const existingSetting = await prisma.systemConfig.findUnique({
      where: { key: imageType },
      select: { value: true },
    });

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Upload to Cloudinary
    const uploadResult = await uploadSettingsImage(buffer, imageType);

    // Upsert setting in database
    await prisma.systemConfig.upsert({
      where: { key: imageType },
      update: { value: uploadResult.url },
      create: {
        key: imageType,
        value: uploadResult.url,
        description: `Image for ${imageType}`,
      },
    });

    // Delete old image from Cloudinary (async, don't wait)
    if (existingSetting?.value) {
      const oldPublicId = extractPublicId(existingSetting.value);
      if (oldPublicId) {
        deleteImage(oldPublicId).catch(error => {
          console.error('Failed to delete old settings image:', error);
        });
      }
    }

    // Revalidate pages that use these settings
    revalidatePath('/');
    revalidatePath('/[locale]');
    revalidatePath('/[locale]/dashboard/admin/settings');

    return {
      success: true,
      imageUrl: uploadResult.url,
    };
  } catch (error) {
    console.error('Upload settings image error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload settings image',
    };
  }
}

/**
 * Delete settings image
 */
export async function deleteSettingsImageAction(
  imageType: SettingImageType,
  authTokenFromClient?: string
): Promise<{ success: boolean; error?: string }> {
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
      return { success: false, error: 'Unauthorized. Only admins can delete settings images.' };
    }

    // Get existing setting
    const existingSetting = await prisma.systemConfig.findUnique({
      where: { key: imageType },
      select: { value: true },
    });

    if (!existingSetting) {
      return { success: false, error: 'Setting not found' };
    }

    // Delete from database
    await prisma.systemConfig.delete({
      where: { key: imageType },
    });

    // Delete from Cloudinary (async)
    const publicId = extractPublicId(existingSetting.value);
    if (publicId) {
      deleteImage(publicId).catch(error => {
        console.error('Failed to delete settings image from Cloudinary:', error);
      });
    }

    // Revalidate
    revalidatePath('/');
    revalidatePath('/[locale]');
    revalidatePath('/[locale]/dashboard/admin/settings');

    return { success: true };
  } catch (error) {
    console.error('Delete settings image error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete settings image',
    };
  }
}
