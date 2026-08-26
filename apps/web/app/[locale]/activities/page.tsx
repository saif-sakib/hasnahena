import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Wallet, GraduationCap, HandHeart, Users } from 'lucide-react';
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
    path: '/activities',
    title: activeLocale === 'bn' ? 'আমাদের কার্যক্রম' : 'Our Activities',
    description:
      activeLocale === 'bn'
        ? 'সুদমুক্ত ঋণ, শিক্ষা সহায়তা ও সামাজিক উন্নয়নে হাসনাহেনার কার্যক্রম দেখুন।'
        : 'Explore Hasnahena activities in interest-free finance, education support, and social welfare.',
  });
}

export default async function ActivitiesPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as any)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'activities' });
  const settings = await getPublicSettings();

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/activities" settings={settings} />
      <Header settings={settings} />
      <main className="flex-1 bg-white dark:bg-zinc-950 pt-24 pb-20 z-10 w-full flex flex-col items-center">
        <div className="container-wide max-w-6xl w-full mx-auto px-4 md:px-8">
          <div className="max-w-3xl text-center mx-auto mb-20 animate-in slide-in-from-bottom-6 fade-in-50 duration-700">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-sm font-semibold tracking-wide mb-8 border border-blue-100 dark:border-blue-900/50 shadow-xs shadow-blue-900/5">
              <HandHeart className="w-4 h-4" />
              {locale === 'bn' ? 'আমাদের কার্যক্রম' : 'Our Activities'}
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-6">
              {locale === 'bn' ? 'সামাজিক কল্যাণে আমাদের উদ্যোগ' : 'Initiatives for Social Welfare'}
            </h1>
            <p className="text-lg md:text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed font-light">
              {locale === 'bn' 
                ? 'আমরা সমাজের সার্বিক উন্নয়নে বিভিন্ন কার্যক্রম পরিচালনা করি। এর মধ্যে রয়েছে সুদমুক্ত ঋণ, শিক্ষা এবং সামাজিক সহায়তা।' 
                : 'We conduct various activities for overall social development, including interest-free loans, education, and social support.'}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                title: t('finance.title'),
                desc: t('finance.description'),
                icon: Wallet,
                color: 'text-emerald-500',
                bg: 'bg-emerald-50',
                darkBg: 'dark:bg-emerald-950/30'
              },
              {
                title: t('education.title'),
                desc: t('education.description'),
                icon: GraduationCap,
                color: 'text-indigo-500',
                bg: 'bg-indigo-50',
                darkBg: 'dark:bg-indigo-950/30'
              },
              {
                title: t('social.title'),
                desc: t('social.description'),
                icon: Users,
                color: 'text-rose-500',
                bg: 'bg-rose-50',
                darkBg: 'dark:bg-rose-950/30'
              }
            ].map((item, i) => (
              <div key={i} className="group p-8 rounded-[32px] bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/50 dark:border-zinc-800/80 hover:shadow-xl hover:-translate-y-1 hover:border-zinc-300 transition-all duration-300">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 shadow-xs border border-black/5 ${item.bg} ${item.darkBg} ${item.color} group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
                  <item.icon className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-3 tracking-tight">{item.title}</h3>
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer settings={settings} />
    </>
  );
}
