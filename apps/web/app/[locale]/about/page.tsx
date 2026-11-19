import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { ArrowRight, Goal, Target, Heart, ShieldCheck, Landmark } from 'lucide-react';
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
  const tSeo = await getTranslations({ locale: activeLocale, namespace: 'seo.pages.about' });
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/about',
    title: tSeo('title'),
    description: tSeo('description'),
  });
}

export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as (typeof locales)[number])) notFound();
  setRequestLocale(locale);

  const activeLocale = normalizeLocale(locale);
  const [settings, t, tSeo] = await Promise.all([
    getPublicSettings(),
    getTranslations({ locale, namespace: 'pages.about' }),
    getTranslations({ locale, namespace: 'seo.pages.about' }),
  ]);

  const regNumber = settings['org.regNumber']?.trim();

  const pillars = [
    { key: 'vision', icon: Target },
    { key: 'mission', icon: Goal },
    { key: 'values', icon: Heart },
  ] as const;

  const exploreLinks = [
    { href: '/qard-al-hasan', label: t('qardCta') },
    { href: '/activities', label: t('activitiesCta') },
    { href: '/donate', label: t('donateCta') },
    { href: '/faq', label: t('faqCta') },
    { href: '/contact', label: t('contactCta') },
  ] as const;

  return (
    <>
      <StructuredData
        locale={activeLocale}
        path="/about"
        settings={settings}
        headline={tSeo('title')}
        description={tSeo('description')}
      />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
        <PageBody className="max-w-6xl space-y-8">
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

          <div className="grid gap-6 md:grid-cols-2">
            <section className={`${paperCard} p-6 md:p-8`}>
              <IconTile>
                <Landmark className="h-6 w-6" aria-hidden="true" />
              </IconTile>
              <h2 className="mb-3 text-xl font-semibold text-slate-900 dark:text-white">
                {t('modelTitle')}
              </h2>
              <p className="leading-relaxed text-muted-foreground">{t('modelBody1')}</p>
              <p className="mt-3 leading-relaxed text-muted-foreground">{t('modelBody2')}</p>
            </section>

            <section className={`${paperCard} p-6 md:p-8`}>
              <IconTile>
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              </IconTile>
              <h2 className="mb-3 text-xl font-semibold text-slate-900 dark:text-white">
                {t('trustTitle')}
              </h2>
              <p className="leading-relaxed text-muted-foreground">{t('trustBody1')}</p>
              <p className="mt-3 leading-relaxed text-muted-foreground">{t('trustBody2')}</p>
              {regNumber && (
                <p className="mt-4 inline-flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-sm font-medium text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <span>{t('regNumberLabel')}:</span>
                  <span className="font-mono">{regNumber}</span>
                </p>
              )}
            </section>
          </div>

          <section className={`${paperCard} p-6 text-center md:p-8`}>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {t('exploreTitle')}
            </h2>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {exploreLinks.map((item) => (
                <Button key={item.href} asChild variant="outline" size="sm" className="gap-1.5">
                  <Link href={localePath(locale, item.href)}>
                    {item.label}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              ))}
            </div>
          </section>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
