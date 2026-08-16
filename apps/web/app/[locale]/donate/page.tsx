import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { HandHeart, HeartPulse, Building2, QrCode } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/donate',
    title: activeLocale === 'bn' ? 'অনুদান করুন' : 'Donate',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনার সেবামূলক কার্যক্রমে অনুদান দিয়ে অংশ নিন।'
        : 'Support Hasnahena welfare programs by making a donation.',
  });
}

export default async function DonatePage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as any)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale });
  const settingsResult = await prisma.systemConfig.findMany();
  const settings = settingsResult.reduce((acc, config) => {
    acc[config.key] = config.value;
    return acc;
  }, {} as Record<string, string>);

  return (
    <>
      <Header settings={settings} />
      <main className="flex-1 bg-rose-50/30 dark:bg-zinc-950 pt-32 pb-24 z-10 w-full flex flex-col items-center">
        <div className="container-wide max-w-6xl w-full mx-auto px-4 md:px-8">
          
          <div className="max-w-3xl text-center mx-auto mb-20 animate-in slide-in-from-bottom-6 fade-in-50 duration-700">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-sm font-semibold tracking-wide mb-8 border border-rose-200 dark:border-rose-900/50 shadow-xs shadow-rose-900/5">
              <HandHeart className="w-4 h-4" />
              {locale === 'bn' ? 'অনুদান' : 'Donate'}
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-6">
              {locale === 'bn' ? 'আপনার অনুদান বদলে দিতে পারে একটি জীবন' : 'Your Donation Can Change a Life'}
            </h1>
            <p className="text-lg md:text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed font-light">
              {locale === 'bn' 
                ? 'হাসনাহেনার সেবামূলক কার্যক্রমে যুক্ত হয়ে সমাজ উন্নয়নে সহায়তা করুন। আপনাদের দেয়া অনুদান পৌঁছে যাবে প্রকৃত অভাবীদের কাছে।' 
                : 'Support Hasnahena’s welfare initiatives. Your donations will reach those who are truly in need.'}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-[32px] p-8 shadow-xl shadow-zinc-200/20 text-center flex flex-col items-center justify-center">
              <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-[24px] flex items-center justify-center mb-6">
                <Building2 className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-4">
                {locale === 'bn' ? 'ব্যাংক একাউন্ট' : 'Bank Account'}
              </h2>
              <div className="space-y-3 text-zinc-600 dark:text-zinc-400">
                 <p className="font-medium text-lg">{settings['bank.name'] || 'Islami Bank Bangladesh PLC'}</p>
                 <p>{locale === 'bn' ? 'একাউন্ট নাম:' : 'Account Name:'} {settings['bank.accountName'] || 'Hasnahena Foundation'}</p>
                 <p className="font-mono text-zinc-800 dark:text-zinc-200 my-2 text-xl px-4 py-2 bg-zinc-100 dark:bg-zinc-950 rounded-xl inline-block">
                    {settings['bank.accountNo'] || '2050 0000 0000 0000'}
                 </p>
                 <p>{locale === 'bn' ? 'শাখা:' : 'Branch:'} {settings['bank.branch'] || 'Local Office'}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-[32px] p-8 shadow-xl shadow-zinc-200/20 text-center flex flex-col items-center justify-center">
              <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 rounded-[24px] flex items-center justify-center mb-6">
                <QrCode className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-4">
                {locale === 'bn' ? 'মোবাইল ব্যাংকিং (বিকাশ / নগদ)' : 'Mobile Banking (bKash / Nagad)'}
              </h2>
              <div className="space-y-4 text-zinc-600 dark:text-zinc-400">
                 <p>{locale === 'bn' ? 'নাম্বার:' : 'Number:'}</p>
                 <p className="font-mono text-indigo-600 dark:text-indigo-400 font-bold text-3xl tracking-wider">
                    {settings['contact.phone'] || '+880 1700-000000'}
                 </p>
                 <p className="text-sm px-4 py-2 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 rounded-full inline-flex mt-4">
                    {locale === 'bn' ? '* অনুদান পাঠানোর পর অনুগ্রহ করে মেসেজ দিয়ে নিশ্চিত করবেন।' : '* Please confirm via SMS after sending the donation.'}
                 </p>
              </div>
            </div>
          </div>
          
        </div>
      </main>
      <Footer settings={settings} />
    </>
  );
}
