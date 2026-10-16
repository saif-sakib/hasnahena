/**
 * When the two legal pages last changed — move the date with the wording.
 * legal.test.ts refuses a non-ISO or future date. The wording is in
 * messages/{en,bn}.json under `legal.*`, inside the fee-promise census.
 */

/** Last revised for tiered retention (ADR-038). */
export const PRIVACY_LAST_UPDATED = '2026-08-27';

/** Last revised for the ৳500 office-expense ruling (ADR-045). */
export const TERMS_LAST_UPDATED = '2026-09-28';

/** A revision date in the reader's language (bn-BD, as the gallery uses). */
export function formatLegalDate(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
