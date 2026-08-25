import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Mail, Phone, MapPin, Send } from 'lucide-react';
import { getPublicSettings } from '@/lib/system-config';
import { orgAddress } from '@/lib/org-address';
import { Button } from '@/components/ui/button';
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
    path: '/contact',
    title: activeLocale === 'bn' ? 'যোগাযোগ' : 'Contact Us',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনার সাথে যোগাযোগের ঠিকানা, ফোন এবং ইমেইল তথ্য।'
        : 'Reach Hasnahena through phone, email, and office address details.',
  });
}

export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as any)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale });
  const settings = await getPublicSettings();

  // WO-67. These used to read `contact.phone` / `contact.email` /
  // `contact.address` — three keys that were never in SYSTEM_CONFIG_KEYS, so
  // `PUT /api/v1/settings` would reject them and no admin screen offered them.
  // The `|| 'literal'` fallbacks were therefore the only values this page could
  // ever show, and one of them was `contact@example.com` presented as the
  // foundation's email address.
  //
  // `org.*` is the answer rather than declaring three more keys: those are
  // already declared, already seeded with the real details, and already what the
  // letterhead on every generated document uses. A second copy of the
  // organisation's address is the ADR-023 shape — two places for one fact, kept
  // equal by hand.
  const orgPhone = settings['org.phone']?.trim() || '';
  const orgEmail = settings['org.email']?.trim() || '';
  // Not `settings['org.address']`: one box, two audiences — see orgAddress().
  const address = orgAddress(settings, locale);

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/contact" settings={settings} />
      <Header settings={settings} />
      <main className="flex-1 bg-zinc-50 dark:bg-zinc-950 pt-32 pb-24 z-10 w-full flex flex-col items-center">
        <div className="container-wide max-w-6xl w-full mx-auto px-4 md:px-8">
          
          <div className="max-w-3xl text-center mx-auto mb-20 animate-in slide-in-from-bottom-6 fade-in-50 duration-700">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-sm font-semibold tracking-wide mb-8 border border-emerald-100 dark:border-emerald-900/50 shadow-xs shadow-emerald-900/5">
              <Mail className="w-4 h-4" />
              {locale === 'bn' ? 'যোগাযোগ' : 'Contact'}
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-6">
              {locale === 'bn' ? 'আমাদের সাথে যোগাযোগ করুন' : 'Get in Touch'}
            </h1>
            <p className="text-lg md:text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed font-light">
              {locale === 'bn' 
                ? 'যেকোনো প্রয়োজনে আমাদের সাথে যোগাযোগ করুন। আমরা আপনাদের সহায়তায় সবসময় প্রস্তুত।' 
                : 'Contact us for any needs. We are always ready to assist you.'}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 md:gap-10">
            {/* Contact Details */}
            <div className="col-span-1 space-y-6">
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
                <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 flex items-center justify-center mb-4">
                  <Phone className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-white text-lg mb-2">{locale === 'bn' ? 'ফোন' : 'Phone'}</h3>
                <p className="text-zinc-600 dark:text-zinc-400">{orgPhone}</p>
              </div>
              
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
                <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 flex items-center justify-center mb-4">
                  <Mail className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-white text-lg mb-2">{locale === 'bn' ? 'ইমেইল' : 'Email'}</h3>
                <p className="text-zinc-600 dark:text-zinc-400">{orgEmail}</p>
              </div>

              <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
                <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 flex items-center justify-center mb-4">
                  <MapPin className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-white text-lg mb-2">{locale === 'bn' ? 'ঠিকানা' : 'Address'}</h3>
                <p className="text-zinc-600 dark:text-zinc-400">{address}</p>
              </div>
            </div>

            {/* Empty Form Display Container */}
            <div className="col-span-1 md:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-[32px] p-8 md:p-12 shadow-xl shadow-zinc-200/20 dark:shadow-none">
              <div className="flex flex-col items-center justify-center h-full text-center py-10 space-y-6">
                <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 rounded-[20px] flex justify-center items-center rotate-3 border border-emerald-100 dark:border-emerald-900/50">
                   <Send className="w-8 h-8 -rotate-12" />
                </div>
                <h3 className="text-2xl font-bold text-zinc-800 dark:text-zinc-100">{locale === 'bn' ? 'বার্তা পাঠান' : 'Send a Message'}</h3>
                <p className="text-zinc-500 dark:text-zinc-400 max-w-sm">
                   {locale === 'bn' ? 'বিস্তারিত আলোচনার জন্য সরাসরি ফোনে কল করতে পারেন অথবা আমাদের অফিসে যোগাযোগ করতে পারেন।' : 'For detailed discussions, please call directly or visit our office.'}
                </p>
                <a href={`tel:${orgPhone}`}>
                  <Button variant="outline" className="mt-4 rounded-full px-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-900/30">
                     {locale === 'bn' ? 'কল করুন' : 'Call Now'}
                  </Button>
                </a>
              </div>
            </div>
          </div>
          
        </div>
      </main>
      <Footer settings={settings} />
    </>
  );
}
