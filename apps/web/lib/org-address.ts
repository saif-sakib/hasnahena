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
