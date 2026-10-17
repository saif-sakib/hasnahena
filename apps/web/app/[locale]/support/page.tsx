import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Mail, MapPin, Phone } from 'lucide-react';
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
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/support',
    title: activeLocale === 'bn' ? 'সহায়তা ও সাপোর্ট' : 'Support Center',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনার সহায়তা পেতে ফোন, ইমেইল বা সরাসরি অফিসে যোগাযোগ করুন।'
        : 'Get support from Hasnahena via phone, email, or by visiting the office.',
  });
}

export default async function SupportPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const settings = await getPublicSettings();
  const t = await getTranslations({ locale, namespace: 'pages.support' });

  // org.* via contactDetails (WO-67).
  const { address, phone, email } = contactDetails(settings, locale);

  const channels = [
    { key: 'phone', icon: Phone, value: phone, href: phone ? telHref(phone) : undefined },
    { key: 'email', icon: Mail, value: email, href: email ? `mailto:${email}` : undefined },
    { key: 'office', icon: MapPin, value: address, href: undefined },
  ].filter((channel) => channel.value);

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/support" settings={settings} />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
        <PageBody className="max-w-5xl">
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

          <p className="mt-8 text-center text-muted-foreground">
            {t('faqPrompt')}{' '}
            <Link
              href={localePath(locale, '/faq')}
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('faqLink')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </p>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
