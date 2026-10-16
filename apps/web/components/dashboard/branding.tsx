'use client';

import useSWR from 'swr';

import { fetchSettings } from '@/lib/settings-client';

/**
 * The sidebar brand image (branding.dashboardLogo), fetched once from the
 * browser. Not read in the dashboard's server layout: that put a DB round trip
 * on every navigation and, by delaying mount, triggered the shell's 401 race and
 * logged users out. Public key, no token; one request per tab.
 */
export function useDashboardBranding(): { dashboardLogo: string | undefined } {
  const { data: settings } = useSWR<Record<string, string> | null>(
    'dashboard-branding',
    () => fetchSettings({ cache: 'default' }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
      dedupingInterval: 60 * 60 * 1000,
    },
  );

  // Empty string means "no image uploaded", which is a different thing from
  // "not loaded yet" only to this hook — both render the shipped lockup.
  return { dashboardLogo: settings?.['branding.dashboardLogo'] || undefined };
}
