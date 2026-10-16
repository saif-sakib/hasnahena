/**
 * Every `system_config` value that is PROSE, in the reader's language. One row
 * shown to two audiences shows one script to both — found four times, key by
 * key, so enumerate the prose keys rather than fix the reported one.
 *
 * The bare key is Bengali, the `…En` twin English, each falling back to the
 * other. Its own module because the footer is a client component and
 * system-config.ts imports Prisma. Pinned by localized-settings.test.ts.
 */

/**
 * Every prose pair, `[bengaliKey, englishKey]`. A pair added without its keys,
 * tier and admin control fails the census.
 */
export const LOCALIZED_SETTING_PAIRS = [
  ['org.name', 'org.nameEn'],
  ['org.address', 'org.addressEn'],
  ['org.description', 'org.descriptionEn'],

  // Landing page, donate section and login greeting.
  ['hero.tagline', 'hero.taglineEn'],
  ['features.title', 'features.titleEn'],
  ['contact.title', 'contact.titleEn'],
  ['donation.title', 'donation.titleEn'],
  ['donation.subtitle', 'donation.subtitleEn'],
  ['donation.referenceNote', 'donation.referenceNoteEn'],
  ['navigation.donate', 'navigation.donateEn'],
  ['auth.welcomeBack', 'auth.welcomeBackEn'],

  // The hero figures — a number is prose (`১২৫+` vs `125+`).
  ['stats.members', 'stats.membersEn'],
  ['stats.deposits', 'stats.depositsEn'],
  ['stats.loans', 'stats.loansEn'],
  ['stats.charity', 'stats.charityEn'],
] as const satisfies ReadonlyArray<readonly [string, string]>;

/** The Bengali half of every pair — the key an admin sees as the primary box. */
export type LocalizedSettingKey = (typeof LOCALIZED_SETTING_PAIRS)[number][0];

const ENGLISH_TWIN = new Map<string, string>(
  LOCALIZED_SETTING_PAIRS.map(([bn, en]) => [bn, en]),
);

/**
 * A prose setting in the reader's language. `key` is the Bengali half; an
 * undeclared key returns the raw value.
 */
export function localizedSetting(
  settings: Record<string, string> | null | undefined,
  key: LocalizedSettingKey,
  locale: string,
): string {
  const primary = settings?.[key]?.trim() || '';
  const englishKey = ENGLISH_TWIN.get(key);
  const english = englishKey ? settings?.[englishKey]?.trim() || '' : '';
  // Anything not `bn` is English, as in normalizeLocale.
  return locale === 'bn' ? primary || english : english || primary;
}

/**
 * Both halves of a pair — for the letterhead only, which prints the Bengali and
 * English names together. Avoids an exemption in the census.
 */
export function localizedSettingPair(
  settings: Record<string, string> | null | undefined,
  key: LocalizedSettingKey,
): { bn: string; en: string } {
  return {
    bn: localizedSetting(settings, key, 'bn'),
    en: localizedSetting(settings, key, 'en'),
  };
}

/** The organisation's own name, in the reader's language. */
export function orgName(
  settings: Record<string, string> | null | undefined,
  locale: string,
): string {
  return localizedSetting(settings, 'org.name', locale);
}

/** The office address in the reader's language. */
export function orgAddress(
  settings: Record<string, string> | null | undefined,
  locale: string,
): string {
  return localizedSetting(settings, 'org.address', locale);
}

/** The organisation's description in the reader's language (read by the JSON-LD). */
export function orgDescription(
  settings: Record<string, string> | null | undefined,
  locale: string,
): string {
  return localizedSetting(settings, 'org.description', locale);
}
