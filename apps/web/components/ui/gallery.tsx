'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Heart, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export interface GalleryItem {
  id: string;
  image: string;
  caption: string;
  date: string;
  likes?: number;
}

interface GalleryProps {
  items: GalleryItem[];
  locale: string;
}

export function Gallery({ items, locale }: GalleryProps) {
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [likedItems, setLikedItems] = useState<Set<string>>(new Set());

  const { toast } = useToast();

  const checkAuth = () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
    return !!token;
  };

  const handleLike = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!checkAuth()) {
      toast({
        title: locale === 'bn' ? 'লগইন প্রয়োজন' : 'Login Required',
        description: locale === 'bn' 
          ? 'অনুগ্রহ করে লাইক দিতে লগইন করুন' 
          : 'Please login to like this post',
        variant: 'destructive',
      });
      return;
    }

    setLikedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const openLightbox = (index: number) => {
    setSelectedImage(index);
  };

  const closeLightbox = () => {
    setSelectedImage(null);
  };

  const goToPrevious = () => {
    if (selectedImage !== null && selectedImage > 0) {
      setSelectedImage(selectedImage - 1);
    }
  };

  const goToNext = () => {
    if (selectedImage !== null && selectedImage < items.length - 1) {
      setSelectedImage(selectedImage + 1);
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {locale === 'bn' ? 'এখনও কোন ছবি যোগ করা হয়নি' : 'No images added yet'}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map((item, index) => (
          <Card
            key={item.id}
            className="overflow-hidden cursor-pointer group hover:shadow-xl transition-all duration-300 border-slate-200 dark:border-slate-700"
            onClick={() => openLightbox(index)}
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-slate-800">
              <Image
                src={item.image}
                alt={item.caption}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground mb-2">
                {new Date(item.date).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
              <p className="font-medium line-clamp-2 text-slate-800 dark:text-slate-200">
                {item.caption}
              </p>
              <div className="flex items-center mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`gap-1.5 h-8 px-2 ${likedItems.has(item.id) ? 'text-red-500' : 'text-muted-foreground'}`}
                  onClick={(e) => handleLike(item.id, e)}
                >
                  <Heart className={`h-4 w-4 ${likedItems.has(item.id) ? 'fill-current' : ''}`} />
                  <span className="text-xs">{(item.likes || 0) + (likedItems.has(item.id) ? 1 : 0)}</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Lightbox Modal */}
      {selectedImage !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
          onClick={closeLightbox}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white hover:bg-white/20 z-20 rounded-full"
            onClick={closeLightbox}
          >
            <X className="h-6 w-6" />
          </Button>

          {selectedImage > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-3 md:left-6 text-white hover:bg-white/20 z-20 rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                goToPrevious();
              }}
            >
              <ChevronLeft className="h-8 w-8" />
            </Button>
          )}

          {selectedImage < items.length - 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 md:right-6 text-white hover:bg-white/20 z-20 rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
            >
              <ChevronRight className="h-8 w-8" />
            </Button>
          )}

          <div
            className="w-full max-w-5xl relative rounded-2xl overflow-hidden bg-slate-950/80 border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative w-full h-[55vh] md:h-[72vh] bg-black">
              <Image
                src={items[selectedImage].image}
                alt={items[selectedImage].caption}
                fill
                className="object-contain"
              />
            </div>
            <div className="px-4 md:px-6 py-4 text-white">
              <p className="text-base md:text-lg font-semibold">{items[selectedImage].caption}</p>
              <p className="text-xs md:text-sm text-white/70 mt-1">
                {new Date(items[selectedImage].date).toLocaleDateString(
                  locale === 'bn' ? 'bn-BD' : 'en-US',
                  { year: 'numeric', month: 'long', day: 'numeric' }
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
