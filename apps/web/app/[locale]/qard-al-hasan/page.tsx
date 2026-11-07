import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Noto_Naskh_Arabic } from 'next/font/google';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales, type Locale } from '@/i18n';
import { PageBody, PageHero, paperCard } from '@/components/layout/page-hero';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { StructuredData } from '@/components/seo/structured-data';
import { Button } from '@/components/ui/button';
import { getPublicSettings } from '@/lib/system-config';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { localePath } from '@/lib/locale-path';
import { formatCurrency } from '@/lib/utils';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

/**
 * Self-hosted by next/font. The pause marks in the ayat (U+06DA, U+06D6) are
 * missing from many phone fonts and draw as boxes; never strip them instead.
 */
const arabicFont = Noto_Naskh_Arabic({ subsets: ['arabic'], weight: '400', display: 'swap' });

/** ADR-045: flat, not configurable. */
const OFFICE_EXPENSES_TAKA = 500;

/**
 * Scripture, verbatim and the same in both languages, so not in messages. Every
 * reference and translation on this page was checked against primary texts
 * before publishing: change one only after checking it again. Ibn Majah 2431
 * ("a loan earns eighteen-fold") is left out on purpose: it is graded weak.
 */
const AYAH_2_245 =
  'مَنْ ذَا الَّذِي يُقْرِضُ اللَّهَ قَرْضًا حَسَنًا فَيُضَاعِفَهُ لَهُ أَضْعَافًا كَثِيرَةً ۚ وَاللَّهُ يَقْبِضُ وَيَبْسُطُ وَإِلَيْهِ تُرْجَعُونَ';
const AYAH_2_280 =
  'وَإِنْ كَانَ ذُو عُسْرَةٍ فَنَظِرَةٌ إِلَىٰ مَيْسَرَةٍ ۚ وَأَنْ تَصَدَّقُوا خَيْرٌ لَكُمْ ۖ إِنْ كُنْتُمْ تَعْلَمُونَ';

type PageProps = { params: Promise<{ locale: string }> };

/** A loan term from settings; the same defaults as the loan application route. */
function term(settings: Record<string, string>, key: string, fallback: number): number {
  const parsed = Number(settings[key]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  const t = await getTranslations({ locale: activeLocale, namespace: 'pages.qardHasan' });
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/qard-al-hasan',
    title: t('metaTitle'),
    description: t('metaDescription'),
  });
}

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
    <figure className="mt-3">
      <blockquote className="leading-relaxed text-muted-foreground">{text}</blockquote>
      <figcaption className="mt-1 text-sm font-medium text-primary">{source}</figcaption>
    </figure>
  );
}

export default async function QardAlHasanPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const settings = await getPublicSettings();
  const t = await getTranslations({ locale, namespace: 'pages.qardHasan' });

  const number = new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD');
  const fee = formatCurrency(OFFICE_EXPENSES_TAKA, locale);
  const values = {
    fee,
    minDeposit: formatCurrency(term(settings, 'loan.minDepositForLoan', 8000), locale),
    multiplier: number.format(term(settings, 'loan.maxLoanMultiplier', 5)),
    months: number.format(term(settings, 'loan.maxInstallmentMonths', 24)),
    threshold: formatCurrency(term(settings, 'loan.guarantorThresholdAmount', 20000), locale),
  };

  const sectionTitle = 'text-xl font-semibold text-slate-900 md:text-2xl dark:text-white';
  const body = 'mt-3 leading-relaxed text-muted-foreground';

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/qard-al-hasan" settings={settings} />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
        <PageBody className="max-w-3xl space-y-6">
          <section className={`${paperCard} p-6 md:p-8`}>
            <h2 className={sectionTitle}>{t('meaningTitle')}</h2>
            <p className={body}>{t('meaningBody1')}</p>
            <p className={body}>{t('meaningBody2')}</p>
            <Ayah arabic={AYAH_2_245} text={t('ayah245')} source={t('ayah245Source')} />
          </section>

          <section className={`${paperCard} p-6 md:p-8`}>
            <h2 className={sectionTitle}>{t('ribaTitle')}</h2>
            <p className={body}>{t('ribaBody')}</p>
            <div className="mt-2 space-y-2">
              <Quote text={t('ribaQuote1')} source={t('ribaQuote1Source')} />
              <Quote text={t('ribaQuote2')} source={t('ribaQuote2Source')} />
              <Quote text={t('ribaQuote3')} source={t('ribaQuote3Source')} />
            </div>
          </section>

          <section className={`${paperCard} p-6 md:p-8`}>
            <h2 className={sectionTitle}>{t('dutiesTitle')}</h2>
            <p className={body}>{t('dutiesIntro')}</p>
            <Quote text={t('lender1')} source={t('lender1Source')} />
            <h3 className="mt-5 font-semibold text-slate-900 dark:text-white">{t('lenderTitle')}</h3>
            <Ayah arabic={AYAH_2_280} text={t('ayah280')} source={t('ayah280Source')} />
            <Quote text={t('lender2')} source={t('lender2Source')} />
            <h3 className="mt-6 font-semibold text-slate-900 dark:text-white">{t('borrowerTitle')}</h3>
            <Quote text={t('borrower1')} source={t('borrower1Source')} />
            <Quote text={t('borrower2')} source={t('borrower2Source')} />
            <Quote text={t('borrower3')} source={t('borrower3Source')} />
          </section>

          <section className={`${paperCard} p-6 md:p-8`}>
            <h2 className={sectionTitle}>{t('howTitle')}</h2>
            <p className={body}>{t('howIntro')}</p>
            <ol className="mt-5 space-y-5">
              {([1, 2, 3, 4, 5, 6] as const).map((step) => (
                <li key={step} className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                  >
                    {number.format(step)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900 dark:text-white">{t(`step${step}Title`)}</h3>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      {t(`step${step}Body`, values)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className={`${paperCard} p-6 md:p-8`}>
            <h2 className={sectionTitle}>{t('termsTitle')}</h2>
            <ul className="mt-3 list-disc space-y-2 ps-5 leading-relaxed text-muted-foreground">
              <li>{t('term1')}</li>
              <li>{t('term2', { fee })}</li>
              <li>{t('term3')}</li>
            </ul>
          </section>

          <div className="text-center">
            <p className="text-muted-foreground">{t('ctaBody')}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
              <Button asChild>
                <Link href={localePath(locale, '/register')}>
                  {t('ctaRegister')}
                  <ArrowRight className="ms-1 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={localePath(locale, '/faq')}>{t('ctaFaq')}</Link>
              </Button>
            </div>
          </div>

          <footer className="border-t border-slate-200 pt-5 text-sm leading-relaxed text-muted-foreground dark:border-slate-800">
            <h2 className="font-semibold text-slate-900 dark:text-white">{t('sourcesTitle')}</h2>
            <p className="mt-1">{t('sourcesBody')}</p>
            <p className="mt-2">{t('disclaimer')}</p>
          </footer>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
