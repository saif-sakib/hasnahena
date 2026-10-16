import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { locales, type Locale } from '@/i18n';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';
import { getPublicSettings } from '@/lib/system-config';
import { StructuredData } from '@/components/seo/structured-data';
import { LegalDocument } from '@/components/layout/legal-document';
import { PRIVACY_LAST_UPDATED } from '@/lib/legal';
import { AUDIT_RETENTION_DAYS, rejectedRetentionDaysFrom } from '@/lib/retention-policy';

/** Prerendered (WO-73); a settings save busts the tag, this is the backstop. */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/privacy',
    title: activeLocale === 'bn' ? 'গোপনীয়তা নীতি' : 'Privacy Policy',
    description:
      activeLocale === 'bn'
        ? 'হাসনাহেনা কীভাবে আপনার ব্যক্তিগত তথ্য সংগ্রহ, ব্যবহার ও সুরক্ষিত রাখে তা জানুন।'
        : 'Learn how Hasnahena collects, uses, and protects your personal information.',
  });
}

export default async function PrivacyPage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const settings = await getPublicSettings();
  const t = await getTranslations({ locale, namespace: 'legal' });

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/privacy" settings={settings} />
      {/* The site header and footer, for navigation and the language switch. */}
      <Header settings={settings} />
      <LegalDocument
        icon={<ShieldCheck className="h-7 w-7 text-emerald-600" />}
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
      />
      <Footer settings={settings} />
    </>
  );
}
