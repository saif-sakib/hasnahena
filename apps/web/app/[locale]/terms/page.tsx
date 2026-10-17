import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { getPublicSettings } from '@/lib/system-config';
import { StructuredData } from '@/components/seo/structured-data';
import { LegalDocument } from '@/components/layout/legal-document';
import { TERMS_LAST_UPDATED } from '@/lib/legal';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/terms',
    title: activeLocale === 'bn' ? 'সেবার শর্তাবলী' : 'Terms of Service',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনার সেবা ব্যবহারের শর্তাবলী ও নীতিমালা পড়ুন।'
        : 'Read the terms and conditions for using Hasnahena services.',
  });
}

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const settings = await getPublicSettings();
  const t = await getTranslations({ locale, namespace: 'legal' });

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/terms" settings={settings} />
      {/* The site chrome, since T-10 — see the note on the privacy page. */}
      <Header settings={settings} />
      <LegalDocument
        title={t('terms.title')}
        intro={t('terms.intro')}
        lastUpdated={TERMS_LAST_UPDATED}
        locale={locale}
        sections={Object.values(
          t.raw('terms.sections') as Record<string, { title: string; content: string }>,
        )}
      />
      <Footer settings={settings} />
    </>
  );
}
