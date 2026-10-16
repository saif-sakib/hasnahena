/**
 * The membership age floor (`membership.minimumAgeYears`). Pure, so the
 * registration form, POST /api/v1/registrations and the Settings screen share
 * one answer.
 */

/** Used when the setting is missing, blank or unparseable. */
export const DEFAULT_MINIMUM_AGE_YEARS = 18;

/** Bounds on the setting; a typo like 180 would refuse every applicant. */
export const MINIMUM_AGE_LOWER_BOUND = 1;
export const MINIMUM_AGE_UPPER_BOUND = 100;

/** Over 120 is a typo or hostile value, never a member. */
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
 * Whole calendar years between dateOfBirth and asOf (not days/365.25, which
 * ages people early). Null for an unparseable date.
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

/** The single verdict on a date of birth, shared by form and API; null = OK. */
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

/** The applicant-facing message, in their language; the too-young one states the limit. */
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
