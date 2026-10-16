/** Organisation letterhead details, read from `system_config` via the settings API. */

import { fetchSettings } from '@/lib/settings-client';

import { DEFAULT_ORG } from './theme';
import type { OrgSettings } from './types';
import { localizedSettingPair, orgAddress } from '@/lib/localized-settings';

let cached: OrgSettings | null = null;

/** Letterhead values, cached for the session. */
export async function fetchOrgSettings(options?: { refresh?: boolean }): Promise<OrgSettings> {
  if (cached && !options?.refresh) return cached;

  try {
    // Through fetchSettings — the one browser caller of this endpoint (WO-77).
    const data = await fetchSettings();
    if (data) {
      // Both halves of the name: the letterhead prints Bengali above English.
      const orgNames = localizedSettingPair(data, 'org.name');
      cached = {
        name: orgNames.bn || DEFAULT_ORG.name,
        nameEn: orgNames.en || DEFAULT_ORG.nameEn,
        // English address (documents are English, ADR-012).
        address: orgAddress(data, 'en') || DEFAULT_ORG.address,
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
