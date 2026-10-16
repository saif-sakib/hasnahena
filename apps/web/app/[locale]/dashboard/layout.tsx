import type { Metadata } from 'next';

/**
 * Every dashboard route is rendered per request and must stay so — a
 * prerendered member page would be served to the next visitor.
 * scripts/assert-static-routes.mjs fails the build otherwise.
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

export default function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
