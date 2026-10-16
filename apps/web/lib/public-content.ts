/**
 * The gallery, cached per revalidation window (WO-73). Every writer must call
 * revalidateTag(GALLERY_TAG).
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/prisma';

/** Cache tag every gallery read shares. Invalidated whenever an item is written. */
export const GALLERY_TAG = 'gallery';

/**
 * What public pages render. `date` is an ISO STRING: unstable_cache returns a
 * Date as a string on a hit, so normalise at the boundary.
 */
export type PublicGalleryItem = {
  id: number;
  imageUrl: string;
  captionEn: string | null;
  captionBn: string | null;
  date: string;
  likes: number;
};

/** Most recent items, newest first; `limit` is part of the cache key. */
export async function getPublicGalleryItems(limit?: number): Promise<PublicGalleryItem[]> {
  try {
    return await getCachedGalleryItems(limit ?? 0);
  } catch (error) {
    // As getPublicSettings: render without a database; catch outside the cache.
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
