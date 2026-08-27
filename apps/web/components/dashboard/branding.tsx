'use client';

import useSWR from 'swr';

import { fetchSettings } from '@/lib/settings-client';

/**
 * The brand image the dashboard shell renders in its sidebar.
 *
 * Why a client fetch rather than a server read
 * -------------------------------------------
 * The obvious shape was to read `getPublicSettings()` in
 * `app/[locale]/dashboard/layout.tsx` — a server component, cached, no request
 * from the browser at all — and hand the value down through a context. That was
 * written first and reverted, for two reasons found by running it:
 *
 *  1. **It put a Neon round trip on every dashboard navigation.** That layout is
 *     `force-dynamic`, so the cache lookup is per request, and the members this
 *     is for are on a phone connection in Jessore. A logo is not worth adding
 *     latency to every screen a field worker opens.
 *  2. **Awaiting in that layout changed when the shell mounts**, and the shell
 *     has a race in its mount-time effects: a fetch that lands without a token
 *     produces a 401, and the 401 handler clears the session and redirects to
 *     the login page. Slowing the parent down was enough to make it fire, so
 *     every dashboard navigation logged the user straight back out. That race is
 *     a real defect in `dashboard-layout.tsx` and is worth fixing on its own
 *     terms; provoking it to render a logo is not.
 *
 * So: one fetch, from the browser, of an endpoint it already talks to.
 *
 * `branding.dashboardLogo` is in `PUBLIC_CONFIG_KEYS`, so this needs no token
 * and cannot fail in a way that touches the session — which is the property
 * that matters after the paragraph above. The SWR options make it a single
 * request per tab: no revalidation on focus, on reconnect, or on stale, and an
 * hour-long dedupe window. It is invisible to `e2e/dashboard-traffic.spec.ts`,
 * which counts the notification and support endpoints, and it is not polling.
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
