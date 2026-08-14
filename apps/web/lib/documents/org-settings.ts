/** Organisation letterhead details, read from `system_config` via the settings API. */

import { DEFAULT_ORG } from './theme';
import type { OrgSettings } from './types';

let cached: OrgSettings | null = null;

/**
 * Letterhead values change rarely, so the first result is reused for the rest of
 * the session — printing ten receipts should not mean ten settings round-trips.
 */
export async function fetchOrgSettings(options?: { refresh?: boolean }): Promise<OrgSettings> {
  if (cached && !options?.refresh) return cached;

  try {
    const response = await fetch('/api/v1/settings', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as Record<string, string | undefined>;
      cached = {
        name: data['org.name'] || DEFAULT_ORG.name,
        nameEn: data['org.nameEn'] || DEFAULT_ORG.nameEn,
        address: data['org.address'] || DEFAULT_ORG.address,
        phone: data['org.phone'] || DEFAULT_ORG.phone,
        email: data['org.email'] || DEFAULT_ORG.email,
        website: data['org.website'] || DEFAULT_ORG.website,
        regNumber: data['org.regNumber'],
      };
      return cached;
    }
  } catch (error) {
    console.error('Failed to fetch org settings; falling back to defaults:', error);
  }

  return DEFAULT_ORG;
}

/** Drop the cached letterhead, e.g. after an admin saves new settings. */
export function clearOrgSettingsCache(): void {
  cached = null;
}
