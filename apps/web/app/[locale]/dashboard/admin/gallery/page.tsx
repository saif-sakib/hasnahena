'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { Plus, Trash2, Edit2, Image as ImageIcon, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { ImageUpload } from '@/components/ui/image-upload';
import { uploadGalleryAction, deleteGalleryAction, updateGalleryImageAction } from '@/app/actions/upload-gallery';

interface GalleryFormData { captionEn?: string; captionBn?: string; date?: string; }
interface GalleryItem { id: string; imageUrl: string; captionEn: string | null; captionBn: string | null; date: string; likes: number; }

export default function GalleryManagementPage() {
  const locale = useLocale();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GalleryItem | null>(null);
  const [formData, setFormData] = useState<GalleryFormData>({});
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const getAuthToken = () => typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;

  const fetchItems = async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await fetch('/api/v1/gallery');
      const data = await response.json();
      if (!response.ok) { setFetchError(data.error || 'Server error'); return; }
      setItems(data);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Network error');
    } finally {
      setIsLoading(false);
    }
  };

  // Below fetchItems, not above it. `const` declarations are in the temporal
  // dead zone until evaluated, so an effect placed earlier only works because
  // effects run after the whole body has. It is legal and it is fragile.
  useEffect(() => { fetchItems(); }, []);

  const handleImageUpload = async (formDataWithImage: FormData) => {
    const file = formDataWithImage.get('image');
    if (file instanceof File) {
      setSelectedFile(file);
      const previewUrl = URL.createObjectURL(file);
      setUploadedImageUrl(previewUrl);
      return { success: true, imageUrl: previewUrl };
    }
    return { success: false, error: 'No file selected' };
  };

  const handleSubmit = async () => {
    if (!selectedFile) { toast({ title: 'Error', description: 'Please select an image', variant: 'destructive' }); return; }
    const authToken = getAuthToken();
    if (!authToken) { toast({ title: 'Error', description: 'Not authenticated', variant: 'destructive' }); return; }

    setIsSubmitting(true);
    const fd = new FormData();
    fd.append('image', selectedFile);
    fd.append('authToken', authToken);
    if (formData.captionEn) fd.append('captionEn', formData.captionEn);
    if (formData.captionBn) fd.append('captionBn', formData.captionBn);
    if (formData.date) fd.append('date', formData.date);

    try {
      const result = editingItem ? await updateGalleryImageAction(editingItem.id, fd) : await uploadGalleryAction(fd);
      if (result.success) {
        toast({ title: 'Success', description: editingItem ? 'Updated' : 'Created' });
        setIsDialogOpen(false);
        resetForm();
        await fetchItems();
      } else { throw new Error(result.error || 'Failed'); }
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => { setFormData({}); setUploadedImageUrl(null); setSelectedFile(null); setEditingItem(null); };

  const handleDelete = async (id: string) => {
    if (!confirm(locale === 'bn' ? 'মুছে ফেলতে চান?' : 'Delete this item?')) return;
    try {
      const result = await deleteGalleryAction(id, getAuthToken() ?? undefined);
      if (!result.success) throw new Error(result.error || 'Failed');
      toast({ title: 'Success', description: 'Deleted' });
      fetchItems();
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed', variant: 'destructive' });
    }
  };

  const openEdit = (item: GalleryItem) => {
    setEditingItem(item);
    setUploadedImageUrl(item.imageUrl);
    setFormData({ captionEn: item.captionEn || '', captionBn: item.captionBn || '', date: new Date(item.date).toISOString().split('T')[0] });
    setIsDialogOpen(true);
  };

  const handleDialogChange = (open: boolean) => { setIsDialogOpen(open); if (!open) resetForm(); };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{locale === 'bn' ? 'গ্যালারি ব্যবস্থাপনা' : 'Gallery Management'}</h1>
          <p className="text-sm text-gray-500">{items.length} {locale === 'bn' ? 'টি ছবি' : 'images'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void fetchItems()} disabled={isLoading} className="h-8">
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={() => setIsDialogOpen(true)} className="h-8">
            <Plus className="h-3.5 w-3.5 mr-1" />{locale === 'bn' ? 'যোগ' : 'Add'}
          </Button>
        </div>
      </div>

      {fetchError && <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">{fetchError}</div>}

      {/* Table */}
      <div className="border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600 w-24">{locale === 'bn' ? 'ছবি' : 'Image'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'ক্যাপশন (EN)' : 'Caption (EN)'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">{locale === 'bn' ? 'ক্যাপশন (BN)' : 'Caption (BN)'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'তারিখ' : 'Date'}</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'অ্যাকশন' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                <ImageIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                {locale === 'bn' ? 'কোনো ছবি নেই' : 'No images yet'}
              </td></tr>
            ) : items.map((item) => (
              <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="h-10 w-16 rounded overflow-hidden bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.imageUrl} alt="" className="object-cover w-full h-full" />
                  </div>
                </td>
                <td className="px-4 py-2 text-gray-900">{item.captionEn || '-'}</td>
                <td className="px-4 py-2 hidden sm:table-cell text-gray-600">{item.captionBn || '-'}</td>
                <td className="px-4 py-2 hidden md:table-cell text-xs text-gray-500">{new Date(item.date).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => openEdit(item)} className="text-blue-600 hover:text-blue-800 mr-3"><Edit2 className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-800"><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem ? (locale === 'bn' ? 'সম্পাদনা' : 'Edit Item') : (locale === 'bn' ? 'নতুন ছবি যোগ' : 'Add New Image')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <ImageUpload label={locale === 'bn' ? 'ছবি' : 'Image'} currentImage={uploadedImageUrl || undefined} onUpload={handleImageUpload} onUploadComplete={setUploadedImageUrl} onFileSelected={setSelectedFile} onUploadError={(e) => toast({ title: 'Error', description: e, variant: 'destructive' })} maxSizeMB={10} aspectRatio="aspect-video" autoUpload={false} />
            <div>
              <Label className="text-sm">Caption (English)</Label>
              <Input value={formData.captionEn || ''} onChange={(e) => setFormData({ ...formData, captionEn: e.target.value })} placeholder="Description" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Caption (Bengali)</Label>
              <Input value={formData.captionBn || ''} onChange={(e) => setFormData({ ...formData, captionBn: e.target.value })} placeholder="বিবরণ" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'তারিখ' : 'Date'}</Label>
              <Input type="date" value={formData.date || ''} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>{locale === 'bn' ? 'বাতিল' : 'Cancel'}</Button>
            <Button size="sm" onClick={() => void handleSubmit()} disabled={isSubmitting}>{isSubmitting ? '...' : editingItem ? (locale === 'bn' ? 'আপডেট' : 'Update') : (locale === 'bn' ? 'যোগ করুন' : 'Add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
