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

  // Support.
  'support.chatRetentionDays',
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
