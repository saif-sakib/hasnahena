import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/prisma';

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
  // scripts/seed.mjs; the two below them are read there too, through their own
  // transaction-scoped readers.
  'loan.minDepositForLoan',
  'loan.maxLoanMultiplier',
  'loan.maxInstallmentMonths',
  'loan.allowActiveLoanWithdrawal',
  // Enforced since 2026-08-18 by MarkLoanDefaulted, which refuses unless the
  // borrower has missed at least this many scheduled instalments — counted from
  // installmentStartDate against paidInstallments (internal/money/schedule.go).
  // Still admin-initiated: no job defaults a loan on its own, and given that
  // marking one runs the settlement waterfall against a member's savings, that
  // is deliberate rather than pending.
  'loan.missedPaymentsForDefault',
  // Loans at or below this amount need no guarantor and go straight to
  // PENDING_APPROVAL. product.md has always specified a threshold; until WO-45
  // the application endpoint demanded a guarantor for every loan regardless.
  // Set to 0 to require a guarantor on every loan.
  'loan.guarantorThresholdAmount',
  // How much warning the foundation asks a member to give before withdrawing,
  // in DAYS.
  //
  // Informational, deliberately (ADR-030). Until 2026-08-24 this was
  // `loan.noticePeriodMonths` and it was a gate: a member filed a notice, and
  // neither the admin's approval nor the worker's payout could move money until
  // it matured. The owner removed that rule — staff take the request in person
  // and pay at the desk — so nothing in either backend reads this now.
  //
  // It is still a setting rather than a note, because two screens render it:
  // the member's own savings page and the public FAQ. Change it here and both
  // change, which is exactly what UNIMPLEMENTED_CONFIG_KEYS below is for
  // distinguishing — a control nothing reads is worse than no control, and this
  // one is read.
  'loan.noticePeriodDays',

  // Organisation identity. Used on generated documents (letterhead) and the
  // public site, so a wrong value here is visible to members on paper.
  'org.name',
  'org.nameEn',
  'org.address',
  'org.addressEn',
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

  // Bank transfer details for the public /donate page.
  //
  // Added 2026-08-19 (WO-67). The page had been reading all four of these since
  // it was written, and none of them was declared here — so `PUT
  // /api/v1/settings` would have rejected them and no admin screen offered
  // them. The `|| 'literal'` fallbacks in the page were therefore not fallbacks
  // at all: they were the only values it could ever render, and one of them was
  // the account number `2050 0000 0000 0000` set in a highlighted monospace box
  // under the heading "Bank Account".
  //
  // Seeded EMPTY, deliberately. On this page specifically a plausible-looking
  // wrong number is worse than a visible gap, because a donor can act on it —
  // so the page hides the whole card until an admin fills these in.
  'bank.name',
  'bank.accountName',
  'bank.accountNo',
  'bank.branch',

  // Support.
  'support.chatRetentionDays',

  // Retention. How long a REJECTED application keeps its identity data — the
  // NID number, both parents' names, the date of birth and the two addresses.
  // The decision and its audit row are permanent; these are not (WO-93,
  // ADR-033). Read by the Go API's retention sweep,
  // `internal/repositories/retention_repository.go`, and by nothing in the
  // browser except the form that sets it.
  'security.rejectedRetentionDays',
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

/**
 * The subset an **anonymous** caller may read.
 *
 * WO-77 (SEC-12). `GET /api/v1/settings` is deliberately unauthenticated: the
 * marketing pages, the login screen and every generated document's letterhead
 * read branding and organisation details from it before anyone has signed in.
 * The narrowing WO-64 already did — returning declared keys rather than
 * `SELECT *` — stopped the table leaking wholesale. This is the second half:
 * *which* declared keys a stranger gets.
 *
 * The test is what a visitor may see with no account. Branding, the
 * organisation's own contact details, the landing-page copy, the donation
 * channels — all of it is printed on the public site already.
 *
 * This list is also exactly what `getPublicSettings()` selects, so it is the
 * whole vocabulary a page outside `dashboard/` can render. A key missing from
 * here is a page rendering its hardcoded fallback forever, which is WO-67's
 * failure with a new cause — `test/unit/settings-keys-read.test.ts` refuses it.
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

  'hero.tagline',
  'hero.backgroundImage',
  'hero.partnerLogo1',
  'hero.partnerLogo2',
  'hero.partnerLogo3',

  'features.title',
  'contact.title',
  'donation.title',
  'donation.subtitle',
  'donation.bkash',
  'donation.nagad',
  'donation.rocket',
  'donation.referenceNote',

  'navigation.features',
  'navigation.donate',

  'auth.welcomeBack',

  'branding.logo',
  'branding.favicon',
  'branding.dashboardLogo',

  'bank.name',
  'bank.accountName',
  'bank.accountNo',
  'bank.branch',

  // Public because the FAQ answers "can I withdraw my deposits?" with it, and
  // /faq is a prerendered marketing page reading `getPublicSettings()`. It is
  // published policy — it was hardcoded into that answer as "3 months" long
  // before it was a setting — so a stranger reading it is the point.
  'loan.noticePeriodDays',
] as const;

/**
 * Public, **plus** what a signed-in member is entitled to see about the policy
 * governing their own money.
 *
 * Why this tier exists rather than the two WO-77 named. The order says "public
 * subset to an anonymous caller, everything to an authenticated admin", and
 * that split alone would have broken two screens the same afternoon:
 * `dashboard/member/loans` sizes its eligibility calculator from
 * `loan.minDepositForLoan`, `loan.maxLoanMultiplier`, `loan.maxInstallmentMonths`
 * and `loan.guarantorThresholdAmount`, and the member reading it is not an
 * admin. Falling back to the hardcoded defaults in that component would show
 * every member a policy the foundation may have changed — the exact failure
 * WO-67 spent an order removing from the public pages.
 *
 * So loan policy moves out of the anonymous response, which is what SEC-12
 * asked for, and stops there rather than becoming admin-only. It is published
 * to members in product.md and on their own dashboard; it is simply not a
 * stranger's business.
 *
 * What is left admin-only, and why each one: `loan.missedPaymentsForDefault` is
 * the threshold at which staff may start a settlement waterfall against a
 * member's savings, and `support.chatRetentionDays` is a retention policy.
 * Neither is read by any member-facing screen.
 */
export const MEMBER_CONFIG_KEYS = [
  ...PUBLIC_CONFIG_KEYS,
  'loan.minDepositForLoan',
  'loan.maxLoanMultiplier',
  'loan.maxInstallmentMonths',
  'loan.allowActiveLoanWithdrawal',
  'loan.guarantorThresholdAmount',
  // `loan.noticePeriodDays` is NOT repeated here — it arrives through the spread
  // above. The tiers have to be a partition, and listing it twice is what
  // `settings-keys-read.test.ts` calls an overlapping copy.
] as const;

/**
 * Which admin screen owns each key.
 *
 * The settings screen used to own all of them, and it had grown a "Landing" tab
 * holding the hero image, the partner logos, three section headings, the login
 * greeting *and* a gallery uploader — beside the bKash number and the loan
 * policy. Two different jobs on one screen: publishing the public site, and
 * configuring how the foundation's money works.
 *
 * They are two screens now. `CONTENT_CONFIG_KEYS` is what a page *shows* and
 * lives on Content & Media, next to the gallery it belongs with;
 * `SETTINGS_CONFIG_KEYS` is what the organisation *is* and what its money does,
 * and stays on Settings.
 *
 * The split is a partition, and `test/unit/settings-keys-read.test.ts` refuses
 * anything else — a key in neither list is a key no admin screen can reach,
 * which is WO-67's failure again, and a key in both is two controls writing one
 * row and disagreeing about what it currently holds.
 */
export const CONTENT_CONFIG_KEYS = [
  'hero.tagline',
  'hero.backgroundImage',
  'hero.partnerLogo1',
  'hero.partnerLogo2',
  'hero.partnerLogo3',

  'features.title',
  'contact.title',
  'donation.title',
  'donation.subtitle',
  'donation.referenceNote',

  'navigation.features',
  'navigation.donate',

  'auth.welcomeBack',

  'branding.logo',
  'branding.dashboardLogo',
  'branding.favicon',
] as const;

/**
 * The rest: who the foundation is, what its money rules are, and where a donor
 * sends money. The payment channels stay here rather than moving to Content
 * with the rest of the donate page's copy — a wrong heading is embarrassing, a
 * wrong bKash number sends a donor's money to a stranger.
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

/** Cache tag every public settings read shares. Invalidated by the settings PUT. */
export const SYSTEM_CONFIG_TAG = 'system-config';

/**
 * The public pages' settings map, read once per revalidation window rather than
 * once per visit.
 *
 * WO-73. Every marketing page opened with `prisma.systemConfig.findMany()` — no
 * `select`, no `where`, no cache — so a visit to `/en/privacy` read every column
 * of every config row out of Neon before it could render a page whose content
 * changes when an admin edits a setting, which is to say almost never. On a free
 * tier that cold read was the whole of the page's TTFB, and TTFB feeds Core Web
 * Vitals, so this was an SEO item as much as a performance one.
 *
 * The invalidation half already existed: `PUT /api/v1/settings` calls
 * `revalidatePath` for four routes. It now calls `revalidateTag` on the tag
 * below too, which is what lets *every* page share one cache entry instead of
 * each route holding its own.
 *
 * Two things to keep true:
 *
 *   - **Only public keys.** The map is handed to `<Header>` and `<Footer>` and
 *     rendered into HTML that is cached and served to everyone, so a key that is
 *     not a stranger's business must not be in it (WO-77).
 *   - **Never for `dashboard/`.** Those reads are per-member. A cached accessor
 *     there would serve one member's page to the next.
 */
export async function getPublicSettings(): Promise<Record<string, string>> {
  try {
    return await getCachedPublicSettings();
  } catch (error) {
    // A marketing page must be renderable without a database.
    //
    // `next build` prerenders these ten routes, and the Docker image is built
    // with `DATABASE_URL` pointing at a placeholder that does not exist — so
    // WO-73 turned a working image build into `Export encountered an error on
    // /[locale]/donate/page`. Six of the eight pages had no `try` of their own;
    // the handling lived in the two that did, which is the same fact stored in
    // two places and disagreeing.
    //
    // The `catch` is *outside* the cache deliberately. `unstable_cache` stores
    // a resolved value and never a rejection, so a transient outage is retried
    // on the next request. Catching inside would memoise the empty map and pin
    // every public page to its fallback copy for the whole revalidate hour.
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
  // The tag is the real invalidation path — an admin saving settings must see
  // the change immediately, not in an hour. The interval is the backstop for
  // the write nothing tags: a row edited directly in Prisma Studio or by a
  // migration would otherwise be invisible on the public site forever.
  { tags: [SYSTEM_CONFIG_TAG], revalidate: 3600 },
);
