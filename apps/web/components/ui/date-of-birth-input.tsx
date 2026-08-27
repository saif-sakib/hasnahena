'use client';

import { useMemo, useState } from 'react';

/**
 * Three dropdowns, not a calendar.
 *
 * `<input type="date">` renders the platform date picker, which on Android opens
 * on **this month** and asks the user to travel to 1985. On a low-end phone that
 * is between forty and five hundred taps depending on the vendor's picker, and
 * several of them do not offer a year list at all until you find the small
 * caret beside the month name. It is the correct control for "when is your next
 * appointment" and the wrong one for "when were you born": a calendar is for
 * dates near today, and a birthday is never near today.
 *
 * Day / Month / Year selects are what every registration form settles on in the
 * end. Three taps, no travel, each list short enough to scan, and the year list
 * starts at the oldest plausible member rather than at the current one — because
 * somebody joining a village cooperative is far more likely to be sixty than
 * eighteen, and a list that opens at the wrong end is the same problem again.
 *
 * The value in and out is the ISO `YYYY-MM-DD` the form and the API already use,
 * so nothing downstream changes: `registerApiSchema`, `dateOfBirthProblem` and
 * the age floor all see exactly what they saw before.
 *
 * **Impossible days are not offered.** The day list is the length of the chosen
 * month, so 31 February cannot be selected — the native picker's one real
 * advantage, kept. Changing the month or the year to one that is too short
 * clears the day rather than silently moving it: a form that quietly turns your
 * 31st into the 28th is worse than one that asks again.
 */

const MONTHS = {
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  bn: [
    'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
  ],
} as const;

/** How far back the year list goes. A member older than this is not impossible,
 *  only unrecorded — and the field accepts a typed value from the API either way. */
const OLDEST_YEARS = 100;

function daysInMonth(year: number, month: number): number {
  // `new Date(y, m, 0)` is the last day of month `m` (1-indexed), leap years
  // included. Hard-coding 28/30/31 is the version that is wrong every four years.
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

export interface DateOfBirthInputProps {
  /** ISO `YYYY-MM-DD`, or empty. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Put on the day select, so `focusField('dateOfBirth')` still lands here — and
   * `${id}Month` / `${id}Year` on the other two, because a control made of three
   * elements is otherwise addressable only by its translated label.
   */
  id: string;
  locale: 'en' | 'bn';
  invalid?: boolean;
  /** Nobody younger than this can join, so the year list stops there. */
  minimumAge: number;
  className?: string;
}

export function DateOfBirthInput({
  value,
  onChange,
  id,
  locale,
  invalid,
  minimumAge,
  className,
}: DateOfBirthInputProps) {
  const isBn = locale === 'bn';

  /**
   * The three parts are **local state**, not derived from `value`.
   *
   * Deriving them was the first version and it does not work: a complete date is
   * the only thing that can be represented as `YYYY-MM-DD`, so the moment
   * somebody picks a day and nothing else the value is empty — and on the next
   * render the day they just picked is gone. Picking day, then month, then year,
   * in the order the boxes are arranged, therefore ended with an empty field and
   * a form that refused to advance while showing all three selections filled in.
   *
   * So the parts are held here and `onChange` fires with the ISO string when all
   * three are set, and with `''` while they are not — which keeps the field
   * invalid until it is complete, exactly as an empty date input was.
   */
  const parse = (iso: string): [number, number, number] => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  };
  const [[year, month, day], setParts] = useState<[number, number, number]>(() => parse(value));

  // A value set from outside — a restored draft, a reset form — wins.
  //
  // Adjusted **during render** against the previous prop rather than in an
  // effect. React documents this as the way to reset state when a prop changes;
  // an effect that calls `setState` renders once with the stale value and then
  // again, which is both a flash and a cascading-render lint warning. It never
  // fights a half-finished selection, because while the user is mid-way the
  // composed value is `''` and so is the parent's.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (value) setParts(parse(value));
  }

  const thisYear = new Date().getFullYear();
  // The newest year anybody eligible could have been born in. A 18-year floor in
  // 2026 means the list starts at 2008 — offering 2025 would be offering a
  // refusal.
  const newestYear = thisYear - Math.max(0, minimumAge);
  const years = useMemo(
    () => Array.from({ length: OLDEST_YEARS }, (_, i) => newestYear - i),
    [newestYear],
  );

  const dayCount = daysInMonth(year, month);
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => i + 1),
    [dayCount],
  );

  const emit = (y: number, m: number, d: number) => {
    // A day that no longer exists in the month or year just chosen is dropped
    // rather than clamped. See the note above: silently turning a 31st into a
    // 28th is worse than asking again.
    const dayIsReal = !y || !m || !d || d <= daysInMonth(y, m);
    const nextDay = dayIsReal ? d : 0;
    setParts([y, m, nextDay]);
    onChange(
      y && m && nextDay
        ? `${y}-${String(m).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`
        : '',
    );
  };

  const selectClass = [
    'h-11 w-full rounded-sm border bg-white px-2 text-sm',
    // 16px on the phone, because anything smaller makes iOS zoom the viewport on
    // focus and Android renders the option list at a size nobody can read.
    'sm:text-sm text-base',
    invalid ? 'border-red-400' : 'border-gray-300',
  ].join(' ');

  return (
    <div className={`grid grid-cols-3 gap-2 ${className ?? ''}`}>
      <select
        id={id}
        className={selectClass}
        value={day || ''}
        aria-label={isBn ? 'জন্ম তারিখ — দিন' : 'Date of birth — day'}
        aria-invalid={invalid}
        onChange={(e) => emit(year, month, Number(e.target.value))}
      >
        <option value="">{isBn ? 'দিন' : 'Day'}</option>
        {days.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      <select
        id={`${id}Month`}
        className={selectClass}
        value={month || ''}
        aria-label={isBn ? 'জন্ম তারিখ — মাস' : 'Date of birth — month'}
        aria-invalid={invalid}
        onChange={(e) => emit(year, Number(e.target.value), day)}
      >
        <option value="">{isBn ? 'মাস' : 'Month'}</option>
        {MONTHS[isBn ? 'bn' : 'en'].map((name, i) => (
          <option key={name} value={i + 1}>{name}</option>
        ))}
      </select>

      <select
        id={`${id}Year`}
        className={selectClass}
        value={year || ''}
        aria-label={isBn ? 'জন্ম তারিখ — বছর' : 'Date of birth — year'}
        aria-invalid={invalid}
        onChange={(e) => emit(Number(e.target.value), month, day)}
      >
        <option value="">{isBn ? 'বছর' : 'Year'}</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
