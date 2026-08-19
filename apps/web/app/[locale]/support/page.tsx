import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, HeadphonesIcon, Mail, Phone, MessageCircle } from 'lucide-react';
import { locales, type Locale } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { getPublicSettings } from '@/lib/system-config';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
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
    path: '/support',
    title: activeLocale === 'bn' ? 'সহায়তা ও সাপোর্ট' : 'Support Center',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনার সহায়তা পেতে ফোন, ইমেইল বা সরাসরি অফিসে যোগাযোগ করুন।'
        : 'Get support from Hasnahena via phone, email, or by visiting the office.',
  });
}

export default async function SupportPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  const settings = await getPublicSettings();

  const isBn = locale === 'bn';
  // WO-67. The `settings['contact.*']` second choice is gone: those keys were
  // never declared in SYSTEM_CONFIG_KEYS, so no admin could ever set one and the
  // branch was unreachable. `org.*` is declared, seeded, and printed on every
  // generated document.
  const supportEmail = settings['org.email']?.trim() || '';
  const supportPhone = settings['org.phone']?.trim() || '';
  const supportAddress = settings['org.address']?.trim() || '';

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/support" settings={settings} />
      <Header settings={settings} />
      <main className="min-h-screen bg-slate-50 dark:bg-slate-950 pt-24 pb-16">
        <div className="container-wide max-w-4xl">
          <div className="mb-8 flex items-center justify-between">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <HeadphonesIcon className="h-7 w-7 text-emerald-600" />
              {isBn ? 'সহায়তা ও সাপোর্ট' : 'Support Center'}
            </h1>
            <Link href={`/${locale}`}>
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                {isBn ? 'হোমে ফিরুন' : 'Back to Home'}
              </Button>
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-xl border bg-white p-5 shadow-xs dark:bg-slate-900">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <Phone className="h-5 w-5" />
              </div>
              <h2 className="font-semibold text-slate-900 dark:text-white">{isBn ? 'ফোন সাপোর্ট' : 'Phone Support'}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{supportPhone}</p>
            </article>

            <article className="rounded-xl border bg-white p-5 shadow-xs dark:bg-slate-900">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <Mail className="h-5 w-5" />
              </div>
              <h2 className="font-semibold text-slate-900 dark:text-white">{isBn ? 'ইমেইল সাপোর্ট' : 'Email Support'}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{supportEmail}</p>
            </article>

            <article className="rounded-xl border bg-white p-5 shadow-xs dark:bg-slate-900">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <MessageCircle className="h-5 w-5" />
              </div>
              <h2 className="font-semibold text-slate-900 dark:text-white">{isBn ? 'অফিস ভিজিট' : 'Office Visit'}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{supportAddress}</p>
            </article>
          </div>
        </div>
      </main>
      <Footer settings={settings} />
    </>
  );
}
