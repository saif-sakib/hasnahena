'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { uploadSettingsImage, extractPublicId, deleteImage } from '@/lib/cloudinary';
import { revalidatePath, updateTag } from 'next/cache';
import { SYSTEM_CONFIG_TAG } from '@/lib/system-config';
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
  // WO-73: every public page reads branding through the cached
  // `getPublicSettings()`, so a new logo is invisible until this tag is busted.
  // updateTag, not revalidateTag: this runs in a Server Action, where the
  // admin who just uploaded the image is the very next reader of the page.
  updateTag(SYSTEM_CONFIG_TAG);
  revalidatePath('/');
  revalidatePath('/[locale]');
  // The brand images moved to Content & Media when Settings stopped being two
  // screens in one, and both staff dashboards render that screen.
  revalidatePath('/[locale]/dashboard/admin/content');
  revalidatePath('/[locale]/dashboard/worker/content');
}

/**
 * Upload settings image server action.
 *
 * Staff, not admins. These are the brand and hero images on Content & Media,
 * which a worker edits — see the note on that screen. The money and policy rows
 * are a different list and a different screen, and `PUT /api/v1/settings`
 * refuses a worker who names one.
 */
export async function uploadSettingsImageAction(
  imageType: SettingImageType,
  formData: FormData
): Promise<UploadSettingsImageResult> {
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

    // Validate file using shared utilities.
    //
    // The browser has already compressed to the matching preset in
    // IMAGE_PRESETS, so anything still over these limits is a file
    // `compressImageFile` declined to touch. Kept as a server-side check
    // regardless: a Server Action is a public endpoint and cannot trust that its
    // own form ran.
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

    // Delete the old image — but only when it is genuinely a different asset.
    //
    // Since WO-97 a settings image is uploaded to a *fixed* public id derived
    // from its key, with `overwrite`, so replacing one is an overwrite and there
    // is nothing left behind to remove. Without this guard the delete below
    // would name the id we have just written and destroy the new image seconds
    // after storing its URL — a setting pointing at a 404, with the upload
    // reported as successful.
    //
    // The comparison is still worth making rather than dropping the delete
    // entirely: rows written before that change hold URLs with random ids, and
    // those assets do need removing the first time each one is replaced.
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

/**
 * Delete settings image
 */
export async function deleteSettingsImageAction(
  imageType: SettingImageType,
  authTokenFromClient?: string
): Promise<{ success: boolean; error?: string }> {
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

    // Blank the value; do not delete the row.
    //
    // "No image" and "no such setting" are different states, and only one of
    // them is true here. Deleting the row also disagreed with the other way this
    // value gets cleared: pressing Save on Content & Media posts `''` for a
    // cleared field, which upserts the row back — so Remove and Save left the
    // database in two different shapes for one outcome. Blank is the shape the
    // seed writes for an unset image and the shape every reader already handles.
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
