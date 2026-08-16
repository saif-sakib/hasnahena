/**
 * The complete set of `system_config` keys the platform understands.
 *
 * Why an allow-list exists at all
 * ------------------------------
 * `PUT /api/v1/settings` used to upsert whatever keys it was handed. A typo in a
 * request — `loan.maxLoanMultipler`, `org.emial` — created a brand-new row that
 * looked exactly like a real setting in the database and in Prisma Studio, while
 * the code went on reading the correctly-spelled key and its built-in default.
 *
 * That failure is silent in both directions: the admin sees their value saved,
 * and the behaviour never changes. Rejecting unknown keys turns a permanent
 * mystery into a 400 at the moment it happens.
 *
 * Keeping this in sync
 * --------------------
 * A key belongs here once something reads it. Adding a row to this list is the
 * *last* step of adding a setting, not the first — if nothing reads it, it is not
 * a setting, it is a note.
 */

export const SYSTEM_CONFIG_KEYS = [
  // Loan policy. The first four are read by the Go API in
  // internal/repositories/repository.go (getLoanPolicy) and seeded by
  // scripts/seed.mjs.
  'loan.minDepositForLoan',
  'loan.maxLoanMultiplier',
  'loan.maxInstallmentMonths',
  'loan.allowActiveLoanWithdrawal',
  'loan.missedPaymentsForDefault',
  // Loans at or below this amount need no guarantor and go straight to
  // PENDING_APPROVAL. product.md has always specified a threshold; until WO-45
  // the application endpoint demanded a guarantor for every loan regardless.
  // Set to 0 to require a guarantor on every loan.
  'loan.guarantorThresholdAmount',
  // Settable today, and enforced by nothing — FR-08 is still open. Listed so the
  // admin UI keeps working, but changing it currently has no effect on a
  // withdrawal. Do not read that as the setting being broken; the feature is.
  'loan.noticePeriodMonths',

  // Organisation identity. Used on generated documents (letterhead) and the
  // public site, so a wrong value here is visible to members on paper.
  'org.name',
  'org.nameEn',
  'org.address',
  'org.phone',
  'org.email',
  'org.website',
  'org.regNumber',
  'org.description',

  // Landing-page presentation. Image values are Cloudinary URLs written by the
  // upload server actions, not typed by hand.
  'hero.tagline',
  'hero.backgroundImage',
  'hero.partnerLogo1',
  'hero.partnerLogo2',
  'hero.partnerLogo3',

  // Section headings and donation details on the public landing page, read by
  // app/[locale]/page.tsx. These were missing until 2026-08-17, and because this
  // route rejects the whole request on one unknown key, their absence made the
  // admin settings page unable to save *anything at all* — including loan
  // policy. The allow-list was written from the schema rather than from what the
  // form posts, which is the failure mode to watch for when adding to it.
  'features.title',
  'contact.title',
  'donation.title',
  'donation.subtitle',
  'donation.bkash',
  'donation.nagad',
  'donation.rocket',
  'donation.referenceNote',

  // Navigation visibility toggles, read by components/layout/header.tsx.
  'navigation.features',
  'navigation.donate',

  // Login-page greeting, read by app/[locale]/(auth)/login/page.tsx.
  'auth.welcomeBack',

  // Uploaded brand assets. `branding.logo` is read by the header, the footer and
  // the logo primitive; `branding.favicon` by the layout. Cloudinary URLs written
  // by app/actions/upload-settings-image.ts.
  'branding.logo',
  'branding.favicon',
  'branding.dashboardLogo',

  // Support.
  'support.chatRetentionDays',
] as const;

/**
 * Keys the settings form used to post that **nothing in the codebase reads**.
 *
 * Verified 2026-08-17 by grepping the whole tree: zero readers each, in either
 * backend. They are not settings, they are notes — a toggle labelled "Email
 * notifications" that an admin can switch off while every email keeps sending is
 * worse than no toggle, because it will eventually be trusted.
 *
 * They are listed rather than deleted so the next person can see the intent, and
 * what actually governs each behaviour today:
 *
 *   notification.*  — no notification preferences exist. Email always sends when
 *                     configured (BREVO_API_KEY); in-app rows always write.
 *                     `smsNotifications` is doubly dead: there is no SMS
 *                     provider at all, by decision (ADR-003).
 *   security.sessionTimeout   — token lifetime is JWT_EXPIRY_SECONDS, an env var
 *                               on Render, not a database row.
 *   security.loginAttempts    — lockout is RateLimitMaxAttempts, a Go constant
 *                               in internal/services/security_service.go.
 *   security.passwordExpiry   — no password-expiry mechanism exists.
 *   security.twoFactorAuth    — no 2FA implementation exists.
 *   appearance.*              — locale comes from the URL prefix (next-intl),
 *                               theme from the user's browser, and currency and
 *                               date formatting are decided in lib/utils.ts and
 *                               lib/documents/format.ts.
 *
 * To make one real: wire the reader first, then move the key into
 * SYSTEM_CONFIG_KEYS above and give it a control. In that order — the list is
 * the last step, never the first.
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

export type SystemConfigKey = (typeof SYSTEM_CONFIG_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(SYSTEM_CONFIG_KEYS);

export function isSystemConfigKey(key: string): key is SystemConfigKey {
  return KEY_SET.has(key);
}

/**
 * Splits submitted keys into recognised and unrecognised.
 *
 * Returns *all* unknown keys rather than failing on the first, so an admin
 * fixing a form gets one round trip instead of one per typo.
 */
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
