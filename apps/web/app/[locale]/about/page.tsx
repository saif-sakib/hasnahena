import type { Metadata } from 'next';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Users, Goal, Target, Heart } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';

type PageProps = { params: { locale: string } };

export function generateMetadata({ params: { locale } }: PageProps): Metadata {
  const activeLocale = normalizeLocale(locale);
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/about',
    title: activeLocale === 'bn' ? 'আমাদের সম্পর্কে' : 'About Hasnahena',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনার লক্ষ্য, উদ্দেশ্য ও মূল্যবোধ সম্পর্কে জানুন।'
        : 'Learn about Hasnahena’s mission, vision, and community-driven values.',
  });
}

export default async function AboutPage({ params: { locale } }: PageProps) {
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
      <main className="flex-1 bg-white dark:bg-zinc-950 pt-32 pb-24 z-10 w-full flex flex-col items-center">
        <div className="container-wide max-w-6xl w-full mx-auto px-4 md:px-8">
          <div className="max-w-3xl text-center mx-auto mb-20 animate-in slide-in-from-bottom-6 fade-in-50 duration-700">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-sm font-semibold tracking-wide mb-8 border border-emerald-100 dark:border-emerald-900/50 shadow-sm shadow-emerald-900/5">
              <Users className="w-4 h-4" />
              {locale === 'bn' ? 'আমাদের সম্পর্কে' : 'About Us'}
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-6">
              {locale === 'bn' ? 'সুন্দর সমৃদ্ধ সমাজ গঠনে আমরা' : 'Building a Better Society Together'}
            </h1>
            <p className="text-lg md:text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed font-light">
              {locale === 'bn' 
                ? 'হাসনাহেনা সমবায় সমিতি একটি অলাভজনক সেবামূলক প্রতিষ্ঠান। সম্পূর্ণ সুদমুক্ত অর্থায়ন এবং সামাজিক উন্নয়নের লক্ষ্যে আমরা কাজ করে যাচ্ছি।' 
                : 'Hasnahena Cooperative Society is a non-profit organization. We work towards completely interest-free financing and social development.'}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: locale === 'bn' ? 'লক্ষ্য' : 'Vision',
                desc: locale === 'bn' ? 'সুদমুক্ত অর্থনৈতিক ব্যবস্থা এবং একটি শোষণমুক্ত সমাজ গঠন।' : 'Establishing an interest-free economy and exploitation-free society.',
                icon: Target,
                color: 'text-indigo-500',
                bg: 'bg-indigo-50',
                darkBg: 'dark:bg-indigo-950/30'
              },
              {
                title: locale === 'bn' ? 'উদ্দেশ্য' : 'Mission',
                desc: locale === 'bn' ? 'সদস্যদের সঞ্চয় বৃদ্ধি, হালাল বিনিয়োগ এবং জনকল্যাণমূলক কাজের মাধ্যমে স্বনির্ভরতা অর্জন।' : 'Self-reliance through member savings, halal investments, and public welfare activities.',
                icon: Goal,
                color: 'text-emerald-500',
                bg: 'bg-emerald-50',
                darkBg: 'dark:bg-emerald-950/30'
              },
              {
                title: locale === 'bn' ? 'মূল্যবোধ' : 'Values',
                desc: locale === 'bn' ? 'স্বচ্ছতা, জবাবদিহিতা, আমানতদারিতা এবং পারস্পরিক সহযোগিতা আমাদের মূলভিত্তি।' : 'Transparency, accountability, trustworthiness, and mutual cooperation are our foundation.',
                icon: Heart,
                color: 'text-rose-500',
                bg: 'bg-rose-50',
                darkBg: 'dark:bg-rose-950/30'
              }
            ].map((item, i) => (
              <div key={i} className="group p-8 rounded-[32px] bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/50 dark:border-zinc-800/80 hover:shadow-xl hover:-translate-y-1 hover:border-zinc-300 transition-all duration-300">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 shadow-sm border border-black/5 ${item.bg} ${item.darkBg} ${item.color} group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
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
