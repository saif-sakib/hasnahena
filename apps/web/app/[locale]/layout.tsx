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

/*
 * Inter sets Latin, Hind Siliguri sets Bengali: the stack in globals.css names
 * both, so each glyph falls to the face that has it. Hind's Latin subset is
 * never reached (Inter is first) — not loading it saves four preloads.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const hindSiliguri = Hind_Siliguri({
  subsets: ['bengali'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bengali',
  display: 'swap',
});

interface RootLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Names both locales so pages can be prerendered (WO-73); a page is static only
 * if nothing reads the request, so dashboard/ stays dynamic.
 */
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/**
 * Browser-chrome colour. Belongs in `viewport`, not `metadata` (Next warns;
 * the Metadata type still accepts it).
 */
export const viewport: Viewport = {
  themeColor: '#059669',
};

/**
 * Tab and home-screen icon from branding.favicon, falling back to public/ (the
 * settings read may return {}). Set on icon, shortcut and apple — three <link>s.
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
      // The full name, the one people search for.
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
    // Home-screen icons and name (app/manifest.ts).
    manifest: '/manifest.webmanifest',
    // Search Console / Bing verification from the environment (lib/seo).
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

  // Required for static rendering, before getMessages().
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    // The font variables live on <html>: the theme's --font-sans is declared on
    // :root and resolves them there.
    <html lang={locale} className={`${inter.variable} ${hindSiliguri.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased min-h-screen flex flex-col">
        <NextIntlClientProvider messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
