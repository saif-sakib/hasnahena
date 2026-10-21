'use server';

import { prisma } from '@/lib/prisma';
import { uploadSettingsImage, extractPublicId, deleteImage } from '@/lib/cloudinary';
import { revalidatePath, updateTag } from 'next/cache';
import { SYSTEM_CONFIG_TAG } from '@/lib/system-config';
import { authorizeServerActionRoles, serverActionToken } from '@/lib/server-auth';
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
  // Public pages read branding through the cached getPublicSettings (WO-73).
  // updateTag (not revalidateTag): the uploader is the very next reader.
  updateTag(SYSTEM_CONFIG_TAG);
  revalidatePath('/');
  revalidatePath('/[locale]');
  revalidatePath('/[locale]/dashboard/admin/content');
  revalidatePath('/[locale]/dashboard/worker/content');
}

/**
 * Upload a settings image. Staff, not admins — brand images are on Content &
 * Media, which workers edit.
 */
export async function uploadSettingsImageAction(
  imageType: SettingImageType,
  formData: FormData
): Promise<UploadSettingsImageResult> {
  try {
    const authToken = await serverActionToken(formData.get('authToken'));

    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    const auth = await authorizeServerActionRoles(
      authToken,
      ['ADMIN', 'SUPER_ADMIN', 'WORKER'],
      'Unauthorized. Only staff can upload settings images.'
    );
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    // Get file from form data
    const file = formData.get('image') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Server-side check regardless of client compression: a Server Action is public.
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

    // Delete the old image only if it is a DIFFERENT asset: since WO-97 the id is
    // fixed and overwritten, so deleting it would destroy the new image. Older
    // rows still hold random ids.
    if (existingSetting?.value) {
      const oldPublicId = extractPublicId(existingSetting.value);
      if (oldPublicId && oldPublicId !== uploadResult.publicId) {
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

/** Delete a settings image. */
export async function deleteSettingsImageAction(
  imageType: SettingImageType,
  authTokenFromClient?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const authToken = await serverActionToken(authTokenFromClient);

    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    const auth = await authorizeServerActionRoles(
      authToken,
      ['ADMIN', 'SUPER_ADMIN', 'WORKER'],
      'Unauthorized. Only staff can delete settings images.'
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

    // Blank the value, keep the row — the same shape Save writes for a cleared field.
    await prisma.systemConfig.update({
      where: { key: imageType },
      data: { value: '' },
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
