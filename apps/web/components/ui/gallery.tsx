"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

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
 * The public photo gallery (home page and /gallery). The lightbox is portalled
 * into document.body (a parent stacking context once trapped it under the
 * header), keyboard-operable with named controls. No like button — nothing
 * stores likes.
 */
export function Gallery({ items, locale }: GalleryProps) {
  const t = useTranslations("gallery");
  const tA11y = useTranslations("dashboard.a11y");
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  const handleImageError = (id: number) => {
    setFailedImages((prev) => new Set(prev).add(id));
  };

  const closeLightbox = useCallback(() => setSelectedImage(null), []);
  const goToPrevious = useCallback(
    () =>
      setSelectedImage((current) =>
        current !== null && current > 0 ? current - 1 : current,
      ),
    [],
  );
  const goToNext = useCallback(
    () =>
      setSelectedImage((current) =>
        current !== null && current < items.length - 1 ? current + 1 : current,
      ),
    [items.length],
  );

  // Escape closes and arrows move; the page underneath is held still.
  useEffect(() => {
    if (selectedImage === null) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selectedImage]);

  useEffect(() => {
    if (selectedImage === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowLeft") goToPrevious();
      if (event.key === "ArrowRight") goToNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedImage, closeLightbox, goToPrevious, goToNext]);

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString(locale === "bn" ? "bn-BD" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {t("noImages")}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item, index) => (
          <Card
            key={item.id}
            className="overflow-hidden group hover:shadow-xl transition-all duration-300 border-slate-200 dark:border-slate-700"
          >
            {/* A real <button>: keyboard- and screen-reader-reachable, named by the caption. */}
            <button
              type="button"
              className="block w-full text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => setSelectedImage(index)}
              aria-label={t("openImage", {
                caption: item.caption || formatDate(item.date),
              })}
            >
              <div className="relative aspect-4/3 overflow-hidden bg-slate-100 dark:bg-slate-800">
                {failedImages.has(item.id) ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                    <ImageOff className="h-10 w-10 mb-2" />
                    <span className="text-xs">{t("imageFailed")}</span>
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
              <p className="text-sm text-muted-foreground mb-2">
                {formatDate(item.date)}
              </p>
              <p className="font-medium line-clamp-2 text-slate-800 dark:text-slate-200">
                {item.caption}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Lightbox, portalled; selectedImage starts null, so SSR renders nothing here. */}
      {selectedImage !== null &&
        createPortal(
          <div
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xs"
            onClick={closeLightbox}
            role="dialog"
            aria-modal="true"
            aria-label={t("title")}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 z-20 rounded-full text-white hover:bg-white/20"
              onClick={closeLightbox}
              aria-label={tA11y("close")}
            >
              <X className="h-6 w-6" />
            </Button>

            {selectedImage > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-3 z-20 rounded-full text-white hover:bg-white/20 md:left-6"
                onClick={(e) => {
                  e.stopPropagation();
                  goToPrevious();
                }}
                aria-label={t("previousImage")}
              >
                <ChevronLeft className="h-8 w-8" />
              </Button>
            )}

            {selectedImage < items.length - 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-3 z-20 rounded-full text-white hover:bg-white/20 md:right-6"
                onClick={(e) => {
                  e.stopPropagation();
                  goToNext();
                }}
                aria-label={t("nextImage")}
              >
                <ChevronRight className="h-8 w-8" />
              </Button>
            )}

            {/* Definite height for next/image `fill`; dvh, since Android's vh includes the address bar. */}
            <div
              className="relative w-full max-w-5xl overflow-hidden rounded-sm border border-white/10 bg-slate-950/80 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative h-[55dvh] w-full bg-black md:h-[72dvh]">
                <Image
                  src={items[selectedImage].image}
                  alt={items[selectedImage].caption}
                  fill
                  sizes="100vw"
                  className="object-contain"
                />
              </div>
              <div className="px-4 py-4 text-white md:px-6">
                <p className="text-base font-semibold md:text-lg">
                  {items[selectedImage].caption}
                </p>
                <p className="mt-1 text-xs text-white/70 md:text-sm">
                  {formatDate(items[selectedImage].date)}
                </p>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
