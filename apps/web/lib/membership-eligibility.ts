/**
 * How old an applicant must be to become a member.
 *
 * Until 2026-08-26 the only rule on `dateOfBirth` was that it must not be in
 * the future, so a date of birth of *yesterday* passed validation and created a
 * pending member. Members enter a financial contract and can borrow against
 * their savings, so a floor is not optional — and the owner asked for it to be
 * a **setting** rather than a number compiled into the source, because it is a
 * policy the foundation may revisit.
 *
 * Its own module, and pure, because three callers with three different
 * constraints need it:
 *
 *   - the registration form, a client component that cannot import
 *     `system-config.ts` (that file imports Prisma),
 *   - `POST /api/v1/registrations`, which must not trust the form,
 *   - the admin Settings screen, which has to show and bound the value.
 */

/** Used when the setting is missing, blank or unparseable. */
export const DEFAULT_MINIMUM_AGE_YEARS = 18;

/**
 * Bounds on the setting itself.
 *
 * The upper bound is not fussiness: the value gates every new member, so a
 * mistyped `180` in the Settings box would refuse every applicant with a
 * message about their age, and the cause would be three screens away from the
 * symptom.
 */
export const MINIMUM_AGE_LOWER_BOUND = 1;
export const MINIMUM_AGE_UPPER_BOUND = 100;

/**
 * The oldest date of birth treated as real.
 *
 * Separate from the minimum age and not configurable: a date of birth implying
 * an age over 120 is a typo or a hostile value, never a member.
 */
export const MAXIMUM_PLAUSIBLE_AGE_YEARS = 120;

/** Read the configured floor, falling back rather than throwing. */
export function minimumAgeYears(
  settings: Record<string, string> | null | undefined,
): number {
  const raw = settings?.['membership.minimumAgeYears'];
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MINIMUM_AGE_YEARS;
  if (parsed < MINIMUM_AGE_LOWER_BOUND || parsed > MINIMUM_AGE_UPPER_BOUND) {
    return DEFAULT_MINIMUM_AGE_YEARS;
  }
  return parsed;
}

/**
 * Whole years between `dateOfBirth` and `asOf`, by the calendar.
 *
 * Deliberately not `(now - dob) / 365.25 days`. Someone born on 29 February, or
 * on any date whose anniversary has not yet arrived this year, is a year older
 * under the arithmetic version than they are in fact — and this number decides
 * whether a person may hold a financial account. Returns `null` for an
 * unparseable date rather than a number a caller might compare against.
 */
export function ageInYears(dateOfBirth: string | Date, asOf: Date = new Date()): number | null {
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  let age = asOf.getFullYear() - dob.getFullYear();
  const monthDelta = asOf.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

export type DateOfBirthProblem = 'invalid' | 'future' | 'too-young' | 'implausible';

/**
 * The single verdict on a date of birth, shared by the form and the API.
 *
 * Returns `null` when the date is acceptable. Having one function answer all
 * four questions is the point: the form and the route disagreeing about which
 * dates are allowed is how a member gets past the browser and is refused by the
 * server with a different message.
 */
export function dateOfBirthProblem(
  dateOfBirth: string | Date,
  minimumAge: number,
  asOf: Date = new Date(),
): DateOfBirthProblem | null {
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return 'invalid';
  if (dob.getTime() > asOf.getTime()) return 'future';

  const age = ageInYears(dob, asOf);
  if (age === null) return 'invalid';
  if (age > MAXIMUM_PLAUSIBLE_AGE_YEARS) return 'implausible';
  if (age < minimumAge) return 'too-young';
  return null;
}

/**
 * What the applicant is told, in their own language.
 *
 * The too-young message **states the limit**. "You are not eligible" gives
 * someone filling in a form on a phone nothing to act on; "members must be at
 * least 18" tells them whether to correct a typo or stop.
 */
export function dateOfBirthMessage(
  problem: DateOfBirthProblem,
  minimumAge: number,
  locale: string,
): string {
  const bn = locale === 'bn';
  switch (problem) {
    case 'invalid':
      return bn ? 'জন্ম তারিখ সঠিক নয়' : 'Date of birth is invalid';
    case 'future':
      return bn ? 'জন্ম তারিখ ভবিষ্যতের হতে পারে না' : 'Date of birth cannot be in the future';
    case 'implausible':
      return bn ? 'জন্ম তারিখ সঠিক নয়' : 'Date of birth is invalid';
    case 'too-young':
      return bn
        ? `সদস্য হতে হলে বয়স কমপক্ষে ${minimumAge} বছর হতে হবে`
        : `Members must be at least ${minimumAge} years old`;
  }
}
