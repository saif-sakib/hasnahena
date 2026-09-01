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
 *  3. **A lightbox that only escaped its page by luck.** `fixed inset-0 z-50`
 *     spans the viewport only when no ancestor has made itself the containing
 *     block or opened a stacking context. On `/gallery` nothing does, so it
 *     worked. On the home page the same component sits inside
 *     `<section class="relative overflow-hidden">` > `<div class="relative
 *     z-10">`, and that `z-10` is a stacking context: the overlay's `z-50`
 *     became 50-within-10, so the `fixed z-50` header painted over it and the
 *     section's `overflow-hidden` clipped what was left. It is rendered into
 *     `document.body` through a portal now, which is the only version that
 *     cannot be broken by whatever a page wraps the grid in.
 *  2. **A lightbox reachable only by mouse.** The card was a `<div>` with an
 *     `onClick`, so nothing opened it from a keyboard; once open there was no
 *     Escape, and the close, previous and next buttons were icons with no
 *     accessible name. `accessibility.spec.ts` could not see any of it, because
 *     it can only inspect what is rendered and the lightbox starts closed.
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

  // Escape closes, the arrow keys move. Without this the only way out of the
  // lightbox on a keyboard was the browser's back button, which leaves the
  // page — and on a phone the hardware back button does the same thing, so this
  // is not only a desktop concern.
  // Hold the page still while the lightbox is up. Without this a phone scrolls
  // the gallery underneath the overlay, and closing it leaves the reader
  // somewhere they never chose to be.
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

      {/* Lightbox — rendered into document.body, see the note above. */}
      {/*
        No mounted flag is needed to make the portal safe for the server:
        selectedImage starts null, so this renders on the server and through
        hydration as nothing, and only a click can reach createPortal — by
        which point there is a document to portal into.
      */}
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

            {/*
              The image area needs a definite height because next/image `fill`
              is absolutely positioned and contributes none. dvh rather than vh:
              on Android the address bar makes vh taller than what is actually
              on screen, which pushed the caption off the bottom of the phone
              this site is mostly read on.
            */}
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
