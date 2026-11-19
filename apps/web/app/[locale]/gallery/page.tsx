import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { locales } from '@/i18n';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Gallery, GalleryItem } from '@/components/ui/gallery';
import { Button } from '@/components/ui/button';
import { getPublicSettings } from '@/lib/system-config';
import { getPublicGalleryItems } from '@/lib/public-content';
import { PageBody, PageHero } from '@/components/layout/page-hero';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { localePath } from '@/lib/locale-path';
import { StructuredData } from '@/components/seo/structured-data';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  const tSeo = await getTranslations({ locale: activeLocale, namespace: 'seo.pages.gallery' });
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/gallery',
    title: tSeo('title'),
    description: tSeo('description'),
  });
}

export default async function GalleryPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as (typeof locales)[number])) {
    notFound();
  }

  setRequestLocale(locale);
  const activeLocale = normalizeLocale(locale);

  // Both accessors fall back to empty rather than rejecting — see the note in
  // lib/system-config.ts.
  const [tGallery, tNav, tPage, tSeo, dbGalleryItems, settings] = await Promise.all([
    getTranslations({ locale, namespace: 'gallery' }),
    getTranslations({ locale, namespace: 'navigation' }),
    getTranslations({ locale, namespace: 'pages.gallery' }),
    getTranslations({ locale, namespace: 'seo.pages.gallery' }),
    getPublicGalleryItems(),
    getPublicSettings(),
  ]);

  const galleryItems: GalleryItem[] = dbGalleryItems.map((item) => ({
    id: item.id,
    image: item.imageUrl,
    caption:
      locale === 'bn'
        ? item.captionBn || item.captionEn || ''
        : item.captionEn || item.captionBn || '',
    date: item.date,
    likes: item.likes,
  }));

  const schemaGalleryItems = galleryItems.map((item) => ({
    imageUrl: item.image,
    caption: item.caption || undefined,
    date: item.date,
  }));

  return (
    <>
      <StructuredData
        locale={activeLocale}
        path="/gallery"
        settings={settings}
        headline={tSeo('title')}
        description={tSeo('description')}
        galleryItems={schemaGalleryItems}
      />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={tNav('gallery')} title={tGallery('title')} lead={tGallery('subtitle')} />
        <PageBody className="space-y-10">
          <Gallery items={galleryItems} locale={locale} />

          <div className="flex flex-wrap items-center justify-center gap-3 text-center">
            <Button asChild variant="outline" className="gap-1.5">
              <Link href={localePath(locale, '/activities')}>
                {tPage('activitiesLink')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild className="gap-1.5">
              <Link href={localePath(locale, '/donate')}>
                {tPage('donateLink')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
