import type { Metadata, Viewport } from 'next';
import { Hind_Siliguri, Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n';
import { Toaster } from '@/components/ui/toaster';
import {
  SITE_NAME,
  SITE_DESCRIPTION,
  createLocalizedMetadata,
  normalizeLocale,
  siteBaseUrl,
  siteTitle,
  siteVerification,
} from '@/lib/seo';
import { getPublicSettings } from '@/lib/system-config';
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

/**
 * `themeColor` colours the browser chrome on Android and the tab strip on
 * desktop Chrome — emerald, matching the mark.
 *
 * It belongs in the `viewport` export and NOT in `metadata`: Next moved it there
 * and warns on every build if it is left behind, and the `Metadata` type still
 * accepts the field, so typecheck does not catch the mistake.
 */
export const viewport: Viewport = {
  themeColor: '#059669',
};

/**
 * The tab icon, and the one an Android home-screen shortcut gets.
 *
 * `branding.favicon` had a control on Content & Media and **no reader anywhere**
 * — an admin could upload one, see it stored, and watch the tab keep the shipped
 * leaf forever. It is read here, which is the only place a document's `<head>`
 * is decided for every route on the site.
 *
 * Falls back to the files in `public/`. The fallback is not decoration: the
 * settings read can legitimately return `{}` (a fresh database, a transient Neon
 * blip — see getPublicSettings), and a site whose favicon disappears when the
 * database hiccups would be a strange thing to have built.
 *
 * The uploaded value goes in `shortcut` and `apple` as well as `icon` because
 * those are three separate `<link rel>`s and a browser that reads only one of
 * them would otherwise still show the old mark.
 */
function iconsFor(faviconUrl: string | undefined): Metadata['icons'] {
  const uploaded = faviconUrl?.trim();
  if (uploaded) {
    return {
      icon: [{ url: uploaded }],
      shortcut: [{ url: uploaded }],
      apple: [{ url: uploaded }],
    };
  }
  return {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: [{ url: '/favicon.ico' }],
    apple: [{ url: '/apple-icon.png' }],
  };
}

export async function generateMetadata({ params }: RootLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  const settings = await getPublicSettings();
  const activeLocale = normalizeLocale(locale);
  const localizedMetadata = createLocalizedMetadata({
    locale: activeLocale,
    path: '/',
    title: siteTitle(activeLocale),
    description: SITE_DESCRIPTION,
  });

  return {
    ...localizedMetadata,
    metadataBase: siteBaseUrl,
    title: {
      // `%s | Hasnahena Foundation` rather than `%s | Hasnahena`. The full name
      // is the one people search for, and a page title is one of the few places
      // a search engine reads it on every route rather than only on the home
      // page.
      template: `%s | ${SITE_NAME}`,
      default: siteTitle(activeLocale),
    },
    keywords: [
      'Hasnahena Foundation',
      'Qard al-Hasan',
      'interest-free loan',
      'Islamic finance',
      'cooperative society',
      'Jashore',
      'Bangladesh',
      'হাসনাহেনা ফাউন্ডেশন',
      'কর্জে হাসানা',
      'সুদমুক্ত ঋণ',
      'যশোর',
    ],
    applicationName: SITE_NAME,
    authors: [{ name: 'Md Saif Ahmed' }],
    icons: iconsFor(settings['branding.favicon']),
    // The manifest carries the icons a phone uses for a home-screen shortcut,
    // and one more crawlable statement of the site's name. See app/manifest.ts.
    manifest: '/manifest.webmanifest',
    // Ownership tokens for Search Console and, the one that was missing
    // entirely, Bing Webmaster Tools. Read from the environment: the value is
    // issued to whoever proves they own the domain, so it cannot live in the
    // repository, and unset it emits nothing — see siteVerification in lib/seo.
    verification: siteVerification(),
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
