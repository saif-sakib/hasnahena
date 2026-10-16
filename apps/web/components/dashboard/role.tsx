'use client';

import { createContext, useContext } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Which dashboard a screen is rendered inside. Worker and admin share one
 * component per screen (components/dashboard/screens), which asks this to
 * decide what to SHOW. Presentation only — the Go router and Next handlers
 * authorise; proxy.ts pins the URL segment to the caller's role.
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

/** The current dashboard: context first, pathname as fallback (never defaulting silently). */
export function useDashboardRole(): DashboardRole {
  const fromContext = useContext(DashboardRoleContext);
  const pathname = usePathname();
  return fromContext ?? dashboardRoleFromPath(pathname);
}

/** True in the admin dashboard. Reads better than `role === 'admin'` at call sites. */
export function useIsAdmin(): boolean {
  return useDashboardRole() === 'admin';
}
