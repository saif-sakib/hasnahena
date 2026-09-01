'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';

export interface GalleryItem {
  id: number;
  image: string;
  caption: string;
  date: string;
  likes?: number;
}

interface GalleryProps {
  items: GalleryItem[];
  locale: string;
}

/**
 * The public photo gallery, on the home page and on `/gallery`.
 *
 * Two things this used to do that it does not any more, both found by the T-09
 * audit:
 *
 *  1. **A Like button that liked nothing.** No endpoint in either backend
 *     accepts a like — `likes` is a column an admin sets and nothing else
 *     writes. The heart filled, the count went up by one in the DOM, and a
 *     reload discarded it. For a signed-out visitor it went further and raised
 *     a red "Login Required" toast, advertising a members' feature that does
 *     not exist. A control that does nothing is worse than no control, because
 *     it will eventually be trusted — the same rule
 *     `UNIMPLEMENTED_CONFIG_KEYS` states for settings.
 *  2. **A lightbox reachable only by mouse.** The card was a `<div>` with an
 *     `onClick`, so nothing opened it from a keyboard; once open there was no
 *     Escape, and the close, previous and next buttons were icons with no
 *     accessible name. `accessibility.spec.ts` could not see any of it, because
 *     it can only inspect what is rendered and the lightbox starts closed.
 */
export function Gallery({ items, locale }: GalleryProps) {
  const t = useTranslations('gallery');
  const tA11y = useTranslations('dashboard.a11y');
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  const handleImageError = (id: number) => {
    setFailedImages((prev) => new Set(prev).add(id));
  };

  const closeLightbox = useCallback(() => setSelectedImage(null), []);
  const goToPrevious = useCallback(
    () => setSelectedImage((current) => (current !== null && current > 0 ? current - 1 : current)),
    [],
  );
  const goToNext = useCallback(
    () =>
      setSelectedImage((current) =>
        current !== null && current < items.length - 1 ? current + 1 : current,
      ),
    [items.length],
  );

  // Escape closes, the arrow keys move. Without this the only way out of the
  // lightbox on a keyboard was the browser's back button, which leaves the
  // page — and on a phone the hardware back button does the same thing, so this
  // is not only a desktop concern.
  useEffect(() => {
    if (selectedImage === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLightbox();
      if (event.key === 'ArrowLeft') goToPrevious();
      if (event.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedImage, closeLightbox, goToPrevious, goToNext]);

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  if (items.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">{t('noImages')}</div>;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item, index) => (
          <Card
            key={item.id}
            className="overflow-hidden group hover:shadow-xl transition-all duration-300 border-slate-200 dark:border-slate-700"
          >
            {/*
              A real <button> around the image, not an onClick on the card. It
              is what makes the lightbox reachable by keyboard and by a switch
              device, and it is what gives the control a name for a screen
              reader — the caption, which is the only thing that distinguishes
              one photo from the next.
            */}
            <button
              type="button"
              className="block w-full text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => setSelectedImage(index)}
              aria-label={t('openImage', { caption: item.caption || formatDate(item.date) })}
            >
              <div className="relative aspect-4/3 overflow-hidden bg-slate-100 dark:bg-slate-800">
                {failedImages.has(item.id) ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                    <ImageOff className="h-10 w-10 mb-2" />
                    <span className="text-xs">{t('imageFailed')}</span>
                  </div>
                ) : (
                  <Image
                    src={item.image}
                    alt={item.caption}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={() => handleImageError(item.id)}
                  />
                )}
                <div className="absolute inset-0 bg-linear-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>
            </button>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground mb-2">{formatDate(item.date)}</p>
              <p className="font-medium line-clamp-2 text-slate-800 dark:text-slate-200">
                {item.caption}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Lightbox */}
      {selectedImage !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 md:p-4"
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
          aria-label={t('title')}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white hover:bg-white/20 z-20 rounded-full"
            onClick={closeLightbox}
            aria-label={tA11y('close')}
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
              aria-label={t('previousImage')}
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
              aria-label={t('nextImage')}
            >
              <ChevronRight className="h-8 w-8" />
            </Button>
          )}

          <div
            className="w-full max-w-5xl relative rounded-sm overflow-hidden bg-slate-950/80 border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative w-full h-[55vh] md:h-[72vh] bg-black">
              <Image
                src={items[selectedImage].image}
                alt={items[selectedImage].caption}
                fill
                sizes="100vw"
                className="object-contain"
              />
            </div>
            <div className="px-4 md:px-6 py-4 text-white">
              <p className="text-base md:text-lg font-semibold">{items[selectedImage].caption}</p>
              <p className="text-xs md:text-sm text-white/70 mt-1">
                {formatDate(items[selectedImage].date)}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
