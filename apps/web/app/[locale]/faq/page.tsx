import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { locales, type Locale } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { getPublicSettings } from '@/lib/system-config';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { faqEntries } from '@/lib/faq';
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

  const settings = await getPublicSettings();

  const isBn = locale === 'bn';
  // One source for the questions: this list and the FAQPage structured data
  // must say the same thing, and a rich result whose answer differs from the
  // page is a policy violation rather than a typo. See lib/faq.ts.
  const faqItems = faqEntries(normalizeLocale(locale));

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/faq" settings={settings} />
      <Header settings={settings} />
      <main className="min-h-screen bg-slate-50 dark:bg-slate-950 pt-24 pb-16">
        <div className="container-wide max-w-4xl">
          <div className="mb-8 flex items-center justify-between">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <HelpCircle className="h-7 w-7 text-emerald-600" />
              {isBn ? 'সাধারণ প্রশ্নাবলী' : 'Frequently Asked Questions'}
            </h1>
            <Link href={`/${locale}`}>
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                {isBn ? 'হোমে ফিরুন' : 'Back to Home'}
              </Button>
            </Link>
          </div>

          <div className="space-y-4">
            {faqItems.map((item) => (
              <article key={item.q} className="rounded-xl border bg-white p-5 shadow-xs dark:bg-slate-900">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{item.q}</h2>
                <p className="mt-2 text-slate-600 dark:text-slate-300">{item.a}</p>
              </article>
            ))}
          </div>
        </div>
      </main>
      <Footer settings={settings} />
    </>
  );
}
