import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/i18n';
import { Toaster } from '@/components/ui/toaster';
import '../globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: {
    template: '%s | Hasnahena',
    default: 'Hasnahena - Interest-Free Cooperative Finance',
  },
  description:
    'Join our Qard al-Hasan community for ethical, Sharia-compliant loans with zero interest. A community-driven cooperative finance platform.',
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
  openGraph: {
    title: 'Hasnahena - Interest-Free Cooperative Finance',
    description:
      'Join our Qard al-Hasan community for ethical, Sharia-compliant loans with zero interest.',
    url: 'https://hasnahena.org',
    siteName: 'Hasnahena',
    locale: 'bn_BD',
    type: 'website',
  },
};

interface RootLayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function RootLayout({
  children,
  params: { locale },
}: RootLayoutProps) {
  // Validate locale
  if (!locales.includes(locale as any)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Bengali font support */}
        <link
          href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${inter.variable} font-sans antialiased min-h-screen flex flex-col`}
      >
        <NextIntlClientProvider messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
