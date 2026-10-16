'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  validateImage,
  formatFileSize,
  createImagePreview,
  revokeImagePreview,
  compressImageFile,
  IMAGE_PRESETS,
  type ImagePresetName,
} from '@/lib/image-utils';

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
  /** Compression preset (IMAGE_PRESETS); defaulted so no uploader skips compression. */
  preset?: ImagePresetName;
  /** Description shown under the control: where this image will appear. */
  hint?: string;
  /** `contain` for anything with its own shape — a cropped preview makes admins crop the source. */
  fit?: 'cover' | 'contain';
  /** The uploader's own labels, in the reader's language (passed in; a primitive has no namespace). */
  labels?: Partial<UploadLabels>;
}

export interface UploadLabels {
  dropHere: string;
  orBrowse: string;
  choose: string;
  uploading: string;
  /** `(types) · Max (n)MB` — takes the formatted type list and the limit. */
  constraints: (types: string, maxSizeMB: number) => string;
  dropAnImage: string;
  invalidImage: string;
  uploadFailed: string;
  removeImage: string;
}

const DEFAULT_LABELS: UploadLabels = {
  dropHere: 'Drag and drop your image here',
  orBrowse: 'or click to browse',
  choose: 'Choose Image',
  uploading: 'Uploading...',
  constraints: (types, maxSizeMB) => `${types} · Max ${maxSizeMB}MB`,
  dropAnImage: 'Please drop an image file',
  invalidImage: 'Invalid image',
  uploadFailed: 'Upload failed',
  removeImage: 'Remove image',
};

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
  buttonText,
  showPreview = true,
  autoUpload = true,
  onFileSelected,
  preset = 'gallery',
  hint,
  fit = 'cover',
  labels: labelOverrides,
}: ImageUploadProps) {
  const labels: UploadLabels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [preview, setPreview] = useState<string | null>(currentImage || null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [savedBytes, setSavedBytes] = useState<{ from: number; to: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // currentImage arrives after first render (SWR): sync it into the preview,
  // but never over a `blob:` preview the reader is choosing.
  const lastSyncedRef = useRef<string | undefined>(currentImage);
  useEffect(() => {
    if (currentImage === lastSyncedRef.current) return;
    lastSyncedRef.current = currentImage;
    setPreview((existing) => {
      if (existing?.startsWith('blob:')) return existing;
      return currentImage || null;
    });
  }, [currentImage]);

  const handleUpload = useCallback(async (file: File) => {
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
        const errorMsg = result.error || labels.uploadFailed;
        setError(errorMsg);
        if (onUploadError) onUploadError(errorMsg);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : labels.uploadFailed;
      setError(errorMsg);
      if (onUploadError) onUploadError(errorMsg);
    } finally {
      setIsUploading(false);
    }
  }, [onUpload, onUploadComplete, preview, currentImage, onUploadError, labels.uploadFailed]);

  const processFile = useCallback(
    async (picked: File) => {
      setError(null);
      setSavedBytes(null);

      // Compress FIRST, then validate — the limit describes what is stored.
      const file = await compressImageFile(picked, IMAGE_PRESETS[preset]);
      if (file !== picked) {
        setSavedBytes({ from: picked.size, to: file.size });
      }
      setSelectedFile(file);

      // Validate image
      const validation = await validateImage(file, {
        maxSizeMB,
        acceptedTypes,
      });

      if (!validation.valid) {
        setError(validation.error || labels.invalidImage);
        if (onUploadError) onUploadError(validation.error || labels.invalidImage);
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
    [maxSizeMB, acceptedTypes, preview, currentImage, onUploadError, autoUpload, onFileSelected, handleUpload, preset, labels.invalidImage]
  );

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
      setError(labels.dropAnImage);
    }
  };

  const handleRemove = () => {
    if (preview && preview !== currentImage) {
      revokeImagePreview(preview);
    }
    setPreview(null);
    setSelectedFile(null);
    setSavedBytes(null);
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
      {hint && (
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p>
      )}

      {/* Preview */}
      {showPreview && preview && (
        <div className="relative rounded-sm overflow-hidden bg-slate-100 dark:bg-slate-800">
          <div className={`relative ${aspectRatio || 'aspect-video'} w-full`}>
            <Image
              src={preview}
              alt="Preview"
              fill
              sizes="(max-width: 768px) 100vw, 640px"
              className={fit === 'contain' ? 'object-contain p-2' : 'object-cover'}
              unoptimized={preview.startsWith('blob:')}
            />
          </div>
          {!isUploading && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 h-8 w-8 rounded-full shadow-none"
              onClick={handleRemove}
              aria-label={labels.removeImage}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          {isUploading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="text-center text-white">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p className="text-sm">{labels.uploading}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Area */}
      {!preview && (
        <div
          className={`border-2 border-dashed rounded-sm p-4 text-center transition-colors ${
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
                <p className="text-sm text-slate-600 dark:text-slate-400">{labels.uploading}</p>
              </>
            ) : (
              <>
                <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-full">
                  <Upload className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">{labels.dropHere}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{labels.orBrowse}</p>
                </div>
                <Button type="button" variant="outline" onClick={handleButtonClick}>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  {buttonText ?? labels.choose}
                </Button>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {labels.constraints(
                    acceptedTypes.map((t) => t.split('/')[1].toUpperCase()).join(', '),
                    maxSizeMB,
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* File Info */}
      {selectedFile && !isUploading && (
        <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
          <ImageIcon className="h-3 w-3 shrink-0" />
          <span className="min-w-0 break-all">{selectedFile.name}</span>
          {savedBytes ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              {formatFileSize(savedBytes.from)} &rarr; {formatFileSize(savedBytes.to)}
            </span>
          ) : (
            <span>({formatFileSize(selectedFile.size)})</span>
          )}
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
