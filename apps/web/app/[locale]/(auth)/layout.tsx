import type { Metadata } from 'next';

/**
 * The four auth pages are server-rendered on demand, and it is WO-76 that needs
 * them so rather than anything about the pages themselves.
 *
 * They are where a password is typed and where a session begins, so they belong
 * in the strict half of the CSP — the half whose `script-src` carries a nonce
 * and refuses inline scripts. Next can only inject that nonce while rendering a
 * request, which a prerendered page does not have. Left static they would have
 * been served a policy that blocks their own hydration the day enforcement is
 * switched on.
 *
 * The cost is four routes that render per request instead of from cache. They
 * are `noindex` and read no database, so the trade is a few milliseconds
 * against the CSP covering the login form.
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
