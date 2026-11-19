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
import { PRIVACY_LAST_UPDATED } from '@/lib/legal';
import { localePath } from '@/lib/locale-path';
import { AUDIT_RETENTION_DAYS, rejectedRetentionDaysFrom } from '@/lib/retention-policy';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  const tSeo = await getTranslations({ locale: activeLocale, namespace: 'seo.pages.privacy' });
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/privacy',
    title: tSeo('title'),
    description: tSeo('description'),
  });
}

export default async function PrivacyPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const activeLocale = normalizeLocale(locale);
  const [settings, t, tSeo] = await Promise.all([
    getPublicSettings(),
    getTranslations({ locale, namespace: 'legal' }),
    getTranslations({ locale, namespace: 'seo.pages.privacy' }),
  ]);

  return (
    <>
      <StructuredData
        locale={activeLocale}
        path="/privacy"
        settings={settings}
        headline={tSeo('title')}
        description={tSeo('description')}
        dateModified={PRIVACY_LAST_UPDATED}
      />
      {/* The site header and footer, for navigation and the language switch. */}
      <Header settings={settings} />
      <LegalDocument
        title={t('privacy.title')}
        intro={t('privacy.intro')}
        lastUpdated={PRIVACY_LAST_UPDATED}
        locale={locale}
        sections={Object.values(
          t.raw('privacy.sections') as Record<string, { title: string; content: string }>,
        )}
        // Every period comes from what enforces it: the setting, and the
        // ADR-038 constants.
        values={{
          rejectedDays: String(rejectedRetentionDaysFrom(settings)),
          securityDays: String(AUDIT_RETENTION_DAYS.long),
          routineDays: String(AUDIT_RETENTION_DAYS.short),
        }}
        crossLinks={[
          { href: localePath(locale, '/terms'), label: t('seeTerms') },
          { href: localePath(locale, '/contact'), label: t('seeContact') },
        ]}
      />
      <Footer settings={settings} />
    </>
  );
}
