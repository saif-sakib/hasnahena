'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { validateImage, formatFileSize, createImagePreview, revokeImagePreview } from '@/lib/image-utils';

interface ImageUploadProps {
  label?: string;
  currentImage?: string;
  onUploadComplete: (imageUrl: string) => void;
  onUploadError?: (error: string) => void;
  onUpload: (formData: FormData) => Promise<{ success: boolean; imageUrl?: string; error?: string }>;
  acceptedTypes?: string[];
  maxSizeMB?: number;
  aspectRatio?: string;
  className?: string;
  buttonText?: string;
  showPreview?: boolean;
  autoUpload?: boolean;
  onFileSelected?: (file: File) => void;
}

export function ImageUpload({
  label = 'Upload Image',
  currentImage,
  onUploadComplete,
  onUploadError,
  onUpload,
  acceptedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  maxSizeMB = 10,
  aspectRatio,
  className = '',
  buttonText = 'Choose Image',
  showPreview = true,
  autoUpload = true,
  onFileSelected,
}: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(currentImage || null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      setSelectedFile(file);

      // Validate image
      const validation = await validateImage(file, {
        maxSizeMB,
        acceptedTypes,
      });

      if (!validation.valid) {
        setError(validation.error || 'Invalid image');
        if (onUploadError) onUploadError(validation.error || 'Invalid image');
        return;
      }

      // Create preview
      const previewUrl = createImagePreview(file);
      if (preview && preview !== currentImage) {
        revokeImagePreview(preview);
      }
      setPreview(previewUrl);
      if (onFileSelected) {
        onFileSelected(file);
      }

      if (autoUpload) {
        await handleUpload(file);
      }
    },
    [maxSizeMB, acceptedTypes, preview, currentImage, onUploadError, autoUpload, onFileSelected]
  );

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const result = await onUpload(formData);

      if (result.success && result.imageUrl) {
        onUploadComplete(result.imageUrl);
        // Update preview to the uploaded URL
        if (preview && preview !== currentImage) {
          revokeImagePreview(preview);
        }
        setPreview(result.imageUrl);
      } else {
        const errorMsg = result.error || 'Upload failed';
        setError(errorMsg);
        if (onUploadError) onUploadError(errorMsg);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Upload failed';
      setError(errorMsg);
      if (onUploadError) onUploadError(errorMsg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    } else {
      setError('Please drop an image file');
    }
  };

  const handleRemove = () => {
    if (preview && preview !== currentImage) {
      revokeImagePreview(preview);
    }
    setPreview(null);
    setSelectedFile(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {label && <Label className="text-sm font-medium">{label}</Label>}

      {/* Preview */}
      {showPreview && preview && (
        <div className="relative rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800">
          <div className={`relative ${aspectRatio || 'aspect-video'} w-full`}>
            <Image
              src={preview}
              alt="Preview"
              fill
              sizes="(max-width: 768px) 100vw, 640px"
              className="object-cover"
              unoptimized={preview.startsWith('blob:')}
            />
          </div>
          {!isUploading && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 h-8 w-8 rounded-full shadow-lg"
              onClick={handleRemove}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          {isUploading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="text-center text-white">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p className="text-sm">Uploading...</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Area */}
      {!preview && (
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
              : 'border-slate-300 dark:border-slate-700 hover:border-emerald-400'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center gap-3">
            {isUploading ? (
              <>
                <Loader2 className="h-12 w-12 text-emerald-600 animate-spin" />
                <p className="text-sm text-slate-600 dark:text-slate-400">Uploading...</p>
              </>
            ) : (
              <>
                <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-full">
                  <Upload className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Drag and drop your image here</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    or click to browse
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={handleButtonClick}>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  {buttonText}
                </Button>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {acceptedTypes.map(t => t.split('/')[1].toUpperCase()).join(', ')} · Max {maxSizeMB}MB
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* File Info */}
      {selectedFile && !isUploading && (
        <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
          <ImageIcon className="h-3 w-3" />
          <span>{selectedFile.name}</span>
          <span>({formatFileSize(selectedFile.size)})</span>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded">
          {error}
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedTypes.join(',')}
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
