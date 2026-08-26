/** Organisation letterhead details, read from `system_config` via the settings API. */

import { fetchSettings } from '@/lib/settings-client';

import { DEFAULT_ORG } from './theme';
import type { OrgSettings } from './types';
import { localizedSettingPair, orgAddress } from '@/lib/localized-settings';

let cached: OrgSettings | null = null;

/**
 * Letterhead values change rarely, so the first result is reused for the rest of
 * the session — printing ten receipts should not mean ten settings round-trips.
 */
export async function fetchOrgSettings(options?: { refresh?: boolean }): Promise<OrgSettings> {
  if (cached && !options?.refresh) return cached;

  try {
    // Every `org.*` key here is in the anonymous tier, so this would work
    // without a token. It goes through fetchSettings anyway so that there is
    // exactly one place in the browser that knows how to call this endpoint —
    // the reason the four screens that did not send a token were all wrong at
    // once (WO-77).
    const data = await fetchSettings();
    if (data) {
      // Both halves, through the pair helper — this is the one caller that
      // wants each language rather than the reader's, because the letterhead
      // prints the Bengali legal name above the English one. Reading the two
      // rows directly worked, and also meant a foundation that had filled in
      // only one of them got the *built-in default* for the other rather than
      // its own name in the other script.
      const orgNames = localizedSettingPair(data, 'org.name');
      cached = {
        name: orgNames.bn || DEFAULT_ORG.name,
        nameEn: orgNames.en || DEFAULT_ORG.nameEn,
        // English. Generated documents are English only (ADR-012), so the
        // letterhead takes the English address and falls back to whatever the
        // single old box holds.
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
