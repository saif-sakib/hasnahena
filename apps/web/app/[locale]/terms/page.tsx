import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { locales, type Locale } from '@/i18n';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';

type PageProps = { params: { locale: string } };

export function generateMetadata({ params: { locale } }: PageProps): Metadata {
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

export default function TermsPage({ params: { locale } }: PageProps) {
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  const content = {
    en: {
      title: 'Terms of Service',
      lastUpdated: 'Last updated: March 2026',
      backToHome: 'Back to Home',
      sections: [
        {
          title: 'Acceptance of Terms',
          content: 'By accessing and using the Hasnahena Foundation services, you accept and agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.',
        },
        {
          title: 'Service Description',
          content: 'Hasnahena Foundation provides interest-free microfinance services including savings accounts, loans, and financial management tools to our members. Our services operate under Islamic finance principles.',
        },
        {
          title: 'Account Registration',
          content: 'To use our services, you must register for an account and provide accurate, complete information. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.',
        },
        {
          title: 'Member Responsibilities',
          content: 'Members agree to use our services only for lawful purposes, provide truthful information, make timely repayments on any loans, and comply with all applicable laws and regulations.',
        },
        {
          title: 'Loan Terms',
          content: 'Loans provided by Hasnahena Foundation are interest-free but may include administrative fees. Specific terms, repayment schedules, and conditions will be provided in individual loan agreements.',
        },
        {
          title: 'Privacy',
          content: 'Your use of our services is also governed by our Privacy Policy. Please review our Privacy Policy to understand how we collect, use, and protect your information.',
        },
        {
          title: 'Termination',
          content: 'We may terminate or suspend your account at any time for violation of these terms or for any other reason. You may also close your account at any time by contacting us.',
        },
        {
          title: 'Changes to Terms',
          content: 'We reserve the right to modify these terms at any time. We will notify members of significant changes. Continued use of our services after changes constitute acceptance of the new terms.',
        },
        {
          title: 'Contact',
          content: 'For questions about these Terms of Service, please contact us through our website or visit one of our branch offices.',
        },
      ],
    },
    bn: {
      title: 'সেবার শর্তাবলী',
      lastUpdated: 'সর্বশেষ আপডেট: মার্চ ২০২৬',
      backToHome: 'হোমে ফিরুন',
      sections: [
        {
          title: 'শর্তাবলী গ্রহণ',
          content: 'হাসনাহেনা ফাউন্ডেশনের সেবা ব্যবহার করে আপনি এই সেবার শর্তাবলী মেনে চলতে সম্মত হচ্ছেন। আপনি যদি এই শর্তাবলীতে সম্মত না হন, দয়া করে আমাদের সেবা ব্যবহার করবেন না।',
        },
        {
          title: 'সেবার বিবরণ',
          content: 'হাসনাহেনা ফাউন্ডেশন আমাদের সদস্যদের জন্য সুদমুক্ত মাইক্রোফাইন্যান্স সেবা প্রদান করে যার মধ্যে সঞ্চয় অ্যাকাউন্ট, ঋণ এবং আর্থিক ব্যবস্থাপনা সরঞ্জাম অন্তর্ভুক্ত। আমাদের সেবা ইসলামিক অর্থনীতির নীতি অনুসারে পরিচালিত হয়।',
        },
        {
          title: 'অ্যাকাউন্ট নিবন্ধন',
          content: 'আমাদের সেবা ব্যবহার করতে আপনাকে একটি অ্যাকাউন্টের জন্য নিবন্ধন করতে হবে এবং সঠিক, সম্পূর্ণ তথ্য প্রদান করতে হবে। আপনার অ্যাকাউন্ট শংসাপত্রের গোপনীয়তা রক্ষা এবং আপনার অ্যাকাউন্টের অধীনে সমস্ত কার্যকলাপের জন্য আপনি দায়ী।',
        },
        {
          title: 'সদস্যদের দায়িত্ব',
          content: 'সদস্যরা সম্মত হন যে তারা শুধুমাত্র বৈধ উদ্দেশ্যে আমাদের সেবা ব্যবহার করবেন, সত্য তথ্য প্রদান করবেন, যেকোনো ঋণের সময়মতো পরিশোধ করবেন এবং সমস্ত প্রযোজ্য আইন ও বিধি মেনে চলবেন।',
        },
        {
          title: 'ঋণের শর্তাবলী',
          content: 'হাসনাহেনা ফাউন্ডেশন কর্তৃক প্রদত্ত ঋণ সুদমুক্ত কিন্তু প্রশাসনিক ফি অন্তর্ভুক্ত থাকতে পারে। নির্দিষ্ট শর্তাবলী, পরিশোধের সময়সূচী এবং শর্তাবলী পৃথক ঋণ চুক্তিতে প্রদান করা হবে।',
        },
        {
          title: 'গোপনীয়তা',
          content: 'আমাদের সেবা ব্যবহার আমাদের গোপনীয়তা নীতি দ্বারাও পরিচালিত। আমরা কীভাবে আপনার তথ্য সংগ্রহ, ব্যবহার এবং সুরক্ষা করি তা বুঝতে অনুগ্রহ করে আমাদের গোপনীয়তা নীতি পর্যালোচনা করুন।',
        },
        {
          title: 'সমাপ্তি',
          content: 'এই শর্তাবলী লঙ্ঘন বা অন্য কোনো কারণে আমরা যেকোনো সময় আপনার অ্যাকাউন্ট বন্ধ বা স্থগিত করতে পারি। আমাদের সাথে যোগাযোগ করে আপনিও যেকোনো সময় আপনার অ্যাকাউন্ট বন্ধ করতে পারেন।',
        },
        {
          title: 'শর্তাবলীতে পরিবর্তন',
          content: 'আমরা যেকোনো সময় এই শর্তাবলী পরিবর্তন করার অধিকার সংরক্ষণ করি। উল্লেখযোগ্য পরিবর্তনের বিষয়ে আমরা সদস্যদের জানাব। পরিবর্তনের পরেও আমাদের সেবা ব্যবহার অব্যাহত রাখলে তা নতুন শর্তাবলী গ্রহণ বলে গণ্য হবে।',
        },
        {
          title: 'যোগাযোগ',
          content: 'এই সেবার শর্তাবলী সম্পর্কে প্রশ্নের জন্য, অনুগ্রহ করে আমাদের ওয়েবসাইটের মাধ্যমে যোগাযোগ করুন অথবা আমাদের যেকোনো শাখা অফিসে যান।',
        },
      ],
    },
  };

  const t = content[(locale as keyof typeof content)] || content.en;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 py-4">
        <div className="container mx-auto px-4 flex items-center justify-between">
          <Link href={`/${locale}`}>
            <Logo size="sm" />
          </Link>
          <Link href={`/${locale}`}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t.backToHome}
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
          {t.title}
        </h1>
        <p className="text-sm text-slate-500 mb-8">{t.lastUpdated}</p>

        <div className="space-y-8">
          {t.sections.map((section, index) => (
            <section key={index} className="bg-white dark:bg-slate-900 rounded-lg p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
                {section.title}
              </h2>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {section.content}
              </p>
            </section>
          ))}
        </div>
      </main>

      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-slate-500">
          <p>&copy; {new Date().getFullYear()} Hasnahena Foundation. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
