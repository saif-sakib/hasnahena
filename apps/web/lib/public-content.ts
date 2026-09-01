/**
 * The gallery, read once per revalidation window rather than once per visit.
 *
 * WO-73's other half. Caching `system_config` alone would have left `/` and
 * `/gallery` dynamic — they read `galleryItem` too — and a marketing site where
 * six of eight pages are static and the two most-visited ones are not is the
 * shape of a job that looks finished and is not.
 *
 * Lives here rather than in `lib/system-config.ts` because that file is the
 * *key registry* first: it is imported by a unit test and by the settings route
 * for its allow-list, and `galleryItem` has nothing to do with either.
 *
 * The gallery is written from three places — the admin settings screen's upload
 * action, `app/actions/upload-gallery.ts`, and `PUT`/`DELETE` on
 * `/api/v1/gallery`. Every one of them calls `revalidateTag(GALLERY_TAG)`; an
 * admin who adds a photo and cannot see it on the homepage will assume the
 * upload failed and do it again.
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/prisma';

/** Cache tag every gallery read shares. Invalidated whenever an item is written. */
export const GALLERY_TAG = 'gallery';

/**
 * The shape the public pages actually render — not the whole row.
 *
 * `date` is an ISO **string**, not a `Date`, and that is the important part.
 * `unstable_cache` serialises what it stores, so a `Date` comes back from a
 * cache *hit* as a string while a cache *miss* returns the real thing. Typing
 * it as `Date` compiled cleanly and then crashed the build with
 * `item.date.toISOString is not a function` — on the second render, never the
 * first, which is the shape of bug that reaches production having passed every
 * local check. Normalise at the boundary so there is only one type.
 */
export type PublicGalleryItem = {
  id: number;
  imageUrl: string;
  captionEn: string | null;
  captionBn: string | null;
  date: string;
  likes: number;
};

/**
 * The most recent gallery items, newest first.
 *
 * `limit` is part of the cache key, so the homepage's six and the gallery
 * page's full set are separate entries under the same tag — one write
 * invalidates both.
 */
export async function getPublicGalleryItems(limit?: number): Promise<PublicGalleryItem[]> {
  try {
    return await getCachedGalleryItems(limit ?? 0);
  } catch (error) {
    // Same contract as `getPublicSettings()`, and for the same reason: `/` and
    // `/gallery` are prerendered, and the Docker build has no database to
    // prerender them against. An empty gallery is a page; a thrown error is a
    // failed image build. See the longer note in lib/system-config.ts for why
    // this `catch` sits outside the cache rather than inside it.
    console.error('Gallery unavailable; rendering an empty gallery:', error);
    return [];
  }
}

const getCachedGalleryItems = unstable_cache(
  async (limit: number): Promise<PublicGalleryItem[]> => {
    const rows = await prisma.galleryItem.findMany({
      orderBy: { date: 'desc' },
      ...(limit > 0 ? { take: limit } : {}),
      select: {
        id: true,
        imageUrl: true,
        captionEn: true,
        captionBn: true,
        date: true,
        likes: true,
      },
    });
    return rows.map((row) => ({ ...row, date: row.date.toISOString() }));
  },
  ['public-gallery'],
  { tags: [GALLERY_TAG], revalidate: 3600 },
);
