/**
 * The organisation's prose settings, in the reader's language.
 *
 * Every value here is a `system_config` row an admin types free text into, and
 * every one of them has the same failure: **one box, two audiences.** The
 * address found it first; the description found it second, four months later
 * and only because a crawler was reading the output.
 *
 * The module is named for the address because that is what it held first. It is
 * kept out of `system-config.ts` because the footer is a client component and
 * that file imports Prisma.
 */

/**
 * The office address in the reader's language.
 *
 * There is only ever one thing an admin types into an address box, so whichever
 * script they typed it in was shown to *both* audiences: the foundation's real
 * Bengali address sat under an English "Address" heading on the home page, the
 * contact page, the support page and the footer of every public page. Nothing
 * over the source could see it — the string is in the database, not the repo —
 * and it became visible the day English stopped being the second language
 * (WO-94).
 *
 * `org.name` / `org.nameEn` is the same pair for the organisation's name, and
 * this deliberately copies its shape rather than inventing a second convention.
 *
 * Each side falls back to the other rather than to a hardcoded string. A
 * foundation that has not filled in the English box yet should show its real
 * address in the wrong script — which a reader can still post a letter to —
 * instead of a plausible-looking address that is nobody's.
 */
export function orgAddress(
  settings: Record<string, string> | null | undefined,
  locale: string,
): string {
  const primary = settings?.['org.address']?.trim() || '';
  const english = settings?.['org.addressEn']?.trim() || '';
  return locale === 'bn' ? primary || english : english || primary;
}

/**
 * The organisation's own description of itself, in the reader's language.
 *
 * Same pair, same reason, found on 2026-08-25 while verifying T-03. `org.name`
 * and `org.address` had each been split into a Bengali row and an English one;
 * `org.description` had not, and it is the *only* one of the three whose single
 * value was being published as English by construction. `organizationSchema()`
 * documents its node as "English … read by crawlers and assistants worldwide,
 * not by one locale's readers" — and then read the one description box, which a
 * Bengali-first foundation had naturally filled in in Bengali under a label
 * giving no hint that it should not be.
 *
 * So the live English home page shipped an NGO node describing the foundation
 * in Bengali, immediately beside a WebSite node describing it in English. No
 * test could see it: the string is in the database, and the page it misrepresents
 * is one no member ever reads — the one search engines do.
 *
 * Falls back across the pair like `orgAddress`, then to the caller's default: a
 * description in the wrong script still describes the foundation, which a
 * hardcoded English sentence about a *different* organisation would not.
 */
export function orgDescription(
  settings: Record<string, string> | null | undefined,
  locale: string,
): string {
  const primary = settings?.['org.description']?.trim() || '';
  const english = settings?.['org.descriptionEn']?.trim() || '';
  return locale === 'bn' ? primary || english : english || primary;
}
