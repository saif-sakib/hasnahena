import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Goal, Target, Heart } from 'lucide-react';
import { IconTile, PageBody, PageHero, paperCard } from '@/components/layout/page-hero';
import { getPublicSettings } from '@/lib/system-config';
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
    path: '/about',
    title: activeLocale === 'bn' ? 'আমাদের সম্পর্কে' : 'About Hasnahena',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনার লক্ষ্য, উদ্দেশ্য ও মূল্যবোধ সম্পর্কে জানুন।'
        : 'Learn about Hasnahena’s mission, vision, and community-driven values.',
  });
}

export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as any)) notFound();
  setRequestLocale(locale);

  const settings = await getPublicSettings();
  const t = await getTranslations({ locale, namespace: 'pages.about' });

  const pillars = [
    { key: 'vision', icon: Target },
    { key: 'mission', icon: Goal },
    { key: 'values', icon: Heart },
  ] as const;

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/about" settings={settings} />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
        <PageBody className="max-w-6xl">
          <div className="grid gap-6 md:grid-cols-3">
            {pillars.map(({ key, icon: Icon }) => (
              <article key={key} className={`${paperCard} p-6 md:p-8`}>
                <IconTile>
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </IconTile>
                <h2 className="mb-2 text-xl font-semibold text-slate-900 dark:text-white">{t(`${key}.title`)}</h2>
                <p className="leading-relaxed text-muted-foreground">{t(`${key}.body`)}</p>
              </article>
            ))}
          </div>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
