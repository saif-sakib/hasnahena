'use client';

import { createContext, useContext } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Which dashboard a screen is being rendered inside.
 *
 * Why this exists
 * ---------------
 * The worker dashboard and the admin dashboard are the same screens. They were
 * not, and the drift was expensive: `dashboard/worker/deposits` and
 * `dashboard/admin/deposits` were two files that listed the same postings with
 * different columns, different filters and different bugs, while
 * `dashboard/worker/approvals` was a one-line re-export of the admin page that
 * called an admin-only endpoint and answered 403 for every worker who opened it.
 *
 * So there is now one component per screen, in `components/dashboard/screens`,
 * and it asks *which dashboard am I in* to decide what to show. What it must
 * never do is treat that answer as authorisation: this is presentation only.
 * Every endpoint those screens call is gated in the Go router
 * (`cmd/server/main.go`) or in the Next handler, and that gate is the one that
 * counts. Hiding a button the API would refuse is courtesy; the refusal is the
 * security.
 *
 * The value is pinned to the URL segment, and `proxy.ts` pins the URL segment to
 * the caller's role — a worker who types `/dashboard/admin/settings` is
 * redirected rather than served an admin shell whose every request 403s.
 */
export type DashboardRole = 'member' | 'worker' | 'admin';

const DashboardRoleContext = createContext<DashboardRole | null>(null);

export function DashboardRoleProvider({
  role,
  children,
}: {
  role: DashboardRole;
  children: React.ReactNode;
}) {
  return <DashboardRoleContext.Provider value={role}>{children}</DashboardRoleContext.Provider>;
}

/** `/en/dashboard/worker/loans` → `worker`. */
export function dashboardRoleFromPath(pathname: string | null): DashboardRole {
  const segment = pathname?.split('/')[3];
  if (segment === 'admin' || segment === 'worker') return segment;
  return 'member';
}

/**
 * The dashboard the current screen belongs to.
 *
 * The context is the fast path; the pathname is the fallback, so a screen
 * rendered outside the layout in a test still gets the right answer instead of
 * silently defaulting to the least-privileged one.
 */
export function useDashboardRole(): DashboardRole {
  const fromContext = useContext(DashboardRoleContext);
  const pathname = usePathname();
  return fromContext ?? dashboardRoleFromPath(pathname);
}

/** True in the admin dashboard. Reads better than `role === 'admin'` at call sites. */
export function useIsAdmin(): boolean {
  return useDashboardRole() === 'admin';
}

/** True in either staff dashboard. */
export function useIsStaff(): boolean {
  return useDashboardRole() !== 'member';
}
