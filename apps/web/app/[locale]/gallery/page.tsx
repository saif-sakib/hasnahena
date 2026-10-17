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
import { PageBody, PageHero } from '@/components/layout/page-hero';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { StructuredData } from '@/components/seo/structured-data';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
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
  const tNav = await getTranslations({ locale, namespace: 'navigation' });

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
      <main className="surface-paper flex-1">
        <PageHero eyebrow={tNav('gallery')} title={tGallery('title')} lead={tGallery('subtitle')} />
        <PageBody>
          <Gallery items={galleryItems} locale={locale} />
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
