import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { locales, type Locale } from '@/i18n';
import { createLocalizedMetadata, normalizeLocale } from '@/lib/seo';

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

  const content = {
    en: {
      title: 'Privacy Policy',
      lastUpdated: 'Last updated: March 2026',
      backToHome: 'Back to Home',
      sections: [
        {
          title: 'Information We Collect',
          content: 'We collect information you provide directly to us, such as when you create an account, make a transaction, or contact us for support. This includes your name, email address, phone number, and financial information necessary for our microfinance services.',
        },
        {
          title: 'How We Use Your Information',
          content: 'We use the information we collect to provide, maintain, and improve our services, process transactions, communicate with you, and ensure the security of your account.',
        },
        {
          title: 'Information Sharing',
          content: 'We do not sell or share your personal information with third parties for marketing purposes. We may share information with service providers who assist in our operations, or when required by law.',
        },
        {
          title: 'Data Security',
          content: 'We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.',
        },
        {
          title: 'Your Rights',
          content: 'You have the right to access, correct, or delete your personal information. Contact us to exercise these rights or if you have any questions about our privacy practices.',
        },
        {
          title: 'Contact Us',
          content: 'If you have any questions about this Privacy Policy, please contact us through our website or visit one of our branch offices.',
        },
      ],
    },
    bn: {
      title: 'গোপনীয়তা নীতি',
      lastUpdated: 'সর্বশেষ আপডেট: মার্চ ২০২৬',
      backToHome: 'হোমে ফিরুন',
      sections: [
        {
          title: 'আমরা যে তথ্য সংগ্রহ করি',
          content: 'আপনি যখন অ্যাকাউন্ট তৈরি করেন, লেনদেন করেন, বা সাপোর্টের জন্য যোগাযোগ করেন তখন আপনি সরাসরি আমাদের যে তথ্য প্রদান করেন তা আমরা সংগ্রহ করি। এতে আপনার নাম, ইমেইল ঠিকানা, ফোন নম্বর এবং আমাদের মাইক্রোফাইন্যান্স সেবার জন্য প্রয়োজনীয় আর্থিক তথ্য অন্তর্ভুক্ত।',
        },
        {
          title: 'আমরা কীভাবে আপনার তথ্য ব্যবহার করি',
          content: 'আমরা সংগৃহীত তথ্য ব্যবহার করি আমাদের সেবা প্রদান, রক্ষণাবেক্ষণ এবং উন্নত করতে, লেনদেন প্রক্রিয়া করতে, আপনার সাথে যোগাযোগ করতে এবং আপনার অ্যাকাউন্টের নিরাপত্তা নিশ্চিত করতে।',
        },
        {
          title: 'তথ্য শেয়ারিং',
          content: 'আমরা বিপণনের উদ্দেশ্যে তৃতীয় পক্ষের কাছে আপনার ব্যক্তিগত তথ্য বিক্রি বা শেয়ার করি না। আমরা আমাদের কার্যক্রমে সহায়তাকারী সেবা প্রদানকারীদের সাথে বা আইন দ্বারা প্রয়োজন হলে তথ্য শেয়ার করতে পারি।',
        },
        {
          title: 'ডেটা নিরাপত্তা',
          content: 'আমরা আপনার ব্যক্তিগত তথ্যকে অননুমোদিত অ্যাক্সেস, পরিবর্তন, প্রকাশ বা ধ্বংসের বিরুদ্ধে সুরক্ষিত রাখতে উপযুক্ত প্রযুক্তিগত এবং সাংগঠনিক ব্যবস্থা বাস্তবায়ন করি।',
        },
        {
          title: 'আপনার অধিকার',
          content: 'আপনার ব্যক্তিগত তথ্য অ্যাক্সেস, সংশোধন বা মুছে ফেলার অধিকার আপনার আছে। এই অধিকারগুলি প্রয়োগ করতে বা আমাদের গোপনীয়তা অনুশীলন সম্পর্কে কোন প্রশ্ন থাকলে আমাদের সাথে যোগাযোগ করুন।',
        },
        {
          title: 'যোগাযোগ করুন',
          content: 'এই গোপনীয়তা নীতি সম্পর্কে আপনার কোন প্রশ্ন থাকলে, অনুগ্রহ করে আমাদের ওয়েবসাইটের মাধ্যমে যোগাযোগ করুন অথবা আমাদের যেকোনো শাখা অফিসে যান।',
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
