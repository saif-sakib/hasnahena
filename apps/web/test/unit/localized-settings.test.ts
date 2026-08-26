import { describe, it, expect } from 'vitest';

import { orgAddress } from '@/lib/org-address';
import {
  SYSTEM_CONFIG_KEYS,
  PUBLIC_CONFIG_KEYS,
  SETTINGS_CONFIG_KEYS,
} from '@/lib/system-config';

/**
 * One address box was shown to two audiences.
 *
 * `org.address` is whatever an admin types, and there was only one of it, so the
 * foundation's real Bengali address rendered under an English "Address" heading
 * on the home page, the contact page, the support page and the footer of every
 * public page — and on the letterhead of every generated document, which
 * ADR-012 makes English only. Nothing over the source could see it: the string
 * lives in the database, not the repo. English becoming the default (WO-94) is
 * what made it visible.
 *
 * `org.name`/`org.nameEn` had already solved this for the organisation's name.
 * The address now has the same pair, and these assertions are what keep the two
 * halves from drifting apart again.
 */
describe('the office address', () => {
  const both = { 'org.address': 'ভেকুটিয়া, সদর, যশোর', 'org.addressEn': 'Bhekutia, Sadar, Jashore' };

  it('gives each language its own script', () => {
    expect(orgAddress(both, 'en')).toBe('Bhekutia, Sadar, Jashore');
    expect(orgAddress(both, 'bn')).toBe('ভেকুটিয়া, সদর, যশোর');
  });

  it('treats an unknown locale as English, like every other locale decision', () => {
    expect(orgAddress(both, 'fr')).toBe('Bhekutia, Sadar, Jashore');
    expect(orgAddress(both, '')).toBe('Bhekutia, Sadar, Jashore');
  });

  it('falls back to the other script rather than to nothing', () => {
    // A foundation that has not filled in the English box yet should show its
    // real address in the wrong script — a reader can still post a letter to
    // that — instead of an empty line or a plausible-looking invented address.
    expect(orgAddress({ 'org.address': 'ভেকুটিয়া, সদর, যশোর' }, 'en')).toBe('ভেকুটিয়া, সদর, যশোর');
    expect(orgAddress({ 'org.addressEn': 'Bhekutia, Sadar, Jashore' }, 'bn')).toBe(
      'Bhekutia, Sadar, Jashore',
    );
  });

  it('is empty when nothing is set, so a caller can choose its own fallback', () => {
    expect(orgAddress({}, 'en')).toBe('');
    expect(orgAddress(undefined, 'bn')).toBe('');
    expect(orgAddress({ 'org.address': '   ' }, 'en')).toBe('');
  });

  it('is a key an admin can actually change, and a public page can actually read', () => {
    // The three lists this has to be in, and why each one matters:
    //   SYSTEM   — `PUT /api/v1/settings` rejects any key outside it, so without
    //              this the Settings form would 400 on save for *every* field.
    //   SETTINGS — the Settings screen renders from it; missing, no admin can
    //              ever set the English address.
    //   PUBLIC   — `getPublicSettings()` selects only these, so a marketing page
    //              would read `undefined` and fall back forever.
    for (const list of [SYSTEM_CONFIG_KEYS, SETTINGS_CONFIG_KEYS, PUBLIC_CONFIG_KEYS]) {
      expect(list as readonly string[]).toContain('org.addressEn');
      // The pair only works if both halves travel together.
      expect(list as readonly string[]).toContain('org.address');
    }
  });
});
