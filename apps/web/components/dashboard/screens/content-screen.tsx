'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useLocale, useTranslations } from 'next-intl';
import {
  Edit2,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageUpload } from '@/components/ui/image-upload';
import { UPLOAD_TYPES, UPLOAD_SIZE_LIMITS, type ImagePresetName } from '@/lib/image-utils';
import { toast } from '@/hooks/use-toast';
import { useDraft } from '@/lib/use-api';
import { fetchSettings as readSettings } from '@/lib/settings-client';
import { CONTENT_CONFIG_KEYS } from '@/lib/system-config';
import {
  uploadGalleryAction,
  deleteGalleryAction,
  updateGalleryImageAction,
} from '@/app/actions/upload-gallery';
import {
  uploadSettingsImageAction,
  deleteSettingsImageAction,
} from '@/app/actions/upload-settings-image';

/**
 * Content & Media.
 *
 * Everything the public site *shows*, in one place: the gallery, the copy on the
 * landing, donate and login pages, and the brand images. It replaces the old
 * `dashboard/admin/gallery` screen and absorbs the "Landing" tab that had grown
 * inside Settings — where a hero photo and a partner logo sat next to the loan
 * multiplier and the bKash number, which are not the same job.
 *
 * What stayed behind on Settings is in `SETTINGS_CONFIG_KEYS`: who the
 * foundation is, what its money rules are, where a donor sends money, and how
 * long support chats are kept.
 *
 * Roles: none. A worker sees and edits exactly what an admin does here — the
 * gallery, the public copy and the brand images alike. The first cut gave a
 * worker the gallery tab only, on the theory that public copy is an admin's
 * job; in a foundation this size the person who photographs a distribution is
 * the person who writes the caption under it and the line on the landing page
 * about it, and a worker who can post a photograph to the public site but not
 * fix the typo beside it has to go and find an admin to press one key.
 *
 * The API agrees rather than being worked around. `PUT /api/v1/settings` takes
 * a worker **only** when every key in the body is in `CONTENT_CONFIG_KEYS`; the
 * money and policy rows in `SETTINGS_CONFIG_KEYS` stay admin-only, and Settings
 * is still an admin-only screen. What a page shows is content; what the
 * foundation does with money is not.
 */

type SettingImageType =
  | 'branding.logo'
  | 'branding.dashboardLogo'
  | 'branding.favicon'
  | 'hero.backgroundImage'
  | 'hero.partnerLogo1'
  | 'hero.partnerLogo2'
  | 'hero.partnerLogo3';

interface GalleryItem {
  id: string;
  imageUrl: string;
  captionEn: string | null;
  captionBn: string | null;
  date: string;
  likes?: number;
}

interface GalleryFormData {
  captionEn?: string;
  captionBn?: string;
  date?: string;
}

type ContentTab = 'gallery' | 'pages' | 'brand';

/** Every content key, blank, so an unset row still gets a controlled input. */
const EMPTY_CONTENT: Record<string, string> = Object.fromEntries(
  CONTENT_CONFIG_KEYS.map((key) => [key, '']),
);

const getAuthToken = () =>
  typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;

export default function ContentScreen() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const [activeTab, setActiveTab] = useState<ContentTab>('gallery');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  // ---- Gallery ------------------------------------------------------------
  // WO-27 — SWR, not an effect. The gallery is a Next route rather than the Go
  // API, so it fetches directly instead of going through useApi.
  const {
    data: galleryData,
    error: galleryLoadError,
    isLoading: isGalleryLoading,
    mutate: reloadGallery,
  } = useSWR<GalleryItem[], Error>(
    '/api/v1/gallery',
    async (url: string) => {
      const response = await fetch(url, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Server error');
      return payload as GalleryItem[];
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const galleryItems = useMemo<GalleryItem[]>(() => galleryData ?? [], [galleryData]);

  // Uploads and deletes fail for their own reasons; kept apart from the read.
  const [galleryMutationError, setGalleryMutationError] = useState<string | null>(null);
  const galleryError = galleryMutationError ?? (galleryLoadError ? galleryLoadError.message : null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GalleryItem | null>(null);
  const [formData, setFormData] = useState<GalleryFormData>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---- Site content -------------------------------------------------------
  // WO-27 — SWR, not an effect. This screen *edits* what it fetches, so the
  // server value stays derived and only the admin's edits are state; see
  // useDraft in lib/use-api.ts.
  const {
    data: settingsData,
    isLoading: isSettingsLoading,
    mutate: reloadSettings,
  } = useSWR<Record<string, string>>(
    '/api/v1/settings?content',
    async () => {
      // The staff tier. Without the token this reads the public subset and then
      // saves it back, which is a form with fields silently missing.
      const data = await readSettings();
      if (!data) throw new Error('Failed to load settings');
      return data;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const serverContent = useMemo<Record<string, string>>(() => {
    const strings = Object.fromEntries(
      Object.entries(settingsData ?? {}).filter(
        ([key, value]) =>
          typeof value === 'string' && (CONTENT_CONFIG_KEYS as readonly string[]).includes(key),
      ),
    ) as Record<string, string>;
    return { ...EMPTY_CONTENT, ...strings };
  }, [settingsData]);

  const [content, setContent, resetContentDraft] = useDraft(serverContent);

  const setKey = (key: string) => (value: string) =>
    setContent((prev) => ({ ...prev, [key]: value }));

  const handleSaveContent = async () => {
    setIsSaving(true);
    try {
      // Only the content keys are posted. The settings screen owns the rest, and
      // the two lists are a partition — see lib/system-config.ts — so neither
      // screen can quietly overwrite the other's rows with a stale copy.
      const payload = Object.fromEntries(
        CONTENT_CONFIG_KEYS.map((key) => [key, content[key] ?? '']),
      );
      const authToken = getAuthToken();
      const response = await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to save content');
      }
      // Re-read first: the form then shows what the API actually stored, which
      // is the only way the editor learns a value was normalised on the way in.
      await reloadSettings();
      resetContentDraft();
      toast({
        title: 'Success',
        description: locale === 'bn' ? 'কনটেন্ট সংরক্ষিত হয়েছে' : 'Content saved',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save content',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleImageUpload = (imageType: SettingImageType) => async (formDataWithImage: FormData) => {
    const authToken = getAuthToken();
    if (!authToken) return { success: false, error: 'Not authenticated' };

    setIsUploadingMedia(true);
    formDataWithImage.append('authToken', authToken);
    const result = await uploadSettingsImageAction(imageType, formDataWithImage);
    setIsUploadingMedia(false);

    if (result.success && result.imageUrl) {
      setContent((prev) => ({ ...prev, [imageType]: result.imageUrl as string }));
      return { success: true, imageUrl: result.imageUrl };
    }
    return { success: false, error: result.error || 'Upload failed' };
  };

  const handleImageDelete = async (imageType: SettingImageType) => {
    const result = await deleteSettingsImageAction(imageType, getAuthToken() ?? undefined);
    if (!result.success) {
      toast({
        title: 'Error',
        description: result.error || 'Failed to delete image',
        variant: 'destructive',
      });
      return;
    }
    setContent((prev) => ({ ...prev, [imageType]: '' }));
    toast({ title: 'Success', description: 'Image removed' });
  };

  // ---- Gallery actions ----------------------------------------------------
  const resetGalleryForm = () => {
    setFormData({});
    setPreviewUrl(null);
    setSelectedFile(null);
    setEditingItem(null);
  };

  const handleGalleryPreview = async (formDataWithImage: FormData) => {
    const file = formDataWithImage.get('image');
    if (file instanceof File) {
      setSelectedFile(file);
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
      return { success: true, imageUrl: objectUrl };
    }
    return { success: false, error: 'No file selected' };
  };

  const handleGallerySubmit = async () => {
    if (!selectedFile) {
      toast({ title: 'Error', description: 'Please select an image', variant: 'destructive' });
      return;
    }
    const authToken = getAuthToken();
    if (!authToken) {
      toast({ title: 'Error', description: 'Not authenticated', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    setGalleryMutationError(null);
    const fd = new FormData();
    fd.append('image', selectedFile);
    fd.append('authToken', authToken);
    if (formData.captionEn) fd.append('captionEn', formData.captionEn);
    if (formData.captionBn) fd.append('captionBn', formData.captionBn);
    if (formData.date) fd.append('date', formData.date);

    try {
      const result = editingItem
        ? await updateGalleryImageAction(editingItem.id, fd)
        : await uploadGalleryAction(fd);
      if (!result.success) throw new Error(result.error || 'Failed');
      toast({ title: 'Success', description: editingItem ? 'Updated' : 'Created' });
      setIsDialogOpen(false);
      resetGalleryForm();
      await reloadGallery();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed';
      setGalleryMutationError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGalleryDelete = async (id: string) => {
    if (!confirm(locale === 'bn' ? 'মুছে ফেলতে চান?' : 'Delete this item?')) return;
    setGalleryMutationError(null);
    try {
      const result = await deleteGalleryAction(id, getAuthToken() ?? undefined);
      if (!result.success) throw new Error(result.error || 'Failed');
      toast({ title: 'Success', description: 'Deleted' });
      await reloadGallery();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed';
      setGalleryMutationError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const openGalleryEdit = (item: GalleryItem) => {
    setEditingItem(item);
    setPreviewUrl(item.imageUrl);
    setFormData({
      captionEn: item.captionEn || '',
      captionBn: item.captionBn || '',
      date: new Date(item.date).toISOString().split('T')[0],
    });
    setIsDialogOpen(true);
  };

  const tabs: Array<{ key: ContentTab; label: string }> = [
    { key: 'gallery', label: locale === 'bn' ? 'গ্যালারি' : 'Gallery' },
    { key: 'pages', label: locale === 'bn' ? 'পাবলিক পেজ' : 'Public Pages' },
    { key: 'brand', label: locale === 'bn' ? 'ব্র্যান্ড ও ছবি' : 'Brand & Images' },
  ];

  /** The uploader's own chrome, in the reader's language. */
  const uploadLabels =
    locale === 'bn'
      ? {
          dropHere: 'ছবিটি এখানে টেনে আনুন',
          orBrowse: 'অথবা ক্লিক করে বেছে নিন',
          choose: 'ছবি বেছে নিন',
          uploading: 'আপলোড হচ্ছে...',
          constraints: (types: string, maxSizeMB: number) =>
            `${types} · সর্বোচ্চ ${maxSizeMB}MB`,
          dropAnImage: 'একটি ছবি ফাইল দিন',
          invalidImage: 'ছবিটি গ্রহণযোগ্য নয়',
          uploadFailed: 'আপলোড ব্যর্থ হয়েছে',
          removeImage: 'ছবিটি সরান',
        }
      : undefined;

  /**
   * Every brand image, with the one thing this screen never said: **where it
   * shows up**.
   *
   * Seven upload boxes labelled "Site Logo", "Dashboard Logo", "Favicon" and
   * three numbered partner slots, and nothing on the screen distinguished them.
   * An admin had no way to tell which one the header uses, whether the favicon
   * was the browser tab or something else, or that leaving a partner slot empty
   * simply removes that logo from the row rather than leaving a gap. So each
   * field now states the page it appears on, the shape it should be, and what
   * happens when it is empty.
   *
   * `preset` is the compression applied in the browser before the file is sent,
   * and it is not cosmetic: without it these uploads exceeded the Server Action
   * body limit and failed with no message. `fit` is `contain` for everything
   * with a shape of its own, because a cropped preview makes an admin crop the
   * source to compensate.
   */
  const imageField = (
    key: SettingImageType,
    label: string,
    hint: string,
    aspectRatio: string,
    preset: ImagePresetName,
    fit: 'cover' | 'contain' = 'contain',
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <ImageUpload
        // The field already has its own <Label> above; ImageUpload's default
        // "Upload Image" underneath it made every one of the seven read
        // "Site Logo / Upload Image / Shows in the header…".
        label=""
        currentImage={content[key] || undefined}
        onUpload={handleImageUpload(key)}
        onUploadComplete={(url) => setContent((prev) => ({ ...prev, [key]: url }))}
        onUploadError={(error) =>
          toast({ title: 'Upload Error', description: error, variant: 'destructive' })
        }
        maxSizeMB={key.includes('favicon') ? UPLOAD_SIZE_LIMITS.favicon : UPLOAD_SIZE_LIMITS.default}
        acceptedTypes={[...UPLOAD_TYPES.settings]}
        aspectRatio={aspectRatio}
        preset={preset}
        fit={fit}
        hint={hint}
        labels={uploadLabels}
      />
      {content[key] && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => void handleImageDelete(key)}
          disabled={isUploadingMedia}
          className="gap-2"
        >
          <Trash2 className="h-4 w-4" />
          {locale === 'bn' ? 'সরান' : 'Remove'}
        </Button>
      )}
    </div>
  );

  const textField = (
    key: string,
    label: string,
    placeholder?: string,
    hint?: string,
    rows?: number,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`content-${key}`}>{label}</Label>
      {rows ? (
        <Textarea
          id={`content-${key}`}
          value={content[key] ?? ''}
          onChange={(e) => setKey(key)(e.target.value)}
          placeholder={placeholder}
          rows={rows}
        />
      ) : (
        <Input
          id={`content-${key}`}
          value={content[key] ?? ''}
          onChange={(e) => setKey(key)(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  /**
   * A **pair** of boxes for one piece of public prose — T-11.
   *
   * Every field here used to be a single box, labelled in English, whose value
   * was rendered to both audiences. An admin writing for their own members put
   * Bengali on the English home page and had no way to tell: nothing over the
   * source can see a string that lives in the database, and the end-to-end
   * language check strips admin-typed values on purpose so it never goes red on
   * content.
   *
   * It is the same shape as the organisation's name and address — the bare key
   * is Bengali, the `…En` twin is English — and `lib/localized-settings.ts` is
   * the one place that resolves them.
   */
  const localizedField = (
    key: string,
    label: string,
    options?: { placeholderBn?: string; placeholderEn?: string; hint?: string; rows?: number },
  ) => (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {options?.hint && <p className="text-xs text-muted-foreground">{options.hint}</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {textField(
          key,
          locale === 'bn' ? 'বাংলা' : 'Bangla',
          options?.placeholderBn,
          undefined,
          options?.rows,
        )}
        {textField(
          `${key}En`,
          locale === 'bn' ? 'ইংরেজি' : 'English',
          options?.placeholderEn,
          undefined,
          options?.rows,
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {locale === 'bn' ? 'কনটেন্ট ও মিডিয়া' : 'Content & Media'}
          </h1>
          <p className="text-sm text-gray-500">
            {locale === 'bn'
              ? 'পাবলিক সাইটে যা দেখা যায়'
              : 'Everything the public site shows'}
          </p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'gallery' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reloadGallery()}
                disabled={isGalleryLoading}
                className="h-8"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isGalleryLoading ? 'animate-spin' : ''}`} />
                <span className="sr-only">{tA11y('refresh')}</span>
              </Button>
              <Button size="sm" onClick={() => setIsDialogOpen(true)} className="h-8">
                <Plus className="h-3.5 w-3.5 mr-1" />
                {locale === 'bn' ? 'যোগ' : 'Add'}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void handleSaveContent()} disabled={isSaving} className="h-8">
              {isSaving ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              {locale === 'bn' ? 'সংরক্ষণ' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {tabs.length > 1 && (
        <div className="flex border-b border-gray-200 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ---- Gallery ---- */}
      {activeTab === 'gallery' && (
        <div className="space-y-4">
          {galleryError && (
            <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">
              {galleryError}
            </div>
          )}

          <div className="border border-gray-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-24">
                    {locale === 'bn' ? 'ছবি' : 'Image'}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    {locale === 'bn' ? 'ক্যাপশন (EN)' : 'Caption (EN)'}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">
                    {locale === 'bn' ? 'ক্যাপশন (BN)' : 'Caption (BN)'}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">
                    {locale === 'bn' ? 'তারিখ' : 'Date'}
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                    {locale === 'bn' ? 'অ্যাকশন' : 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {isGalleryLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                    </td>
                  </tr>
                ) : galleryItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      <ImageIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                      {locale === 'bn' ? 'কোনো ছবি নেই' : 'No images yet'}
                    </td>
                  </tr>
                ) : (
                  galleryItems.map((item) => (
                    <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <div className="h-10 w-16 rounded overflow-hidden bg-gray-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.imageUrl} alt="" className="object-cover w-full h-full" />
                        </div>
                      </td>
                      <td className="px-4 py-2 text-gray-900">{item.captionEn || '-'}</td>
                      <td className="px-4 py-2 hidden sm:table-cell text-gray-600">
                        {item.captionBn || '-'}
                      </td>
                      <td className="px-4 py-2 hidden md:table-cell text-xs text-gray-500">
                        {new Date(item.date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => openGalleryEdit(item)}
                          className="text-blue-600 hover:text-blue-800 mr-3"
                          aria-label={locale === 'bn' ? 'সম্পাদনা' : 'Edit'}
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => void handleGalleryDelete(item.id)}
                          className="text-red-600 hover:text-red-800"
                          aria-label={locale === 'bn' ? 'মুছুন' : 'Delete'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Public pages ---- */}
      {activeTab === 'pages' && (
        <Card className="rounded-none border-gray-200 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-5 w-5" />
              {locale === 'bn' ? 'পাবলিক পেজের লেখা' : 'Public Page Copy'}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? 'ল্যান্ডিং, ডোনেট এবং লগইন পেজে দেখানো লেখা'
                : 'The words shown on the landing, donate and login pages'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSettingsLoading ? (
              <div className="flex items-center justify-center py-10">
                <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <>
                {localizedField('hero.tagline', locale === 'bn' ? 'হিরো ট্যাগলাইন' : 'Hero Tagline', {
                  placeholderBn: 'যেমন: ইসলামী শরীয়াহ সম্মত',
                  placeholderEn: 'e.g. Shariah Compliant Finance',
                  hint:
                    locale === 'bn'
                      ? 'হোম পেজের উপরের ছোট ব্যাজ'
                      : 'The small badge above the home page headline.',
                })}

                {localizedField(
                  'navigation.donate',
                  locale === 'bn' ? 'মেনুতে "দান করুন" লেখা' : 'Navigation Donate Label',
                  { placeholderBn: 'যেমন: দান করুন', placeholderEn: 'e.g. Donate' },
                )}

                <div className="grid gap-4">
                  {localizedField(
                    'features.title',
                    locale === 'bn' ? 'ফিচার সেকশনের শিরোনাম' : 'Features Section Title',
                    { placeholderBn: 'যেমন: কেন আমরা?', placeholderEn: 'e.g. Why Choose Us?' },
                  )}
                  {localizedField(
                    'contact.title',
                    locale === 'bn' ? 'যোগাযোগ সেকশনের শিরোনাম' : 'Contact Section Title',
                    { placeholderBn: 'যেমন: যোগাযোগ করুন', placeholderEn: 'e.g. Contact Us' },
                  )}
                </div>

                <div className="border-t border-gray-200 my-4" />

                <div className="space-y-1">
                  <h4 className="font-semibold text-sm">
                    {locale === 'bn' ? 'হোম পেজের পরিসংখ্যান' : 'Home page figures'}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'bn'
                      ? 'হিরোর চারটি সংখ্যা। খালি রাখলে সেই কার্ডটি দেখানো হবে না, চারটিই খালি রাখলে পুরো অংশটিই থাকবে না। ফাউন্ডেশনের প্রকৃত সংখ্যাই লিখুন।'
                      : 'The four figures beside the headline. Leave one blank and that card is not shown; leave all four blank and the panel is not shown. Write the foundation\u2019s real figures \u2014 these used to be invented numbers nobody could correct.'}
                  </p>
                </div>

                {localizedField('stats.members', locale === 'bn' ? 'মোট সদস্য' : 'Total Members', {
                  placeholderBn: 'যেমন: ১২৫+',
                  placeholderEn: 'e.g. 125+',
                })}
                {localizedField('stats.deposits', locale === 'bn' ? 'মোট আমানত' : 'Total Deposits', {
                  placeholderBn: 'যেমন: \u09f3২.৫ লক্ষ+',
                  placeholderEn: 'e.g. BDT 250,000+',
                })}
                {localizedField('stats.loans', locale === 'bn' ? 'বিতরণকৃত ঋণ' : 'Loans Distributed', {
                  placeholderBn: 'যেমন: \u09f3১.৮ লক্ষ+',
                  placeholderEn: 'e.g. BDT 180,000+',
                })}
                {localizedField('stats.charity', locale === 'bn' ? 'দান তহবিল' : 'Charitable Fund', {
                  placeholderBn: 'যেমন: \u09f3২৫,০০০+',
                  placeholderEn: 'e.g. BDT 25,000+',
                })}

                <div className="border-t border-gray-200 my-4" />

                <div className="space-y-1">
                  <h4 className="font-semibold text-sm">
                    {locale === 'bn' ? 'ডোনেট পেজের লেখা' : 'Donate page copy'}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'bn'
                      ? 'শুধু শিরোনাম ও নোট। বিকাশ, নগদ, রকেট ও ব্যাংকের তথ্য সেটিংস পেজে — ভুল শিরোনাম বিব্রতকর, ভুল একাউন্ট নম্বর দাতার টাকা অন্যের কাছে পাঠায়।'
                      : 'The headings and the reference note. The bKash, Nagad, Rocket and bank details live on Settings, with the rest of the money configuration \u2014 a wrong heading is embarrassing, a wrong account number sends a donor\u2019s money to a stranger.'}
                  </p>
                </div>

                {localizedField(
                  'donation.title',
                  locale === 'bn' ? 'ডোনেট সেকশনের শিরোনাম' : 'Donate Section Title',
                  {
                    placeholderBn: 'যেমন: আমাদের কাজে সহযোগিতা করুন',
                    placeholderEn: 'e.g. Donate to Support Our Mission',
                  },
                )}
                {localizedField(
                  'donation.subtitle',
                  locale === 'bn' ? 'ডোনেট সেকশনের উপশিরোনাম' : 'Donate Section Subtitle',
                  {
                    placeholderBn: 'যেমন: নিচের মাধ্যমগুলোতে অনুদান পাঠান',
                    placeholderEn: 'e.g. Send your donation through the following channels',
                  },
                )}
                {localizedField(
                  'donation.referenceNote',
                  locale === 'bn' ? 'অনুদানের রেফারেন্স নোট' : 'Donation Reference Note',
                  {
                    rows: 3,
                    placeholderBn: 'যেমন: রেফারেন্সে আপনার নাম, ঠিকানা ও মোবাইল নম্বর লিখুন...',
                    placeholderEn:
                      'e.g. Please mention your name, address and mobile number in reference...',
                  },
                )}

                <div className="border-t border-gray-200 my-4" />

                {localizedField(
                  'auth.welcomeBack',
                  locale === 'bn' ? 'লগইন পেজের অভিবাদন' : 'Welcome Back Message (Login Page)',
                  {
                    placeholderBn: 'যেমন: স্বাগতম!',
                    placeholderEn: 'e.g. Welcome Back!',
                  },
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Brand & images ---- */}
      {activeTab === 'brand' && (
        <Card className="rounded-none border-gray-200 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              {locale === 'bn' ? 'ব্র্যান্ড ও ছবি' : 'Brand & Images'}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? 'প্রতিটি ছবির নিচে লেখা আছে সেটি কোথায় দেখা যাবে। আপলোডের আগে ছবি ব্রাউজারেই ছোট করা হয়, তাই ফোন থেকে তোলা ছবিও দেওয়া যাবে।'
                : 'Each field says where its image appears. Pictures are shrunk in your browser before they are sent, so a photo straight off a phone is fine.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSettingsLoading ? (
              <div className="flex items-center justify-center py-10">
                <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  {imageField(
                    'branding.logo',
                    locale === 'bn' ? 'সাইট লোগো' : 'Site Logo',
                    locale === 'bn'
                      ? 'প্রতিটি পাবলিক পেজের উপরের হেডারে এবং ফুটারে দেখা যায়। চওড়া লকআপ (লোগো + নাম), স্বচ্ছ PNG সবচেয়ে ভালো। খালি রাখলে সাথে দেওয়া হাসনাহেনা লোগোটি ব্যবহার হবে।'
                      : 'Shows in the header at the top of every public page, and again in the footer. A wide lockup (mark + wordmark) works best; a transparent PNG is ideal. Leave it empty to use the Hasnahena logo shipped with the site.',
                    'aspect-3/1',
                    'logo',
                  )}
                  {imageField(
                    'branding.dashboardLogo',
                    locale === 'bn' ? 'ড্যাশবোর্ড লোগো' : 'Dashboard Logo',
                    locale === 'bn'
                      ? 'সদস্য, কর্মী ও অ্যাডমিন ড্যাশবোর্ডের বাঁ পাশের সাইডবারের উপরে দেখা যায়। জায়গাটি সরু, তাই সাইট লোগোর চেয়ে ছোট বা শুধু প্রতীক ভালো মানায়। খালি রাখলে সাইটের নিজস্ব লোগো ব্যবহার হবে।'
                      : 'Shows at the top of the left sidebar on the member, worker and admin dashboards. That strip is short, so a compact mark often reads better there than the full site logo. Leave it empty to use the shipped logo.',
                    'aspect-3/1',
                    'logo',
                  )}
                  {imageField(
                    'branding.favicon',
                    locale === 'bn' ? 'ফেভিকন' : 'Favicon',
                    locale === 'bn'
                      ? 'ব্রাউজারের ট্যাবে, বুকমার্কে এবং ফোনের হোম স্ক্রিনে শর্টকাটের আইকন হিসেবে দেখা যায়। বর্গাকার ছবি দিন — ছোট আকারে দেখা যাবে, তাই লেখা নয়, শুধু প্রতীক ব্যবহার করুন।'
                      : "Shows as the small icon on the browser tab, in bookmarks, and on a phone's home screen if a member adds a shortcut. Use a square image — it is drawn at about 16px, so a mark reads and words do not.",
                    'aspect-square',
                    'favicon',
                  )}
                </div>

                <div className="border-t border-gray-200 my-4" />

                {imageField(
                  'hero.backgroundImage',
                  locale === 'bn' ? 'হিরো ব্যাকগ্রাউন্ড ইমেজ' : 'Hero Background Image',
                  locale === 'bn'
                    ? 'হোম পেজের একদম উপরের অংশের পেছনের ছবি, লেখার নিচে ম্লান হয়ে দেখা যায়। চওড়া (ল্যান্ডস্কেপ) ছবি দিন; ছবির মাঝের অংশটুকুই ফোনে দেখা যাবে। খালি রাখলে শুধু রঙের ব্যাকগ্রাউন্ড থাকবে।'
                    : 'The photograph behind the top section of the home page, dimmed under the headline. Use a wide landscape image — on a phone only the middle of it is visible. Leave it empty for the plain colour background.',
                  'aspect-video',
                  'hero',
                  'cover',
                )}

                <div className="border-t border-gray-200 my-4" />

                <p className="text-xs text-gray-500">
                  {locale === 'bn'
                    ? 'হোম পেজের হিরো অংশের নিচে সহযোগী প্রতিষ্ঠানের লোগোর সারি। যে স্লট খালি থাকবে সেটি বাদ পড়বে — তিনটিই খালি থাকলে সারিটি দেখাবেই না।'
                    : 'The row of partner logos under the hero on the home page. An empty slot is skipped rather than left blank, and with all three empty the row does not appear at all.'}
                </p>

                <div className="grid gap-4 md:grid-cols-3">
                  {imageField(
                    'hero.partnerLogo1',
                    locale === 'bn' ? 'পার্টনার লোগো ১' : 'Partner Logo 1',
                    locale === 'bn'
                      ? 'সারির প্রথম লোগো।'
                      : 'First logo in the row.',
                    'aspect-4/3',
                    'partner',
                  )}
                  {imageField(
                    'hero.partnerLogo2',
                    locale === 'bn' ? 'পার্টনার লোগো ২' : 'Partner Logo 2',
                    locale === 'bn'
                      ? 'দ্বিতীয় লোগো।'
                      : 'Second logo in the row.',
                    'aspect-4/3',
                    'partner',
                  )}
                  {imageField(
                    'hero.partnerLogo3',
                    locale === 'bn' ? 'পার্টনার লোগো ৩' : 'Partner Logo 3',
                    locale === 'bn'
                      ? 'তৃতীয় লোগো।'
                      : 'Third logo in the row.',
                    'aspect-4/3',
                    'partner',
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Gallery add/edit */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetGalleryForm();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingItem
                ? locale === 'bn'
                  ? 'সম্পাদনা'
                  : 'Edit Item'
                : locale === 'bn'
                  ? 'নতুন ছবি যোগ'
                  : 'Add New Image'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <ImageUpload
              label={locale === 'bn' ? 'ছবি' : 'Image'}
              currentImage={previewUrl || undefined}
              onUpload={handleGalleryPreview}
              onUploadComplete={setPreviewUrl}
              onFileSelected={setSelectedFile}
              onUploadError={(e) => toast({ title: 'Error', description: e, variant: 'destructive' })}
              maxSizeMB={UPLOAD_SIZE_LIMITS.gallery}
              acceptedTypes={[...UPLOAD_TYPES.gallery]}
              aspectRatio="aspect-video"
              preset="gallery"
              autoUpload={false}
              labels={uploadLabels}
            />
            <div>
              <Label className="text-sm">Caption (English)</Label>
              <Input
                value={formData.captionEn || ''}
                onChange={(e) => setFormData({ ...formData, captionEn: e.target.value })}
                placeholder="Description"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Caption (Bengali)</Label>
              <Input
                value={formData.captionBn || ''}
                onChange={(e) => setFormData({ ...formData, captionBn: e.target.value })}
                placeholder="বিবরণ"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'তারিখ' : 'Date'}</Label>
              <Input
                type="date"
                value={formData.date || ''}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSubmitting}
            >
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button size="sm" onClick={() => void handleGallerySubmit()} disabled={isSubmitting}>
              {isSubmitting
                ? '...'
                : editingItem
                  ? locale === 'bn'
                    ? 'আপডেট'
                    : 'Update'
                  : locale === 'bn'
                    ? 'যোগ করুন'
                    : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
