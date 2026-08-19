import type { Metadata } from 'next';
import { Hind_Siliguri, Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
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

/**
 * WO-73. Without this, `[locale]` is a dynamic segment with no known values, so
 * **every** route under it is server-rendered on demand — all 50 of them, which
 * is what `next build` reported before this existed. Naming the two locales is
 * what lets a page that opts into caching actually be prerendered.
 *
 * It does not make anything static by itself: a page still becomes static only
 * if nothing in it reads a request. That is why `dashboard/` stays dynamic —
 * those pages are client components reading a token — and why the marketing
 * pages each carry their own `revalidate`.
 */
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
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

  // Required for static rendering: next-intl otherwise reads the locale from
  // the request, which opts the whole subtree out of prerendering. It must run
  // before getMessages().
  setRequestLocale(locale);

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
