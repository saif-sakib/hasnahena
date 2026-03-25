'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, Edit2, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import Image from 'next/image';
import { ImageUpload } from '@/components/ui/image-upload';
import { uploadGalleryAction, deleteGalleryAction, updateGalleryImageAction } from '@/app/actions/upload-gallery';


interface GalleryFormData {
  captionEn?: string;
  captionBn?: string;
  date?: string;
}

interface GalleryItem {
  id: string;
  imageUrl: string;
  captionEn: string | null;
  captionBn: string | null;
  date: string;
  likes: number;
}

export default function GalleryManagementPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GalleryItem | null>(null);
  const [formData, setFormData] = useState<GalleryFormData>({});
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const getAuthToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      setFetchError(null);
      const response = await fetch('/api/v1/gallery');
      const data = await response.json();

      if (!response.ok) {
        // Server returned an error - show the details
        const errorMsg = data.details || data.error || `Server error: ${response.status}`;
        console.error('Gallery fetch error:', data);
        setFetchError(errorMsg);
        toast({
          title: 'Error',
          description: errorMsg,
          variant: 'destructive',
        });
        return;
      }

      setItems(data);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Network error';
      console.error('Failed to fetch gallery items:', error);
      setFetchError(errorMsg);
      toast({
        title: 'Error',
        description: `Failed to fetch gallery items: ${errorMsg}`,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

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
    if (!selectedFile && !editingItem) {
      toast({
        title: 'Error',
        description: 'Please select an image',
        variant: 'destructive',
      });
      return;
    }

    if (editingItem && !selectedFile) {
      toast({
        title: 'Error',
        description: 'Please select a new image to update this post',
        variant: 'destructive',
      });
      return;
    }

    const authToken = getAuthToken();
    if (!authToken) {
      toast({
        title: 'Error',
        description: 'Not authenticated',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    const formDataWithImage = new FormData();
    if (selectedFile) {
      formDataWithImage.append('image', selectedFile);
    }
    formDataWithImage.append('authToken', authToken);

    // Add captions and date to FormData
    if (formData.captionEn) formDataWithImage.append('captionEn', formData.captionEn);
    if (formData.captionBn) formDataWithImage.append('captionBn', formData.captionBn);
    if (formData.date) formDataWithImage.append('date', formData.date);

    try {
      if (editingItem) {
      // Update existing item
      const result = await updateGalleryImageAction(editingItem.id, formDataWithImage);
      if (result.success && result.galleryItem) {
        setUploadedImageUrl(result.galleryItem.imageUrl);
        toast({
          title: 'Success',
          description: 'Gallery item updated successfully',
        });
        setIsDialogOpen(false);
        resetForm();
        await fetchItems();
          return;
      } else {
        throw new Error(result.error || 'Update failed');
      }
      } else {
      // Create new item
      const result = await uploadGalleryAction(formDataWithImage);
      if (result.success && result.galleryItem) {
        setUploadedImageUrl(result.galleryItem.imageUrl);
        toast({
          title: 'Success',
          description: 'Gallery item created successfully',
        });
        setIsDialogOpen(false);
        resetForm();
        await fetchItems();
          return;
      } else {
        throw new Error(result.error || 'Create failed');
      }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to submit gallery post',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUploadError = (error: string) => {
    toast({
      title: 'Upload Error',
      description: error,
      variant: 'destructive',
    });
  };

  const resetForm = () => {
    setFormData({});
    setUploadedImageUrl(null);
    setSelectedFile(null);
    setEditingItem(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      const authToken = getAuthToken();
      const result = await deleteGalleryAction(id, authToken ?? undefined);

      if (!result.success) throw new Error(result.error || 'Failed to delete');

      toast({
        title: 'Success',
        description: 'Item deleted',
      });

      fetchItems();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete item',
        variant: 'destructive',
      });
    }
  };

  const openEdit = (item: GalleryItem) => {
    setEditingItem(item);
    setUploadedImageUrl(item.imageUrl);
    setFormData({
      captionEn: item.captionEn || '',
      captionBn: item.captionBn || '',
      date: new Date(item.date).toISOString().split('T')[0],
    });
    setIsDialogOpen(true);
  };

  const handleDialogChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      resetForm();
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Gallery Management</h1>
          <p className="text-muted-foreground">Manage your activity gallery images here.</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="h-4 w-4" /> Add New Item
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Gallery Item'}</DialogTitle>
              <DialogDescription>
                Upload an image and add captions to your public gallery.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <ImageUpload
                label="Gallery Image"
                currentImage={uploadedImageUrl || undefined}
                onUpload={handleImageUpload}
                onUploadComplete={(url) => {
                  setUploadedImageUrl(url);
                }}
                onFileSelected={(file) => {
                  setSelectedFile(file);
                }}
                onUploadError={handleUploadError}
                maxSizeMB={10}
                aspectRatio="aspect-video"
                autoUpload={false}
              />
              <div className="space-y-2">
                <Label htmlFor="captionEn">Caption (English)</Label>
                <Input
                  id="captionEn"
                  placeholder="Description in English"
                  value={formData.captionEn || ''}
                  onChange={(e) => setFormData({ ...formData, captionEn: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="captionBn">Caption (Bengali)</Label>
                <Input
                  id="captionBn"
                  placeholder="বাংলায় বিবরণ"
                  value={formData.captionBn || ''}
                  onChange={(e) => setFormData({ ...formData, captionBn: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.date || ''}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {editingItem ? 'Update Post' : 'Submit Post'}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-slate-200 dark:border-slate-800">
        <CardHeader>
          <CardTitle>Gallery Items</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
          ) : fetchError ? (
            <div className="text-center p-12 text-red-500 border-2 border-dashed border-red-200 rounded-lg bg-red-50">
              <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-2">Failed to load gallery</p>
              <p className="text-sm text-red-400 mb-4">{fetchError}</p>
              <Button variant="outline" onClick={() => { setIsLoading(true); fetchItems(); }}>
                Try Again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center p-12 text-muted-foreground border-2 border-dashed rounded-lg">
              <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p>No gallery items found.</p>
              <Button variant="link" onClick={() => setIsDialogOpen(true)}>Add one to get started</Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Image</TableHead>
                    <TableHead>Caption (EN)</TableHead>
                    <TableHead>Caption (BN)</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="relative h-12 w-20 rounded overflow-hidden bg-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.imageUrl} alt="Thumbnail" className="object-cover w-full h-full" />
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{item.captionEn || '-'}</TableCell>
                      <TableCell className="font-bengali">{item.captionBn || '-'}</TableCell>
                      <TableCell>{new Date(item.date).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                            <Edit2 className="h-4 w-4 text-blue-500" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(item.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
