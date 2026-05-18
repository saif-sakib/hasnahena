import type { Metadata } from 'next';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Mail, Phone, MapPin, Send } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { Button } from '@/components/ui/button';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';

type PageProps = { params: { locale: string } };

export function generateMetadata({ params: { locale } }: PageProps): Metadata {
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

export default async function ContactPage({ params: { locale } }: PageProps) {
  if (!locales.includes(locale as any)) notFound();
  unstable_setRequestLocale(locale);

  const t = await getTranslations({ locale });
  const settingsResult = await prisma.systemConfig.findMany();
  const settings = settingsResult.reduce((acc, config) => {
    acc[config.key] = config.value;
    return acc;
  }, {} as Record<string, string>);

  return (
    <>
      <Header settings={settings} />
      <main className="flex-1 bg-zinc-50 dark:bg-zinc-950 pt-32 pb-24 z-10 w-full flex flex-col items-center">
        <div className="container-wide max-w-6xl w-full mx-auto px-4 md:px-8">
          
          <div className="max-w-3xl text-center mx-auto mb-20 animate-in slide-in-from-bottom-6 fade-in-50 duration-700">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-sm font-semibold tracking-wide mb-8 border border-emerald-100 dark:border-emerald-900/50 shadow-sm shadow-emerald-900/5">
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
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
                <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 flex items-center justify-center mb-4">
                  <Phone className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-white text-lg mb-2">{locale === 'bn' ? 'ফোন' : 'Phone'}</h3>
                <p className="text-zinc-600 dark:text-zinc-400">{settings['contact.phone'] || '+8801234567890'}</p>
              </div>
              
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
                <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 flex items-center justify-center mb-4">
                  <Mail className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-white text-lg mb-2">{locale === 'bn' ? 'ইমেইল' : 'Email'}</h3>
                <p className="text-zinc-600 dark:text-zinc-400">{settings['contact.email'] || 'contact@example.com'}</p>
              </div>

              <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
                <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 flex items-center justify-center mb-4">
                  <MapPin className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-white text-lg mb-2">{locale === 'bn' ? 'ঠিকানা' : 'Address'}</h3>
                <p className="text-zinc-600 dark:text-zinc-400">{settings['contact.address'] || 'Dhaka, Bangladesh'}</p>
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
                <a href={`tel:${settings['contact.phone']}`}>
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
