import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { ArrowRight, Briefcase, Calendar, GraduationCap, HandHeart, Heart, Wallet } from 'lucide-react';
import { IconTile, PageBody, PageHero, paperCard } from '@/components/layout/page-hero';
import { Button } from '@/components/ui/button';
import { getPublicSettings } from '@/lib/system-config';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { localePath } from '@/lib/locale-path';
import { StructuredData } from '@/components/seo/structured-data';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  const tSeo = await getTranslations({ locale: activeLocale, namespace: 'seo.pages.activities' });
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/activities',
    title: tSeo('title'),
    description: tSeo('description'),
  });
}

export default async function ActivitiesPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as (typeof locales)[number])) notFound();
  setRequestLocale(locale);

  const activeLocale = normalizeLocale(locale);
  const [t, tPage, tSeo, settings] = await Promise.all([
    getTranslations({ locale, namespace: 'activities' }),
    getTranslations({ locale, namespace: 'pages.activities' }),
    getTranslations({ locale, namespace: 'seo.pages.activities' }),
    getPublicSettings(),
  ]);

  // All six — the home page previews these, so the full page must not show fewer.
  const activities = [
    { key: 'finance', icon: Wallet },
    { key: 'education', icon: GraduationCap },
    { key: 'health', icon: Heart },
    { key: 'charity', icon: HandHeart },
    { key: 'training', icon: Briefcase },
    { key: 'social', icon: Calendar },
  ] as const;

  const activityItems = activities.map(({ key }) => ({
    name: t(`${key}.title`),
    description: t(`${key}.description`),
  }));

  return (
    <>
      <StructuredData
        locale={activeLocale}
        path="/activities"
        settings={settings}
        headline={tSeo('title')}
        description={tSeo('description')}
        activityItems={activityItems}
      />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={tPage('eyebrow')} title={tPage('title')} lead={tPage('lead')} />
        <PageBody className="max-w-6xl space-y-8">
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

          <section className={`${paperCard} p-6 text-center md:p-8`}>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {tPage('ctaTitle')}
            </h2>
            <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-muted-foreground">
              {tPage('ctaBody')}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="gap-1.5">
                <Link href={localePath(locale, '/register')}>
                  {tPage('registerCta')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-1.5">
                <Link href={localePath(locale, '/qard-al-hasan')}>
                  {tPage('qardCta')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-1.5">
                <Link href={localePath(locale, '/donate')}>
                  {tPage('donateCta')}
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-1.5">
                <Link href={localePath(locale, '/gallery')}>
                  {tPage('galleryCta')}
                </Link>
              </Button>
            </div>
          </section>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
