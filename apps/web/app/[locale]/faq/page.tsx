import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales, type Locale } from '@/i18n';
import { PageBody, PageHero, paperCard } from '@/components/layout/page-hero';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { getPublicSettings } from '@/lib/system-config';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { faqEntries, noticePeriodDaysFrom } from '@/lib/faq';
import { StructuredData } from '@/components/seo/structured-data';
import { localePath } from '@/lib/locale-path';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/faq',
    title: activeLocale === 'bn' ? 'সাধারণ প্রশ্নাবলী' : 'Frequently Asked Questions',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনা সম্পর্কে সাধারণ প্রশ্ন ও উত্তর। সদস্যপদ, ঋণ, জমা এবং নীতিমালা জানুন।'
        : 'Frequently asked questions about Hasnahena, including membership, deposits, loans, and policies.',
  });
}

export default async function FaqPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const settings = await getPublicSettings();
  const t = await getTranslations({ locale, namespace: 'pages.faq' });

  // One source for the questions: this list and the FAQPage structured data
  // must say the same thing, and a rich result whose answer differs from the
  // page is a policy violation rather than a typo. See lib/faq.ts.
  const faqItems = faqEntries(normalizeLocale(locale), noticePeriodDaysFrom(settings));

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/faq" settings={settings} />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={t('eyebrow')} title={t('title')} />
        <PageBody className="max-w-3xl">
          <div className={`${paperCard} divide-y divide-slate-100 dark:divide-slate-800`}>
            {faqItems.map((item) => (
              <article key={item.q} className="p-6">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{item.q}</h2>
                <p className="mt-2 leading-relaxed text-muted-foreground">{item.a}</p>
              </article>
            ))}
          </div>

          <p className="mt-8 text-center text-muted-foreground">
            {t('moreQuestions')}{' '}
            <Link
              href={localePath(locale, '/contact')}
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('contactUs')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </p>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
