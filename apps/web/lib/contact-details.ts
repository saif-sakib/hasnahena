import { orgAddress } from '@/lib/localized-settings';

/**
 * The three ways to reach the foundation, read the same way everywhere.
 *
 * Four surfaces render these — the footer of every public page, the home page's
 * contact section, `/contact` and `/support` — and before T-10 each read the
 * settings map itself and made its own decision about a missing value. They
 * disagreed: `/contact` and `/support` showed a blank line (WO-67's rule), while
 * the home page and the footer fell back to `+880 1XXX-XXXXXX` and
 * `info@hasnahenafoundation.com`. So the same unconfigured deployment showed a
 * visitor an invented phone number on the two most-visited surfaces and an empty
 * card on the two that were fixed.
 *
 * **A blank is the right failure.** A missing number is a question somebody
 * asks; a plausible wrong one is a call that reaches nobody, and the caller
 * blames the foundation rather than the placeholder.
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

/**
 * `tel:` wants digits, not typography.
 *
 * `org.phone` is typed by a person — "+880 1712-345678" — and a dialer handed
 * the spaces and the hyphen may or may not strip them. Keeping only the digits
 * and a leading `+` costs nothing and works on every handset, which on an
 * Android-first site is the case that matters.
 */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
