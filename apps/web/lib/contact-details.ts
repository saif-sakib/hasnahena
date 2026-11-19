import { orgAddress } from '@/lib/localized-settings';

/**
 * Official social profile URL, shared between the footer and JSON-LD `sameAs`.
 */
export const ORG_FACEBOOK_URL = 'https://www.facebook.com/share/18KYP6p25Z/';
export const ORG_SAME_AS = [ORG_FACEBOOK_URL] as const;

/**
 * The address, phone and email, read the same way on every surface (footer,
 * home, /contact, /support). A missing value is BLANK — a plausible wrong
 * number is worse.
 */
export interface ContactDetails {
  address: string;
  phone: string;
  email: string;
}

export function contactDetails(
  settings: Record<string, string> | null | undefined,
  locale: string,
): ContactDetails {
  return {
    // Not `settings['org.address']`: one box, two audiences — see
    // lib/localized-settings.ts.
    address: orgAddress(settings, locale),
    phone: settings?.['org.phone']?.trim() || '',
    email: settings?.['org.email']?.trim() || '',
  };
}

/** `tel:` href with only digits and a leading `+`. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/**
 * Normalise a local Bangladesh 11-digit mobile number (`01XXXXXXXXX`) into E.164
 * (`+8801XXXXXXXXX`) for Schema.org `telephone`; other inputs stay trimmed as-is.
 */
export function normalizeSchemaTelephone(phone: string | undefined): string | undefined {
  const trimmed = phone?.trim();
  if (!trimmed) return undefined;
  const compact = trimmed.replace(/[\s()-]/g, '');
  if (/^01\d{9}$/.test(compact)) {
    return `+88${compact}`;
  }
  return trimmed;
}
