import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/prisma';

/**
 * Every `system_config` key the platform understands. PUT /api/v1/settings
 * rejects anything else, so a typo is a 400 rather than a silent new row. Add a
 * key here LAST — only once something reads it.
 */

export const SYSTEM_CONFIG_KEYS = [
  // Loan policy, read by the Go API (repository.go getLoanPolicy and Tx readers).
  'loan.minDepositForLoan',
  'loan.maxLoanMultiplier',
  'loan.maxInstallmentMonths',
  'loan.allowActiveLoanWithdrawal',
  // Enforced by MarkLoanDefaulted (missed instalments, internal/money/schedule.go).
  // Defaulting stays admin-initiated by design.
  'loan.missedPaymentsForDefault',
  // Loans at or below this need no guarantor; 0 = always require one.
  'loan.guarantorThresholdAmount',
  // Notice the foundation ASKS for, in days. Informational only (ADR-030);
  // shown on the member savings page and the FAQ.
  'loan.noticePeriodDays',

  // Organisation identity — letterhead and public site.
  'org.name',
  'org.nameEn',
  'org.address',
  'org.addressEn',
  'org.phone',
  'org.email',
  'org.website',
  'org.regNumber',
  'org.description',
  'org.descriptionEn',

  // Landing-page presentation; image values are Cloudinary URLs.
  'hero.tagline',
  'hero.taglineEn',
  'hero.backgroundImage',
  'hero.partnerLogo1',
  'hero.partnerLogo2',
  'hero.partnerLogo3',

  // Landing-page section headings and donation details. All prose, so each has
  // an `…En` twin (lib/localized-settings.ts).
  'features.title',
  'features.titleEn',
  'contact.title',
  'contact.titleEn',
  'donation.title',
  'donation.titleEn',
  'donation.subtitle',
  'donation.subtitleEn',
  'donation.bkash',
  'donation.nagad',
  'donation.rocket',
  'donation.referenceNote',
  'donation.referenceNoteEn',

  // The one admin-overridable menu label (components/layout/header.tsx).
  'navigation.donate',
  'navigation.donateEn',

  // The four hero figures — set by the foundation, never invented. Blank hides a
  // card; all blank hides the panel.
  'stats.members',
  'stats.membersEn',
  'stats.deposits',
  'stats.depositsEn',
  'stats.loans',
  'stats.loansEn',
  'stats.charity',
  'stats.charityEn',

  // Login-page greeting, read by app/[locale]/(auth)/login/page.tsx.
  'auth.welcomeBack',
  'auth.welcomeBackEn',

  // Uploaded brand assets (app/actions/upload-settings-image.ts).
  'branding.logo',
  'branding.favicon',
  'branding.dashboardLogo',

  // Bank details for /donate. Seeded EMPTY: the card is hidden until filled,
  // since a plausible wrong number is worse than a gap.
  'bank.name',
  'bank.accountName',
  'bank.accountNo',
  'bank.branch',

  // Support.
  'support.chatRetentionDays',

  // Membership age floor, read by the form AND the registration API.
  'membership.minimumAgeYears',

  // How long a REJECTED application keeps identity data (ADR-033); read by the
  // Go retention sweep.
  'security.rejectedRetentionDays',
] as const;

/**
 * Keys the settings form used to post that NOTHING reads — kept to record
 * intent. What actually governs each today:
 *   notification.*          email always sends when BREVO_API_KEY is set; no SMS (ADR-003)
 *   security.sessionTimeout JWT_EXPIRY_SECONDS env var on Render
 *   security.loginAttempts  rateLimitPolicies in internal/services/security_service.go
 *   security.passwordExpiry / twoFactorAuth  not implemented
 *   appearance.*            locale from the URL, theme from the browser
 * To make one real: wire the reader, then move the key above and add a control.
 */
export const UNIMPLEMENTED_CONFIG_KEYS = [
  'notification.emailNotifications',
  'notification.smsNotifications',
  'notification.loanApprovalNotify',
  'notification.depositConfirmationNotify',
  'notification.paymentReminderNotify',
  'notification.newMemberNotify',
  'security.twoFactorAuth',
  'security.sessionTimeout',
  'security.passwordExpiry',
  'security.loginAttempts',
  'appearance.defaultLanguage',
  'appearance.theme',
  'appearance.dateFormat',
  'appearance.currencyFormat',
] as const;

/**
 * The subset an anonymous caller may read (WO-77) — and exactly what
 * getPublicSettings() selects, so the whole vocabulary of a public page.
 */
export const PUBLIC_CONFIG_KEYS = [
  'org.name',
  'org.nameEn',
  'org.address',
  'org.addressEn',
  'org.phone',
  'org.email',
  'org.website',
  'org.regNumber',
  'org.description',
  'org.descriptionEn',

  'hero.tagline',
  'hero.taglineEn',
  'hero.backgroundImage',
  'hero.partnerLogo1',
  'hero.partnerLogo2',
  'hero.partnerLogo3',

  'features.title',
  'features.titleEn',
  'contact.title',
  'contact.titleEn',
  'donation.title',
  'donation.titleEn',
  'donation.subtitle',
  'donation.subtitleEn',
  'donation.bkash',
  'donation.nagad',
  'donation.rocket',
  'donation.referenceNote',
  'donation.referenceNoteEn',

  'navigation.donate',
  'navigation.donateEn',

  'stats.members',
  'stats.membersEn',
  'stats.deposits',
  'stats.depositsEn',
  'stats.loans',
  'stats.loansEn',
  'stats.charity',
  'stats.charityEn',

  'auth.welcomeBack',
  'auth.welcomeBackEn',

  'branding.logo',
  'branding.favicon',
  'branding.dashboardLogo',

  'bank.name',
  'bank.accountName',
  'bank.accountNo',
  'bank.branch',

  // Public: the FAQ quotes it.
  'loan.noticePeriodDays',

  // Public: the registration form needs it before anyone has an account.
  'membership.minimumAgeYears',

  // Public: the privacy policy quotes it.
  'security.rejectedRetentionDays',
] as const;

/**
 * Public plus the loan policy a signed-in member sees about their own money
 * (the loans calculator). loan.missedPaymentsForDefault and
 * support.chatRetentionDays stay admin-only.
 */
export const MEMBER_CONFIG_KEYS = [
  ...PUBLIC_CONFIG_KEYS,
  'loan.minDepositForLoan',
  'loan.maxLoanMultiplier',
  'loan.maxInstallmentMonths',
  'loan.allowActiveLoanWithdrawal',
  'loan.guarantorThresholdAmount',
  // loan.noticePeriodDays arrives via the spread; tiers must not overlap.
] as const;

/**
 * Which admin screen owns each key: CONTENT (what pages show; Content & Media)
 * vs SETTINGS (what the foundation is and how its money works). A partition —
 * settings-keys-read.test.ts refuses gaps and overlaps.
 */
export const CONTENT_CONFIG_KEYS = [
  'hero.tagline',
  'hero.taglineEn',
  'hero.backgroundImage',
  'hero.partnerLogo1',
  'hero.partnerLogo2',
  'hero.partnerLogo3',

  'features.title',
  'features.titleEn',
  'contact.title',
  'contact.titleEn',
  'donation.title',
  'donation.titleEn',
  'donation.subtitle',
  'donation.subtitleEn',
  'donation.referenceNote',
  'donation.referenceNoteEn',

  'navigation.donate',
  'navigation.donateEn',

  'stats.members',
  'stats.membersEn',
  'stats.deposits',
  'stats.depositsEn',
  'stats.loans',
  'stats.loansEn',
  'stats.charity',
  'stats.charityEn',

  'auth.welcomeBack',
  'auth.welcomeBackEn',

  'branding.logo',
  'branding.dashboardLogo',
  'branding.favicon',
] as const;

/**
 * Organisation, money rules and payment channels. Channels stay here: a wrong
 * bKash number sends a donor's money to a stranger.
 */
export const SETTINGS_CONFIG_KEYS = [
  'org.name',
  'org.nameEn',
  'org.address',
  'org.addressEn',
  'org.phone',
  'org.email',
  'org.website',
  'org.regNumber',
  'org.description',
  'org.descriptionEn',

  'loan.minDepositForLoan',
  'loan.maxLoanMultiplier',
  'loan.maxInstallmentMonths',
  'loan.allowActiveLoanWithdrawal',
  'loan.missedPaymentsForDefault',
  'loan.guarantorThresholdAmount',
  'loan.noticePeriodDays',

  'donation.bkash',
  'donation.nagad',
  'donation.rocket',

  'bank.name',
  'bank.accountName',
  'bank.accountNo',
  'bank.branch',

  'support.chatRetentionDays',
  'security.rejectedRetentionDays',
  'membership.minimumAgeYears',
] as const;

export type SystemConfigKey = (typeof SYSTEM_CONFIG_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(SYSTEM_CONFIG_KEYS);

export function isSystemConfigKey(key: string): key is SystemConfigKey {
  return KEY_SET.has(key);
}

/** Splits submitted keys into recognised and unrecognised (all unknowns at once). */
export function partitionConfigKeys(keys: string[]): {
  known: string[];
  unknown: string[];
} {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const key of keys) {
    (isSystemConfigKey(key) ? known : unknown).push(key);
  }
  return { known, unknown };
}

/** Cache tag every public settings read shares. Invalidated by the settings PUT. */
export const SYSTEM_CONFIG_TAG = 'system-config';

/**
 * The public pages' settings map, cached per revalidation window (WO-73).
 * Only public keys — it is rendered into shared HTML. Never use it under
 * dashboard/, where reads are per-member.
 */
export async function getPublicSettings(): Promise<Record<string, string>> {
  try {
    return await getCachedPublicSettings();
  } catch (error) {
    // Pages must render without a database (the Docker build has none). The
    // catch is OUTSIDE the cache, which never stores a rejection — so an outage
    // is retried rather than memoised for an hour.
    console.error('Public settings unavailable; rendering fallback copy:', error);
    return {};
  }
}

const getCachedPublicSettings = unstable_cache(
  async () => {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { in: [...PUBLIC_CONFIG_KEYS] } },
      select: { key: true, value: true },
    });
    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  },
  ['public-settings'],
  // The tag is the real invalidation; the interval catches direct DB edits.
  { tags: [SYSTEM_CONFIG_TAG], revalidate: 3600 },
);
