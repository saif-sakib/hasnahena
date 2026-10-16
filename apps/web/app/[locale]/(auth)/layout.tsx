import type { Metadata } from 'next';

/**
 * Auth pages render per request so the nonce CSP (WO-76) covers the login form;
 * a prerendered page has no nonce.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
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

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
