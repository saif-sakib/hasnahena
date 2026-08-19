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
  const faqItems = isBn
    ? [
        {
          q: 'কিভাবে সদস্য হবো?',
          a: 'নিবন্ধন ফর্ম পূরণ করে প্রয়োজনীয় নথি আপলোড করুন। অনুমোদনের পর আপনি সদস্যপদ পাবেন।',
        },
        {
          q: 'ঋণের উপর কি সুদ দিতে হবে?',
          a: 'না। আমাদের সকল ঋণ কর্জে হাসানা নীতিতে সম্পূর্ণ সুদমুক্ত।',
        },
        {
          q: 'জমা টাকা উত্তোলন করা যাবে?',
          a: 'হ্যাঁ। তবে উত্তোলনের জন্য অন্তত ৩ মাস আগে কর্তৃপক্ষকে জানাতে হবে।',
        },
        {
          q: 'ঋণের জন্য যোগ্যতা কীভাবে নির্ধারিত হয়?',
          a: 'আপনার নিয়মিত জমা, সদস্যপদের অবস্থা এবং প্রশাসনিক যাচাই অনুযায়ী ঋণ যোগ্যতা নির্ধারিত হয়।',
        },
      ]
    : [
        {
          q: 'How can I become a member?',
          a: 'Complete the registration form and upload the required documents. Your membership is activated after approval.',
        },
        {
          q: 'Do I have to pay interest on loans?',
          a: 'No. All loans are fully interest-free under Qard al-Hasan principles.',
        },
        {
          q: 'Can I withdraw my deposited funds?',
          a: 'Yes. A minimum 3-month prior notice is required before withdrawal.',
        },
        {
          q: 'How is loan eligibility determined?',
          a: 'Eligibility is determined by your deposit behavior, membership status, and administrative review.',
        },
      ];

  return (
    <>
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
