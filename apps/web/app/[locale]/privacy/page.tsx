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

/**
 * WO-73. This page's content changes when an admin edits a setting, which is to
 * say almost never — so it is prerendered and served from the edge instead of
 * opening a Neon connection on every visit. `revalidateTag('system-config')` in
 * the settings `PUT` is what makes an edit appear immediately; this interval is
 * only the backstop.
 */
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
      {/*
        The site header and footer, since T-10. This page used to carry its own
        four-line header — a logo and a "Back to Home" button — and its own
        one-line footer, which meant a visitor who arrived from a search result
        had **no navigation and no language switcher**: the only way anywhere
        was back to the home page, and the only way to read it in the other
        language was to guess the URL. The mini-footer was also English on the
        Bengali page.
      */}
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
        // Every period this page states comes from the thing that enforces it.
        // A policy naming a number the sweep does not use is a promise the
        // platform breaks silently, and nobody would ever notice.
        //
        // `rejectedDays` is the foundation's own setting and an admin may change
        // it; the audit tiers are constants, deliberately — see ADR-038 on why
        // those are a code change with a review rather than a dial.
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
