/**
 * The browser's ONLY way to read GET /api/v1/settings. It attaches the token;
 * without one the caller silently gets the public tier (WO-77). Anonymous
 * callers (login, marketing) are fine.
 */

import { getValidatedClientToken } from '@/lib/client-auth';

export async function fetchSettings(
  init?: { cache?: RequestCache },
): Promise<Record<string, string> | null> {
  const token = getValidatedClientToken();
  const response = await fetch('/api/v1/settings', {
    cache: init?.cache ?? 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return response.ok ? ((await response.json()) as Record<string, string>) : null;
}
