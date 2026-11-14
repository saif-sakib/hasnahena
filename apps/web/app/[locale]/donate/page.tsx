import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales, type Locale } from '@/i18n';
import { notFound } from 'next/navigation';
import { Noto_Naskh_Arabic } from 'next/font/google';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Building2, Smartphone } from 'lucide-react';
import { IconTile, PageBody, PageHero, paperCard } from '@/components/layout/page-hero';
import { getPublicSettings } from '@/lib/system-config';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { StructuredData } from '@/components/seo/structured-data';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

/**
 * Self-hosted by next/font. The pause marks in the ayat (U+06DA, U+06D6) are
 * missing from many phone fonts and draw as boxes; never strip them instead.
 */
const arabicFont = Noto_Naskh_Arabic({ subsets: ['arabic'], weight: '400', display: 'swap' });

/**
 * Scripture, verbatim and the same in both languages, so not in messages.
 */
const AYAH_2_276 =
  'يَمْحَقُ اللَّهُ الرِّبَا وَيُرْبِي الصَّدَقَاتِ ۗ وَاللَّهُ لَا يُحِبُّ كُلَّ كَفَّارٍ أَثِيمٍ';
const AYAH_2_277 =
  'إِنَّ الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ وَأَقَامُوا الصَّلَاةَ وَآتَوُا الزَّكَاةَ لَهُمْ أَجْرُهُمْ عِنْدَ رَبِّهِمْ وَلَا خَوْفٌ عَلَيْهِمْ وَلَا هُمْ يَحْزَنُونَ';
const AYAH_2_278 =
  'يَا أَيُّهَا الَّذِينَ آمَنُوا اتَّقُوا اللَّهَ وَذَرُوا مَا بَقِيَ مِنَ الرِّبَا إِنْ كُنْتُمْ مُؤْمِنِينَ';
const AYAH_2_279 =
  'فَإِنْ لَمْ تَفْعَلُوا فَأْذَنُوا بِحَرْبٍ مِنَ اللَّهِ وَرَسُولِهِ ۖ وَإِنْ تُبْتُمْ فَلَكُمْ رُءُوسُ أَمْوَالِكُمْ لَا تَظْلِمُونَ وَلَا تُظْلَمُونَ';
const AYAH_2_280 =
  'وَإِنْ كَانَ ذُو عُسْرَةٍ فَنَظِرَةٌ إِلَىٰ مَيْسَرَةٍ ۚ وَأَنْ تَصَدَّقُوا خَيْرٌ لَكُمْ ۖ إِنْ كُنْتُمْ تَعْلَمُونَ';
const AYAH_2_261 =
  'مَثَلُ الَّذِينَ يُنْفِقُونَ أَمْوَالَهُمْ فِي سَبِيلِ اللَّهِ كَمَثَلِ حَبَّةٍ أَنْبَتَتْ سَبْعَ سَنَابِلَ فِي كُلِّ سُنْبُلَةٍ مِائَةُ حَبَّةٍ ۗ وَاللَّهُ يُضَاعِفُ لِمَنْ يَشَاءُ ۗ وَاللَّهُ وَاسِعٌ عَلِيمٌ';

type PageProps = { params: Promise<{ locale: string }> };

function Ayah({ arabic, text, source }: { arabic: string; text: string; source: string }) {
  return (
    <figure className="mt-5 rounded-xl border-s-4 border-primary/40 bg-primary/5 p-5">
      <p
        lang="ar"
        dir="rtl"
        className={`${arabicFont.className} text-xl leading-loose text-slate-900 dark:text-white`}
      >
        {arabic}
      </p>
      <blockquote className="mt-3 leading-relaxed text-muted-foreground">{text}</blockquote>
      <figcaption className="mt-2 text-sm font-medium text-primary">{source}</figcaption>
    </figure>
  );
}

function Quote({ text, source }: { text: string; source: string }) {
  return (
    <figure className="mt-4 rounded-xl border-s-4 border-amber-400/60 bg-amber-50/50 p-4 dark:border-amber-500/40 dark:bg-amber-950/20">
      <blockquote className="leading-relaxed text-muted-foreground">{text}</blockquote>
      <figcaption className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-400">{source}</figcaption>
    </figure>
  );
}

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
  if (!locales.includes(locale as Locale)) notFound();
  setRequestLocale(locale);

  const settings = await getPublicSettings();
  const t = await getTranslations({ locale, namespace: 'pages.donate' });
  const tDonation = await getTranslations({ locale, namespace: 'donation' });

  const bankAccountNo = settings['bank.accountNo']?.trim();
  const bankName = settings['bank.name']?.trim();
  const bankAccountName = settings['bank.accountName']?.trim();
  const bankBranch = settings['bank.branch']?.trim();
  const mobileNumbers: Array<[string, string]> = (
    [
      [tDonation('bkash'), settings['donation.bkash']?.trim()],
      [tDonation('nagad'), settings['donation.nagad']?.trim()],
      [tDonation('rocket'), settings['donation.rocket']?.trim()],
    ] as Array<[string, string | undefined]>
  ).filter((entry): entry is [string, string] => Boolean(entry[1]));

  // Each card renders only when an admin has published its details (WO-67) —
  // never a placeholder account number. The account number is the load-bearing
  // field: a bank card without one cannot be acted on, so it decides whether
  // the card exists at all. The rest degrade to omitted lines.
  const showBank = Boolean(bankAccountNo);
  const showMobile = mobileNumbers.length > 0;

  const sectionTitle = 'text-xl font-semibold text-slate-900 md:text-2xl dark:text-white';
  const body = 'mt-3 leading-relaxed text-muted-foreground';

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/donate" settings={settings} />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
        <PageBody className="max-w-5xl space-y-8">
          <section className={`${paperCard} p-6 md:p-8`}>
            <h2 className={sectionTitle}>{t('quranTitle')}</h2>
            <p className={body}>{t('quranIntro')}</p>
            <Ayah arabic={AYAH_2_276} text={t('ayah276')} source={t('ayah276Source')} />
            <Ayah arabic={AYAH_2_277} text={t('ayah277')} source={t('ayah277Source')} />
            <Ayah arabic={AYAH_2_278} text={t('ayah278')} source={t('ayah278Source')} />
            <Ayah arabic={AYAH_2_279} text={t('ayah279')} source={t('ayah279Source')} />
            <Ayah arabic={AYAH_2_280} text={t('ayah280')} source={t('ayah280Source')} />
            <Ayah arabic={AYAH_2_261} text={t('ayah261')} source={t('ayah261Source')} />
          </section>

          <section className={`${paperCard} p-6 md:p-8`}>
            <h2 className={sectionTitle}>{t('hadithTitle')}</h2>
            <Quote text={t('hadith1')} source={t('hadith1Source')} />
            <Quote text={t('hadith2')} source={t('hadith2Source')} />
            <Quote text={t('hadith3')} source={t('hadith3Source')} />
          </section>

          <section className="rounded-sm border border-emerald-200 border-s-4 border-s-emerald-600 bg-emerald-50/70 p-6 md:p-8 dark:border-emerald-900/60 dark:border-s-emerald-500 dark:bg-emerald-950/30">
            <h2 className={sectionTitle}>{t('callTitle')}</h2>
            <p className="mt-3 leading-relaxed text-slate-700 dark:text-slate-300">{t('callBody1')}</p>
            <p className="mt-3 font-medium leading-relaxed text-slate-900 dark:text-slate-100">{t('callBody2')}</p>
          </section>

          <section className="space-y-4">
            <h2 className={sectionTitle}>{t('waysToDonateTitle')}</h2>
            {!showBank && !showMobile ? (
              <div className={`${paperCard} mx-auto max-w-2xl p-8 text-center`}>
                <p className="leading-relaxed text-muted-foreground">{t('comingSoon')}</p>
              </div>
            ) : (
              <div className={showBank && showMobile ? 'grid gap-6 md:grid-cols-2' : 'mx-auto grid max-w-xl gap-6'}>
                {showBank && (
                  <section className={`${paperCard} p-6 md:p-8`}>
                    <IconTile>
                      <Building2 className="h-6 w-6" aria-hidden="true" />
                    </IconTile>
                    <h3 className="mb-4 text-xl font-semibold text-slate-900 dark:text-white">{t('bankTitle')}</h3>
                    {/* A ledger of label/value lines, so each detail can be read off on its own. */}
                    <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                      {bankName && <DetailRow label={t('bankName')} value={bankName} />}
                      {bankAccountName && <DetailRow label={t('accountName')} value={bankAccountName} />}
                      <DetailRow label={t('accountNumber')} value={bankAccountNo!} figure />
                      {bankBranch && <DetailRow label={t('branch')} value={bankBranch} />}
                    </dl>
                  </section>
                )}

                {showMobile && (
                  <section className={`${paperCard} p-6 md:p-8`}>
                    <IconTile>
                      <Smartphone className="h-6 w-6" aria-hidden="true" />
                    </IconTile>
                    <h3 className="mb-4 text-xl font-semibold text-slate-900 dark:text-white">{t('mobileTitle')}</h3>
                    <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                      {mobileNumbers.map(([label, number]) => (
                        <DetailRow key={label} label={label} value={number} figure />
                      ))}
                    </dl>
                    <p className="mt-5 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                      {t('confirmNote')}
                    </p>
                  </section>
                )}
              </div>
            )}
          </section>

          <footer className="border-t border-slate-200 pt-5 text-sm leading-relaxed text-muted-foreground dark:border-slate-800">
            <h2 className="font-semibold text-slate-900 dark:text-white">{t('sourcesTitle')}</h2>
            <p className="mt-1">{t('sourcesBody')}</p>
          </footer>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}

/** One label/value line; a `figure` is a number someone will type, so it is set large and never broken. */
function DetailRow({ label, value, figure = false }: { label: string; value: string; figure?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          figure
            ? 'whitespace-nowrap font-mono text-lg font-semibold tabular-nums tracking-wide text-emerald-800 select-all dark:text-emerald-300'
            : 'font-medium text-slate-900 dark:text-white'
        }
      >
        {value}
      </dd>
    </div>
  );
}
