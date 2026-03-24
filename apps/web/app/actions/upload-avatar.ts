'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { verifyHs256Jwt } from '@/lib/jwt';
import { uploadAvatar, deleteOldAvatar, extractPublicId, deleteImage } from '@/lib/cloudinary';

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

    if (!claims.sub) {
      return { success: false, error: 'Invalid token claims' };
    }

    const userId = claims.sub;
    const userRole = claims.role || 'member';

    // Get file from form data
    const file = formData.get('avatar') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return { success: false, error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.' };
    }

    // Validate file size (5MB max for avatars)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return { success: false, error: 'File too large. Maximum size is 5MB.' };
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
    const cookieStore = cookies();
    const authToken =
      (authTokenFromClient?.trim() ? authTokenFromClient.trim() : null) ??
      cookieStore.get('auth-token')?.value;

    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return { success: false, error: 'Server configuration error' };
    }

    let claims;
    try {
      claims = verifyHs256Jwt(authToken, secret);
    } catch {
      return { success: false, error: 'Invalid authentication token' };
    }

    if (!claims.sub) {
      return { success: false, error: 'Invalid token claims' };
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: { avatarUrl: true },
    });

    if (!currentUser) {
      return { success: false, error: 'User not found' };
    }

    await prisma.user.update({
      where: { id: claims.sub },
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
