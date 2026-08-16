'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { uploadAvatar, deleteOldAvatar, extractPublicId, deleteImage } from '@/lib/cloudinary';
import { authenticateServerActionToken } from '@/lib/server-auth';
import { validateImageFile, UPLOAD_TYPES, UPLOAD_SIZE_LIMITS } from '@/lib/image-utils';

interface UploadAvatarResult {
  success: boolean;
  avatarUrl?: string;
  error?: string;
}

/**
 * Upload avatar server action
 * Authenticates user, uploads to Cloudinary, updates database, and deletes old avatar
 */
export async function uploadAvatarAction(
  formData: FormData
): Promise<UploadAvatarResult> {
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

    const auth = await authenticateServerActionToken(authToken);
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    const userId = auth.user.id;
    const userRole = (auth.user.role || 'member').toLowerCase();

    // Get file from form data
    const file = formData.get('avatar') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Validate file using shared utilities
    const validation = validateImageFile(file, {
      acceptedTypes: UPLOAD_TYPES.avatar,
      maxSizeMB: UPLOAD_SIZE_LIMITS.avatar,
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Get current user to delete old avatar
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    if (!currentUser) {
      return { success: false, error: 'User not found' };
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Upload to Cloudinary
    const uploadResult = await uploadAvatar(buffer, userId, userRole);

    // Remove previous Cloudinary asset before swapping DB pointer.
    if (currentUser.avatarUrl) {
      const deleted = await deleteOldAvatar(currentUser.avatarUrl);
      if (!deleted) {
        const newPublicId = extractPublicId(uploadResult.url);
        if (newPublicId) {
          await deleteImage(newPublicId);
        }
        return { success: false, error: 'Failed to delete previous avatar from Cloudinary' };
      }
    }

    // Update database only after old image cleanup succeeds.
    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: uploadResult.url },
    });

    return {
      success: true,
      avatarUrl: uploadResult.url,
    };
  } catch (error) {
    console.error('Upload avatar error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload avatar',
    };
  }
}

export async function deleteAvatarAction(
  authTokenFromClient?: string
): Promise<UploadAvatarResult> {
  try {
    const cookieStore = await cookies();
    const authToken =
      (authTokenFromClient?.trim() ? authTokenFromClient.trim() : null) ??
      cookieStore.get('auth-token')?.value;

    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    const auth = await authenticateServerActionToken(authToken);
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { avatarUrl: true },
    });

    if (!currentUser) {
      return { success: false, error: 'User not found' };
    }

    await prisma.user.update({
      where: { id: auth.user.id },
      data: { avatarUrl: null },
    });

    if (currentUser.avatarUrl) {
      const deleted = await deleteOldAvatar(currentUser.avatarUrl);
      if (!deleted) {
        return { success: false, error: 'Failed to delete avatar from Cloudinary' };
      }
    }

    return { success: true, avatarUrl: undefined };
  } catch (error) {
    console.error('Delete avatar error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete avatar',
    };
  }
}
