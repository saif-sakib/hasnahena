/**
 * Every `system_config` value that is **prose**, read in the reader's language.
 *
 * One box, two audiences
 * ----------------------
 * A settings row holds one string. A visitor reads one of two languages. So any
 * row an admin types free text into is shown, unchanged, to both — and whichever
 * script it was typed in is the script both audiences get.
 *
 * This has now been found four times, each time by accident and each time
 * months apart:
 *
 *   - `org.address` — the foundation's Bengali address under an English
 *     "Address" heading on four public pages *and* on the English-only
 *     letterhead of every generated document (ADR-012). Found 2026-08-25.
 *   - `org.description` — survived that fix by four months, because its only
 *     reader is the JSON-LD and no rendered-page test reads JSON-LD. The live
 *     English home page published an NGO node describing the foundation in
 *     Bengali.
 *   - `org.name` — split into a pair long before either of those, which is why
 *     the pair convention already existed to copy.
 *   - the twelve landing-page keys below — found 2026-08-26 during the
 *     public-page audit (T-09), by enumerating rather than by noticing.
 *
 * The lesson, and the reason this module is named for the mechanism rather than
 * for the first key that needed it: **enumerate the prose keys.** Fixing the
 * reported one has produced the same bug four times.
 *
 * The convention
 * --------------
 * The bare key holds **Bengali**, the `…En` twin holds **English**, and each
 * falls back to the other rather than to a hardcoded string. A foundation that
 * has not filled in the English box yet should show its real value in the wrong
 * script — which a reader can still act on — rather than a plausible-looking
 * invented one, or a gap.
 *
 * Why its own module rather than part of `system-config.ts`: the footer is a
 * client component, and that file imports Prisma.
 *
 * `test/unit/localized-settings.test.ts` pins the pairs, and requires both
 * halves of every one of them to be reachable from an admin screen and readable
 * by a public page.
 */

/**
 * Every prose pair, as `[bengaliKey, englishKey]`.
 *
 * The census reads this list, so a pair added here without its two rows in
 * `SYSTEM_CONFIG_KEYS`, its tier list and an admin control fails the build. That
 * is the point: a half-added pair is the single-box bug with extra steps.
 */
export const LOCALIZED_SETTING_PAIRS = [
  ['org.name', 'org.nameEn'],
  ['org.address', 'org.addressEn'],
  ['org.description', 'org.descriptionEn'],

  // The landing page, the donate section and the login greeting. Every one of
  // these was a single box labelled in English on the admin screen, so an admin
  // writing for their own members put Bengali on the English home page.
  ['hero.tagline', 'hero.taglineEn'],
  ['features.title', 'features.titleEn'],
  ['contact.title', 'contact.titleEn'],
  ['donation.title', 'donation.titleEn'],
  ['donation.subtitle', 'donation.subtitleEn'],
  ['donation.referenceNote', 'donation.referenceNoteEn'],
  ['navigation.donate', 'navigation.donateEn'],
  ['auth.welcomeBack', 'auth.welcomeBackEn'],

  // The four figures in the hero. A number is prose: `১২৫+` and `125+` are the
  // same fact in two scripts, and until 2026-08-26 both were literals in the
  // message files that no admin could correct and nobody had ever checked.
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
 * A prose setting in the reader's language.
 *
 * `key` is always the **Bengali** half; the English twin is derived, so no call
 * site can read one half of a pair and forget the other. Passing a key that is
 * not a declared pair is a programming error and returns the raw value, which
 * is the old behaviour and therefore no worse than not calling this at all.
 */
export function localizedSetting(
  settings: Record<string, string> | null | undefined,
  key: LocalizedSettingKey,
  locale: string,
): string {
  const primary = settings?.[key]?.trim() || '';
  const englishKey = ENGLISH_TWIN.get(key);
  const english = englishKey ? settings?.[englishKey]?.trim() || '' : '';
  // Every other locale decision in this codebase treats anything that is not
  // `bn` as English (`normalizeLocale`), and this one must agree with them.
  return locale === 'bn' ? primary || english : english || primary;
}

/**
 * **Both** halves of a pair, for the caller that genuinely needs each one.
 *
 * There is exactly one such caller and it is not a page: the generated
 * documents print the foundation's Bengali name and its English name on the
 * same letterhead, so "the name in the reader's language" is the wrong question
 * there (ADR-012 makes those documents English-only, and the Bengali name is
 * still the organisation's legal name).
 *
 * It exists so that call site can go through this module like every other. The
 * alternative was an exemption in the census, and an exemption list is where the
 * next occurrence of this bug would hide.
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

/**
 * The office address in the reader's language.
 *
 * The first pair, and the one that named the module this replaced. There is only
 * ever one thing an admin types into an address box, so whichever script they
 * typed it in was shown to *both* audiences: the foundation's real Bengali
 * address sat under an English "Address" heading on the home page, the contact
 * page, the support page and the footer of every public page. Nothing over the
 * source could see it — the string is in the database, not the repo — and it
 * became visible the day English stopped being the second language (WO-94).
 */
export function orgAddress(
  settings: Record<string, string> | null | undefined,
  locale: string,
): string {
  return localizedSetting(settings, 'org.address', locale);
}

/**
 * The organisation's own description of itself, in the reader's language.
 *
 * Same pair, same reason, found on 2026-08-25 while verifying T-03 — four months
 * after the address, because its only reader is `organizationSchema()` and no
 * rendered-page test reads JSON-LD. That node is documented as "English … read
 * by crawlers and assistants worldwide, not by one locale's readers", and it
 * read the one description box that a Bengali-first foundation had naturally
 * filled in in Bengali, under a label giving no hint that it should not be.
 */
export function orgDescription(
  settings: Record<string, string> | null | undefined,
  locale: string,
): string {
  return localizedSetting(settings, 'org.description', locale);
}
