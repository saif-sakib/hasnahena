import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MINIMUM_AGE_YEARS,
  MAXIMUM_PLAUSIBLE_AGE_YEARS,
  MINIMUM_AGE_LOWER_BOUND,
  MINIMUM_AGE_UPPER_BOUND,
  ageInYears,
  dateOfBirthMessage,
  dateOfBirthProblem,
  minimumAgeYears,
} from '@/lib/membership-eligibility';

/** The membership age floor: the arithmetic, and a missing or nonsense setting. */

const AS_OF = new Date('2026-08-26T12:00:00Z');

describe('minimumAgeYears', () => {
  it('reads the configured value', () => {
    expect(minimumAgeYears({ 'membership.minimumAgeYears': '21' })).toBe(21);
    expect(minimumAgeYears({ 'membership.minimumAgeYears': ' 16 ' })).toBe(16);
  });

  it('falls back rather than throwing on anything unusable', () => {
    // Every one of these has reached a settings table at some point in this
    // project's life: an unset key, a cleared box, a value typed with its unit.
    for (const value of [undefined, '', '   ', 'eighteen', '18 years', 'NaN']) {
      expect(minimumAgeYears(value === undefined ? {} : { 'membership.minimumAgeYears': value }))
        .toBe(DEFAULT_MINIMUM_AGE_YEARS);
    }
    expect(minimumAgeYears(null)).toBe(DEFAULT_MINIMUM_AGE_YEARS);
    expect(minimumAgeYears(undefined)).toBe(DEFAULT_MINIMUM_AGE_YEARS);
  });

  it('refuses a value outside the bounds instead of applying it', () => {
    // A nonsense setting falls back to the default rather than refusing everyone.
    for (const value of ['0', '-5', '180', '1000']) {
      expect(minimumAgeYears({ 'membership.minimumAgeYears': value }))
        .toBe(DEFAULT_MINIMUM_AGE_YEARS);
    }
    // The bounds themselves are accepted.
    expect(minimumAgeYears({ 'membership.minimumAgeYears': String(MINIMUM_AGE_LOWER_BOUND) }))
      .toBe(MINIMUM_AGE_LOWER_BOUND);
    expect(minimumAgeYears({ 'membership.minimumAgeYears': String(MINIMUM_AGE_UPPER_BOUND) }))
      .toBe(MINIMUM_AGE_UPPER_BOUND);
  });
});

describe('ageInYears', () => {
  it('counts by the calendar, not by dividing elapsed milliseconds', () => {
    // A birthday not yet reached this year counts as a year younger.
    expect(ageInYears('2008-08-25', AS_OF)).toBe(18); // birthday yesterday
    expect(ageInYears('2008-08-26', AS_OF)).toBe(18); // birthday today
    expect(ageInYears('2008-08-27', AS_OF)).toBe(17); // birthday tomorrow
  });

  it('handles a 29 February birthday', () => {
    // Leap-day birthday in a non-leap year.
    expect(ageInYears('2008-02-29', AS_OF)).toBe(18);
  });

  it('returns null for a date it cannot read', () => {
    // Deliberately not 0 or NaN: a caller comparing `age < minimum` would admit
    // or refuse everybody on an unparseable value.
    expect(ageInYears('not a date', AS_OF)).toBeNull();
    expect(ageInYears('', AS_OF)).toBeNull();
  });
});

describe('dateOfBirthProblem', () => {
  const min = 18;

  it('accepts an applicant who is exactly old enough', () => {
    expect(dateOfBirthProblem('2008-08-26', min, AS_OF)).toBeNull();
  });

  it('refuses one day short', () => {
    expect(dateOfBirthProblem('2008-08-27', min, AS_OF)).toBe('too-young');
  });

  it('refuses the infant this whole rule exists for', () => {
    // The defect verbatim: a date of birth of yesterday used to pass and create
    // a pending member.
    expect(dateOfBirthProblem('2026-08-25', min, AS_OF)).toBe('too-young');
  });

  it('still refuses a future date and an unreadable one', () => {
    expect(dateOfBirthProblem('2027-01-01', min, AS_OF)).toBe('future');
    expect(dateOfBirthProblem('nonsense', min, AS_OF)).toBe('invalid');
  });

  it('refuses an age no member has', () => {
    const impossible = new Date(AS_OF);
    impossible.setFullYear(impossible.getFullYear() - MAXIMUM_PLAUSIBLE_AGE_YEARS - 5);
    expect(dateOfBirthProblem(impossible, min, AS_OF)).toBe('implausible');
  });

  it('moves with the setting rather than with a constant', () => {
    // The point of making it a setting: the same date is acceptable at one
    // floor and not at another, with no code change.
    expect(dateOfBirthProblem('2010-01-01', 16, AS_OF)).toBeNull();
    expect(dateOfBirthProblem('2010-01-01', 18, AS_OF)).toBe('too-young');
  });
});

describe('dateOfBirthMessage', () => {
  it('states the limit rather than just refusing', () => {
    // "You are not eligible" gives someone filling in a form on a phone nothing
    // to act on — they cannot tell a typo from a rule.
    expect(dateOfBirthMessage('too-young', 18, 'en')).toContain('18');
    expect(dateOfBirthMessage('too-young', 21, 'en')).toContain('21');
    expect(dateOfBirthMessage('too-young', 18, 'bn')).toContain('18');
  });

  it('says something real in both languages for every problem', () => {
    const problems = ['invalid', 'future', 'too-young', 'implausible'] as const;
    for (const problem of problems) {
      const en = dateOfBirthMessage(problem, 18, 'en');
      const bn = dateOfBirthMessage(problem, 18, 'bn');
      expect(en.trim()).not.toBe('');
      expect(bn.trim()).not.toBe('');
      expect(bn, `${problem} is not translated`).not.toBe(en);
      expect(/[ঀ-৿]/.test(bn), `${problem}'s Bengali message has no Bengali script`).toBe(true);
    }
  });
});
