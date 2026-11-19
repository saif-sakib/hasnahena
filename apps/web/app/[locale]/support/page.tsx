import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, KeyRound, Mail, MapPin, Phone, Receipt, UserCheck, Wallet } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales, type Locale } from '@/i18n';
import { IconTile, PageBody, PageHero, paperCard } from '@/components/layout/page-hero';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { getPublicSettings } from '@/lib/system-config';
import { contactDetails, telHref } from '@/lib/contact-details';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { StructuredData } from '@/components/seo/structured-data';
import { localePath } from '@/lib/locale-path';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  const tSeo = await getTranslations({ locale: activeLocale, namespace: 'seo.pages.support' });
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/support',
    title: tSeo('title'),
    description: tSeo('description'),
  });
}

export default async function SupportPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const activeLocale = normalizeLocale(locale);
  const [settings, t, tSeo] = await Promise.all([
    getPublicSettings(),
    getTranslations({ locale, namespace: 'pages.support' }),
    getTranslations({ locale, namespace: 'seo.pages.support' }),
  ]);

  // org.* via contactDetails (WO-67).
  const { address, phone, email } = contactDetails(settings, locale);

  const channels = [
    { key: 'phone', icon: Phone, value: phone, href: phone ? telHref(phone) : undefined },
    { key: 'email', icon: Mail, value: email, href: email ? `mailto:${email}` : undefined },
    { key: 'office', icon: MapPin, value: address, href: undefined },
  ].filter((channel) => channel.value);

  const topics = [
    { key: 'approval', icon: UserCheck },
    { key: 'password', icon: KeyRound },
    { key: 'transactions', icon: Receipt },
    { key: 'withdrawal', icon: Wallet },
  ] as const;

  return (
    <>
      <StructuredData
        locale={activeLocale}
        path="/support"
        settings={settings}
        headline={tSeo('title')}
        description={tSeo('description')}
      />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
        <PageBody className="max-w-5xl space-y-10">
          <div className="grid gap-6 md:grid-cols-3">
            {channels.map(({ key, icon: Icon, value, href }) => (
              <article key={key} className={`${paperCard} p-6`}>
                <IconTile>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </IconTile>
                <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">{t(key)}</h2>
                {href ? (
                  <a href={href} className="text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
                    {value}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">{value}</p>
                )}
              </article>
            ))}
          </div>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900 md:text-2xl dark:text-white">
              {t('topicsTitle')}
            </h2>
            <div className="grid gap-6 md:grid-cols-2">
              {topics.map(({ key, icon: Icon }) => (
                <article key={key} className={`${paperCard} p-6`}>
                  <IconTile>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </IconTile>
                  <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                    {t(`${key}Title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t(`${key}Body`)}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <div className="space-y-3 text-center text-muted-foreground">
            <p>
              {t('faqPrompt')}{' '}
              <Link
                href={localePath(locale, '/faq')}
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('faqLink')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
              <Link
                href={localePath(locale, '/contact')}
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('contactLink')}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <Link
                href={localePath(locale, '/qard-al-hasan')}
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('qardLink')}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <Link
                href={localePath(locale, '/privacy')}
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('privacyLink')}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
