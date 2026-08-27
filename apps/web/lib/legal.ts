/**
 * When the two legal pages last changed.
 *
 * Both pages printed `Last updated: March 2026` as a literal inside the page,
 * in both languages, and neither was March. The Terms' loan clause had been
 * rewritten twice since — once to delete the promise of administrative fees,
 * once to deny a late fee outright (T-05) — and the line kept saying March. A
 * date on a legal document is a claim about the document, and a stale one is
 * worse than none: it tells a member the version they read last year is the
 * version in front of them.
 *
 * The dates live here, next to nothing else, so that changing the wording and
 * changing the date are one edit in one place. `legal.test.ts` refuses a date
 * that is not a real ISO date or is in the future.
 *
 * **The wording is in `messages/{en,bn}.json` under `legal.*`**, not in the
 * pages. That is rule 5, and on these two pages it is more than housekeeping:
 * the Terms of Service told every member in both languages that loans "are
 * interest-free but may include administrative fees", and it survived a CHECK
 * constraint, `applicationFee = BigInt(0)` and a source-wide search for
 * "markup", because a string inside a component is invisible to every guard
 * this repository has. `messages.test.ts` reads the message files.
 */

/**
 * Rewritten 2026-08-26 (T-10) to describe what the platform actually does.
 *
 * Revised 2026-08-27 for the tiered retention policy ([ADR-038](../../../docs/decisions.md)):
 * a refused applicant's photographs are now deleted at the decision rather than
 * kept indefinitely, and the periods the audit trail is kept for are stated. Both
 * are commitments a reader can hold the foundation to, so the date moves with
 * them — a policy whose wording changes under an unchanged date is one nobody can
 * tell has changed.
 */
export const PRIVACY_LAST_UPDATED = '2026-08-27';

/**
 * 2026-08-26 (T-10). The loan clause itself last changed on 2026-08-25, when
 * the foundation ruled out a late fee; this revision restates the whole
 * document and moves it into the message files.
 */
export const TERMS_LAST_UPDATED = '2026-08-26';

/**
 * A revision date in the reader's language.
 *
 * `toLocaleDateString('bn-BD')` is what the gallery already uses for a posting
 * date, so the two agree about numerals and month names.
 */
export function formatLegalDate(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
