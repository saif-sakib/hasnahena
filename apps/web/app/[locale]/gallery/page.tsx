import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/i18n';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Gallery, GalleryItem } from '@/components/ui/gallery';
import { prisma } from '@/lib/prisma';
import { Image as ImageIcon } from 'lucide-react';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';

type PageProps = { params: { locale: string } };

export function generateMetadata({ params: { locale } }: PageProps): Metadata {
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

export default async function GalleryPage({ params: { locale } }: PageProps) {
  if (!locales.includes(locale as (typeof locales)[number])) {
    notFound();
  }

  unstable_setRequestLocale(locale);
  const tGallery = await getTranslations({locale, namespace: 'gallery'});

  // Fetch gallery items from DB
  let dbGalleryItems: any[] = [];
  try {
      dbGalleryItems = await prisma.galleryItem.findMany({
        orderBy: { date: 'desc' },
      });
  } catch (e) {
      console.error("Failed to fetch gallery items", e);
  }

  const galleryItems: GalleryItem[] = dbGalleryItems.map(item => ({
    id: item.id,
    image: item.imageUrl,
    caption: locale === 'bn' ? (item.captionBn || item.captionEn || '') : (item.captionEn || item.captionBn || ''),
    date: item.date.toISOString(),
    likes: item.likes,
  }));

  // Fetch settings for Header
  let settings: Record<string, string> = {};
  try {
    const settingsResult = await prisma.systemConfig.findMany();
    settings = settingsResult.reduce((acc: any, config) => {
      acc[config.key] = config.value;
      return acc;
    }, {} as Record<string, string>);
  } catch (e) {
    console.error("Failed to fetch settings", e);
  }


  return (
    <>
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
