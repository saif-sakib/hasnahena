'use client';

import { useState, useRef } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { deleteAvatarAction, uploadAvatarAction } from '@/app/actions/upload-avatar';
import { validateImage, getInitials, getAvatarColor } from '@/lib/image-utils';

interface AvatarUploadProps {
  currentAvatarUrl?: string | null;
  userName: string;
  onUploadComplete?: (avatarUrl: string) => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  editable?: boolean;
}

const sizeClasses = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-16 w-16 text-lg',
  lg: 'h-24 w-24 text-2xl',
  xl: 'h-32 w-32 text-4xl',
};

const iconSizes = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
  xl: 'h-6 w-6',
};

export function AvatarUpload({
  currentAvatarUrl,
  userName,
  onUploadComplete,
  size = 'md',
  editable = true,
}: AvatarUploadProps) {
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = getInitials(userName);
  const avatarColor = getAvatarColor(userName);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate
    const validation = await validateImage(file, {
      maxSizeMB: 5,
      acceptedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    });

    if (!validation.valid) {
      toast({
        title: 'Invalid Image',
        description: validation.error,
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

      try {
        const formData = new FormData();
        formData.append('avatar', file);
        const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
        if (token) {
          formData.append('authToken', token);
        }

        const result = await uploadAvatarAction(formData);

      if (result.success && result.avatarUrl) {
        setAvatarUrl(result.avatarUrl);
        window.dispatchEvent(new Event('auth-change'));
        toast({
          title: 'Success',
          description: 'Profile picture updated successfully',
        });
        if (onUploadComplete) {
          onUploadComplete(result.avatarUrl);
        }
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Failed to upload avatar',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleClick = () => {
    if (editable && !isUploading) {
      fileInputRef.current?.click();
    }
  };

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isUploading) return;

    setIsUploading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
      const result = await deleteAvatarAction(token ?? undefined);
      if (!result.success) {
        throw new Error(result.error || 'Failed to remove avatar');
      }

      setAvatarUrl(null);
      window.dispatchEvent(new Event('auth-change'));
      toast({
        title: 'Success',
        description: 'Profile picture removed successfully',
      });
      if (onUploadComplete) {
        onUploadComplete('');
      }
    } catch (error) {
      toast({
        title: 'Remove Failed',
        description: error instanceof Error ? error.message : 'Failed to remove avatar',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="relative inline-block">
      <div
        className={`relative ${sizeClasses[size]} rounded-full overflow-hidden ${
          editable ? 'cursor-pointer' : ''
        } transition-all ${isHovered && editable ? 'ring-2 ring-emerald-500 ring-offset-2' : ''}`}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {avatarUrl ? (
          <>
            <Image
              src={avatarUrl}
              alt={userName}
              fill
              className="object-cover"
              unoptimized={avatarUrl.startsWith('blob:')}
            />
            {editable && (isHovered || isUploading) && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                {isUploading ? (
                  <Loader2 className={`${iconSizes[size]} text-white animate-spin`} />
                ) : (
                  <Camera className={`${iconSizes[size]} text-white`} />
                )}
              </div>
            )}
          </>
        ) : (
          <div
            className={`w-full h-full ${avatarColor} flex items-center justify-center text-white font-semibold`}
          >
            {isUploading ? (
              <Loader2 className={`${iconSizes[size]} animate-spin`} />
            ) : (
              <span>{initials}</span>
            )}
            {editable && isHovered && !isUploading && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                <Camera className={`${iconSizes[size]} text-white`} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit button for larger sizes */}
      {editable && (size === 'lg' || size === 'xl') && !isUploading && (
        <Button
          type="button"
          size="icon"
          className="absolute bottom-0 right-0 h-8 w-8 rounded-full shadow-lg bg-emerald-600 hover:bg-emerald-700"
          onClick={handleClick}
        >
          <Camera className="h-4 w-4 text-white" />
        </Button>
      )}

      {/* Remove button */}
      {editable && avatarUrl && !isUploading && (
        <Button
          type="button"
          size="icon"
          variant="destructive"
          className="absolute top-0 right-0 h-6 w-6 rounded-full shadow-lg"
          onClick={handleRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      )}

      {/* Hidden file input */}
      {editable && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
      )}
    </div>
  );
}
