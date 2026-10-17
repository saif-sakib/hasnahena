import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Briefcase, Calendar, GraduationCap, HandHeart, Heart, Wallet } from 'lucide-react';
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
    path: '/activities',
    title: activeLocale === 'bn' ? 'আমাদের কার্যক্রম' : 'Our Activities',
    description:
      activeLocale === 'bn'
        ? 'সুদমুক্ত ঋণ, শিক্ষা সহায়তা ও সামাজিক উন্নয়নে হাসনাহেনার কার্যক্রম দেখুন।'
        : 'Explore Hasnahena activities in interest-free finance, education support, and social welfare.',
  });
}

export default async function ActivitiesPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as any)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'activities' });
  const tPage = await getTranslations({ locale, namespace: 'pages.activities' });
  const settings = await getPublicSettings();

  // All six — the home page previews these, so the full page must not show fewer.
  const activities = [
    { key: 'finance', icon: Wallet },
    { key: 'education', icon: GraduationCap },
    { key: 'health', icon: Heart },
    { key: 'charity', icon: HandHeart },
    { key: 'training', icon: Briefcase },
    { key: 'social', icon: Calendar },
  ] as const;

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/activities" settings={settings} />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={tPage('eyebrow')} title={tPage('title')} lead={tPage('lead')} />
        <PageBody className="max-w-6xl">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {activities.map(({ key, icon: Icon }) => (
              <article key={key} className={`${paperCard} p-6`}>
                <IconTile>
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </IconTile>
                <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">{t(`${key}.title`)}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{t(`${key}.description`)}</p>
              </article>
            ))}
          </div>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
