'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { uploadSettingsImage, extractPublicId, deleteImage } from '@/lib/cloudinary';
import { revalidatePath } from 'next/cache';
import { authorizeServerActionRoles } from '@/lib/server-auth';
import { validateImageFile, UPLOAD_TYPES, UPLOAD_SIZE_LIMITS } from '@/lib/image-utils';

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

/** Revalidate all settings-related paths */
function revalidateSettingsPaths() {
  revalidatePath('/');
  revalidatePath('/[locale]');
  revalidatePath('/[locale]/dashboard/admin/settings');
}

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

    const auth = await authorizeServerActionRoles(
      authToken,
      ['ADMIN', 'SUPER_ADMIN'],
      'Unauthorized. Only admins can upload settings images.'
    );
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    // Get file from form data
    const file = formData.get('image') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Validate file using shared utilities
    const maxSizeMB = imageType.includes('favicon') 
      ? UPLOAD_SIZE_LIMITS.favicon 
      : UPLOAD_SIZE_LIMITS.default;
    const validation = validateImageFile(file, {
      acceptedTypes: UPLOAD_TYPES.settings,
      maxSizeMB,
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
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

    revalidateSettingsPaths();

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

    const auth = await authorizeServerActionRoles(
      authToken,
      ['ADMIN', 'SUPER_ADMIN'],
      'Unauthorized. Only admins can delete settings images.'
    );
    if (!auth.ok) {
      return { success: false, error: auth.error };
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

    revalidateSettingsPaths();

    return { success: true };
  } catch (error) {
    console.error('Delete settings image error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete settings image',
    };
  }
}
