import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Mail, Phone, MapPin } from 'lucide-react';
import { IconTile, PageBody, PageHero, paperCard } from '@/components/layout/page-hero';
import { getPublicSettings } from '@/lib/system-config';
import { contactDetails, telHref } from '@/lib/contact-details';
import { Button } from '@/components/ui/button';
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
    path: '/contact',
    title: activeLocale === 'bn' ? 'যোগাযোগ' : 'Contact Us',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনার সাথে যোগাযোগের ঠিকানা, ফোন এবং ইমেইল তথ্য।'
        : 'Reach Hasnahena through phone, email, and office address details.',
  });
}

export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as any)) notFound();
  setRequestLocale(locale);

  const settings = await getPublicSettings();
  const t = await getTranslations({ locale, namespace: 'pages.contact' });

  // The shared org.* reader (WO-67) — never a second copy of the address.
  const { address, phone: orgPhone, email: orgEmail } = contactDetails(settings, locale);

  // An unset detail is absent, never a placeholder.
  const cards = [
    { key: 'phone', icon: Phone, value: orgPhone, href: orgPhone ? telHref(orgPhone) : undefined },
    { key: 'email', icon: Mail, value: orgEmail, href: orgEmail ? `mailto:${orgEmail}` : undefined },
    { key: 'address', icon: MapPin, value: address, href: undefined },
  ].filter((card) => card.value);

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/contact" settings={settings} />
      <Header settings={settings} />
      <main className="surface-paper flex-1">
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
        <PageBody className="max-w-5xl space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            {cards.map(({ key, icon: Icon, value, href }) => (
              <article key={key} className={`${paperCard} p-6`}>
                <IconTile>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </IconTile>
                <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">{t(key)}</h2>
                {href ? (
                  <a href={href} className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
                    {value}
                  </a>
                ) : (
                  <p className="text-muted-foreground">{value}</p>
                )}
              </article>
            ))}
          </div>

          <section className={`${paperCard} flex flex-col items-start gap-5 p-6 md:flex-row md:items-center md:justify-between md:p-8`}>
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t('talkTitle')}</h2>
              <p className="mt-1 max-w-xl text-muted-foreground">{t('talkBody')}</p>
            </div>
            {/* No "Call Now" without a number (an empty tel: links nowhere). */}
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              {orgPhone && (
                <Button asChild size="lg" className="gap-2">
                  <a href={telHref(orgPhone)}>
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    {t('callNow')}
                  </a>
                </Button>
              )}
              {orgEmail && (
                <Button asChild size="lg" variant="outline" className="gap-2">
                  <a href={`mailto:${orgEmail}`}>
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    {t('writeToUs')}
                  </a>
                </Button>
              )}
            </div>
          </section>
        </PageBody>
      </main>
      <Footer settings={settings} />
    </>
  );
}
