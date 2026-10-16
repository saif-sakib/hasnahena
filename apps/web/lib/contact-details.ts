import { orgAddress } from '@/lib/localized-settings';

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
