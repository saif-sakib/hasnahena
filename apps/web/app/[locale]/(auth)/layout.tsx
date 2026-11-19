import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { normalizeLocale } from '@/lib/seo';

/**
 * Auth pages render per request so the nonce CSP (WO-76) covers the login form;
 * a prerendered page has no nonce.
 */
export const dynamic = 'force-dynamic';

type AuthLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  const t = await getTranslations({ locale: activeLocale, namespace: 'auth' });

  return {
    title: t('portalTitle'),
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
      },
    },
  };
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return children;
}
