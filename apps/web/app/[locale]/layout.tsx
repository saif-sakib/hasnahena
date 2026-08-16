import type { Metadata } from 'next';
import { Hind_Siliguri, Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n';
import { Toaster } from '@/components/ui/toaster';
import { SITE_NAME, SITE_DESCRIPTION, createLocalizedMetadata, normalizeLocale, siteBaseUrl } from '@/lib/seo';
import '../globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const hindSiliguri = Hind_Siliguri({
  subsets: ['bengali', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bengali',
  display: 'swap',
});

interface RootLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: RootLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  const localizedMetadata = createLocalizedMetadata({
    locale: activeLocale,
    path: '/',
    title:
      activeLocale === 'bn'
        ? `${SITE_NAME} - সুদমুক্ত সমবায় অর্থায়ন`
        : `${SITE_NAME} - Interest-Free Cooperative Finance`,
    description: SITE_DESCRIPTION,
  });

  return {
    ...localizedMetadata,
    metadataBase: siteBaseUrl,
    title: {
      template: `%s | ${SITE_NAME}`,
      default:
        activeLocale === 'bn'
          ? `${SITE_NAME} - সুদমুক্ত সমবায় অর্থায়ন`
          : `${SITE_NAME} - Interest-Free Cooperative Finance`,
    },
    keywords: [
      'Qard al-Hasan',
      'interest-free loan',
      'Islamic finance',
      'cooperative',
      'Bangladesh',
      'কর্জে হাসানা',
      'সুদমুক্ত ঋণ',
    ],
    authors: [{ name: 'Md Saif Ahmed' }],
  };
}

export default async function RootLayout({
  children,
  params,
}: RootLayoutProps) {
  const { locale } = await params;

  // Validate locale
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${hindSiliguri.variable} font-sans antialiased min-h-screen flex flex-col`}
      >
        <NextIntlClientProvider messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
