import type { Metadata } from 'next';

/**
 * Every route under `dashboard/` is server-rendered on demand, and must stay
 * that way.
 *
 * WO-73 gave `[locale]` a `generateStaticParams` so the marketing pages could
 * be prerendered. That applies to the whole subtree, and it swept these in too:
 * the first build after it emitted `● /en/dashboard/member` — a member's page,
 * prerendered once and served to whoever asked next.
 *
 * Today that leaks nothing, because these pages are client components that
 * fetch their data with the reader's own token, so the prerendered HTML is an
 * empty shell. That is a property of how they happen to be written, not a rule
 * anyone stated, and the day one of them reads a balance on the server the
 * failure is silent and it is somebody's money on a stranger's screen.
 *
 * So the rule is stated here, at the layout every one of them inherits, and
 * `scripts/assert-static-routes.mjs` fails the build if a dashboard route is
 * ever prerendered again.
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
