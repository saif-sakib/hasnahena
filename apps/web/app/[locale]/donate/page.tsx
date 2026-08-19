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

          {/*
            WO-67. Both cards render only when an admin has published the
            details behind them.

            They used to fall back to hardcoded literals — the bank card to the
            account number `2050 0000 0000 0000`, the mobile card to
            `+880 1700-000000` — and because none of the `bank.*` keys was in
            SYSTEM_CONFIG_KEYS, those fallbacks were not fallbacks: the settings
            endpoint rejects any key it does not declare, so no admin screen
            could ever replace them. A donor reading this page was being given a
            placeholder account number to send money to.

            An empty state is the right failure here rather than a default. A
            missing number is a question someone asks; a plausible wrong one is
            money sent somewhere it cannot be recovered from.
          */}
          {(() => {
            const bankAccountNo = settings['bank.accountNo']?.trim();
            const bankName = settings['bank.name']?.trim();
            const bankAccountName = settings['bank.accountName']?.trim();
            const bankBranch = settings['bank.branch']?.trim();
            const mobileNumbers: Array<[string, string]> = (
              [
                ['bKash', settings['donation.bkash']?.trim()],
                ['Nagad', settings['donation.nagad']?.trim()],
                ['Rocket', settings['donation.rocket']?.trim()],
              ] as Array<[string, string | undefined]>
            ).filter((entry): entry is [string, string] => Boolean(entry[1]));

            // The account number is the load-bearing field: a bank card without
            // one cannot be acted on, so it is what decides whether the card
            // exists at all. The rest degrade to omitted lines.
            const showBank = Boolean(bankAccountNo);
            const showMobile = mobileNumbers.length > 0;

            if (!showBank && !showMobile) {
              return (
                <div className="rounded-[32px] border border-zinc-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-10 text-center">
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {locale === 'bn'
                      ? 'অনুদানের তথ্য শীঘ্রই প্রকাশ করা হবে। অনুগ্রহ করে যোগাযোগ পাতার মাধ্যমে আমাদের সাথে যোগাযোগ করুন।'
                      : 'Donation details will be published shortly. Please reach us through the contact page in the meantime.'}
                  </p>
                </div>
              );
            }

            return (
              <div className={showBank && showMobile ? 'grid md:grid-cols-2 gap-8' : 'grid gap-8 max-w-xl mx-auto'}>
                {showBank && (
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-[32px] p-8 shadow-xl shadow-zinc-200/20 text-center flex flex-col items-center justify-center">
                    <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-[24px] flex items-center justify-center mb-6">
                      <Building2 className="w-10 h-10" />
                    </div>
                    <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-4">
                      {locale === 'bn' ? 'ব্যাংক একাউন্ট' : 'Bank Account'}
                    </h2>
                    <div className="space-y-3 text-zinc-600 dark:text-zinc-400">
                      {bankName && <p className="font-medium text-lg">{bankName}</p>}
                      {bankAccountName && (
                        <p>
                          {locale === 'bn' ? 'একাউন্ট নাম:' : 'Account Name:'} {bankAccountName}
                        </p>
                      )}
                      <p className="font-mono text-zinc-800 dark:text-zinc-200 my-2 text-xl px-4 py-2 bg-zinc-100 dark:bg-zinc-950 rounded-xl inline-block">
                        {bankAccountNo}
                      </p>
                      {bankBranch && (
                        <p>
                          {locale === 'bn' ? 'শাখা:' : 'Branch:'} {bankBranch}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {showMobile && (
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-[32px] p-8 shadow-xl shadow-zinc-200/20 text-center flex flex-col items-center justify-center">
                    <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 rounded-[24px] flex items-center justify-center mb-6">
                      <QrCode className="w-10 h-10" />
                    </div>
                    <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-4">
                      {locale === 'bn' ? 'মোবাইল ব্যাংকিং' : 'Mobile Banking'}
                    </h2>
                    <div className="space-y-4 text-zinc-600 dark:text-zinc-400">
                      {mobileNumbers.map(([label, number]) => (
                        <div key={label}>
                          <p>{label}</p>
                          <p className="font-mono text-indigo-600 dark:text-indigo-400 font-bold text-2xl tracking-wider">
                            {number}
                          </p>
                        </div>
                      ))}
                      <p className="text-sm px-4 py-2 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 rounded-full inline-flex mt-4">
                        {locale === 'bn'
                          ? '* অনুদান পাঠানোর পর অনুগ্রহ করে মেসেজ দিয়ে নিশ্চিত করবেন।'
                          : '* Please confirm via SMS after sending the donation.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      </main>
      <Footer settings={settings} />
    </>
  );
}
