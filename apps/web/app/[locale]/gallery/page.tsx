import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/i18n';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Gallery, GalleryItem } from '@/components/ui/gallery';
import { getPublicSettings } from '@/lib/system-config';
import { getPublicGalleryItems } from '@/lib/public-content';
import { Image as ImageIcon } from 'lucide-react';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { StructuredData } from '@/components/seo/structured-data';

/**
 * WO-73. This page's content changes when an admin edits a setting, which is to
 * say almost never — so it is prerendered and served from the edge instead of
 * opening a Neon connection on every visit. `revalidateTag('system-config')` in
 * the settings `PUT` is what makes an edit appear immediately; this interval is
 * only the backstop.
 */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/gallery',
    title: activeLocale === 'bn' ? 'গ্যালারি' : 'Gallery',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনার কার্যক্রমের ছবি ও স্মৃতিচিত্র দেখুন।'
        : 'Browse photos and highlights from Hasnahena activities.',
  });
}

export default async function GalleryPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as (typeof locales)[number])) {
    notFound();
  }

  setRequestLocale(locale);
  const tGallery = await getTranslations({locale, namespace: 'gallery'});

  // Both accessors fall back to empty rather than rejecting — see the note in
  // lib/system-config.ts.
  const dbGalleryItems = await getPublicGalleryItems();

  const galleryItems: GalleryItem[] = dbGalleryItems.map(item => ({
    id: item.id,
    image: item.imageUrl,
    caption: locale === 'bn' ? (item.captionBn || item.captionEn || '') : (item.captionEn || item.captionBn || ''),
    date: item.date,
    likes: item.likes,
  }));

  const settings = await getPublicSettings();


  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/gallery" settings={settings} />
      <Header settings={settings} />
      <main className="flex-1 min-h-screen bg-slate-50 dark:bg-slate-950 pt-20">
        <div className="container-wide py-12 md:py-20">
            <div className="text-center mb-16 animate-in fade-in slide-in-from-bottom-5 duration-700">
                <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 mb-6 shadow-lg shadow-emerald-500/10">
                <ImageIcon className="h-8 w-8" />
                </div>
                <h1 className="text-4xl md:text-5xl font-bold mb-6 text-slate-900 dark:text-white">
                {tGallery('title')}
                </h1>
                <p className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
                {tGallery('subtitle')}
                </p>
            </div>

            <Gallery items={galleryItems} locale={locale} />
        </div>
      </main>
      <Footer settings={settings} />
    </>
  );
}
