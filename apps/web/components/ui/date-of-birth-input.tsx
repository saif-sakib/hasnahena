'use client';

import { useMemo, useState } from 'react';

/**
 * Day / month / year selects, not a calendar — Android's date picker opens on
 * this month and makes a sixty-year-old travel decades. Value in and out is
 * the same ISO `YYYY-MM-DD`. Days the month does not have are not offered;
 * changing month/year to a shorter one clears the day rather than moving it.
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
  /** On the day select (so focusField lands here); `${id}Month`/`${id}Year` on the others. */
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
   * The parts are LOCAL state: a partial date has no ISO form, so deriving them
   * from `value` erased each pick. onChange sends the ISO string when complete,
   * '' until then.
   */
  const parse = (iso: string): [number, number, number] => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  };
  const [[year, month, day], setParts] = useState<[number, number, number]>(() => parse(value));

  // An outside value (restored draft, reset) wins — adjusted during render
  // against the previous prop, not in an effect.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (value) setParts(parse(value));
  }

  const thisYear = new Date().getFullYear();
  // The newest eligible birth year.
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
    // A day that no longer exists is dropped, not clamped.
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
    // pr-1: a native select's arrow eats right padding, clipping month names.
    'h-11 w-full rounded-sm border bg-white pl-2 pr-1 text-sm',
    // 16px on the phone, because anything smaller makes iOS zoom the viewport on
    // focus and Android renders the option list at a size nobody can read.
    'sm:text-sm text-base',
    invalid ? 'border-red-400' : 'border-gray-300',
  ].join(' ');

  return (
    <div
      /* Unequal minmax(0,…) tracks: the month is a word (and wider in Bengali);
      minmax(0) stops a select's min-content widening the row. */
      className={`grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)_minmax(0,1.1fr)] gap-2 ${className ?? ''}`}
    >
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
