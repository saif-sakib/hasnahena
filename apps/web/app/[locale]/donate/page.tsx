import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Building2, Smartphone } from 'lucide-react';
import { IconTile, PageBody, PageHero, paperCard } from '@/components/layout/page-hero';
import { getPublicSettings } from '@/lib/system-config';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { StructuredData } from '@/components/seo/structured-data';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

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

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/donate" settings={settings} />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
        <PageBody className="max-w-5xl">
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
                  <h2 className="mb-4 text-xl font-semibold text-slate-900 dark:text-white">{t('bankTitle')}</h2>
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
                  <h2 className="mb-4 text-xl font-semibold text-slate-900 dark:text-white">{t('mobileTitle')}</h2>
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
