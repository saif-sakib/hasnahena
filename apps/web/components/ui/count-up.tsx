'use client';

import * as React from 'react';

/**
 * A figure that counts up from zero when it comes into view.
 *
 * Restored on the owner's instruction (2026-08-26): the hero's statistics used
 * to animate and the animation was the thing that made the panel feel alive.
 *
 * ## Why it takes a **string**, not a number
 *
 * These figures are `system_config` values an admin types, in two scripts:
 * `১৩৫+`, `৳২৫ লক্ষ+`, `135+`, `৳3.5 Lakh+`. There is no number to hand this
 * component — there is a sentence with a number in it, and the `+`, the `৳` and
 * the word "লক্ষ" are as much a part of what the foundation is claiming as the
 * digits are. So it finds the number inside the string, animates that, and puts
 * the rest back exactly as written.
 *
 * It also means an admin can type something with no number in it at all
 * (`many`, `—`), and the right thing happens: the string renders, unanimated.
 *
 * ## Bengali digits
 *
 * `২৫` is U+09E6…U+09EF, not ASCII. Both are read, and each frame is formatted
 * back through `Intl` in the reader's own locale, so the count runs `০ ১ ২ …`
 * for a Bengali reader and the lakh grouping stays lakh grouping.
 *
 * Grouping is only applied if the admin's own string had a separator in it. A
 * typed `1500` counts up to `1500` and not to `1,500`: this renders what the
 * foundation wrote, and a component that quietly re-punctuates its input is a
 * component nobody can predict.
 *
 * ## What it renders before it animates
 *
 * The **finished** value, always — server-side, on first client render, and for
 * a reader who has asked for reduced motion. The animation is an enhancement
 * layered on afterwards, so a crawler, a no-JS reader and a screen reader all
 * get the figure rather than a zero, and there is no hydration mismatch to
 * reconcile.
 */
interface CountUpProps {
  /** The admin's string, e.g. `৳২৫ লক্ষ+`. */
  value: string;
  /** `'bn'` renders Bengali digits while counting. */
  locale: string;
  /** Milliseconds before the count starts — used to stagger a row of figures. */
  delay?: number;
  className?: string;
}

const DURATION_MS = 1600;

/** Bengali-Assamese digits, in order, so `০` → 0. */
const BENGALI_ZERO = 0x09e6;

/** ASCII or Bengali digits, then anything a number may carry along. */
const NUMBER_IN_STRING = /[0-9০-৯][0-9০-৯.,]*/u;

interface Parsed {
  prefix: string;
  suffix: string;
  target: number;
  fractionDigits: number;
  grouped: boolean;
}

export function parseFigure(value: string): Parsed | null {
  const match = NUMBER_IN_STRING.exec(value);
  if (!match) return null;

  const raw = match[0];
  const ascii = [...raw]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (code >= BENGALI_ZERO && code <= BENGALI_ZERO + 9) {
        return String(code - BENGALI_ZERO);
      }
      return ch;
    })
    .join('');

  // A comma is a thousands/lakh separator; a full stop is a decimal point.
  // `২৫,০০,০০০` and `3.5` both have to survive this.
  const grouped = ascii.includes(',');
  const plain = ascii.replace(/,/g, '');
  const target = Number(plain);
  if (!Number.isFinite(target)) return null;

  const dot = plain.indexOf('.');
  const fractionDigits = dot === -1 ? 0 : plain.length - dot - 1;

  return {
    prefix: value.slice(0, match.index),
    suffix: value.slice(match.index + raw.length),
    target,
    fractionDigits,
    grouped,
  };
}

/** `easeOutExpo` — fast at first, settling rather than stopping. */
function ease(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function CountUp({ value, locale, delay = 0, className }: CountUpProps) {
  const parsed = React.useMemo(() => parseFigure(value), [value]);
  const ref = React.useRef<HTMLSpanElement>(null);
  // `null` means "show the value as written" — the state every render starts in,
  // which is what keeps the server and the client agreeing.
  const [current, setCurrent] = React.useState<number | null>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node || !parsed || parsed.target <= 0) return;

    // Respected, not approximated. A reader who has turned motion off is often
    // doing it because motion makes them ill.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startedAt = 0;

    const run = () => {
      setCurrent(0);
      const step = (now: number) => {
        if (!startedAt) startedAt = now;
        const progress = Math.min((now - startedAt) / DURATION_MS, 1);
        setCurrent(parsed.target * ease(progress));
        if (progress < 1) frame = requestAnimationFrame(step);
        else setCurrent(null);
      };
      frame = requestAnimationFrame(step);
    };

    // Only once it is on screen. The hero's figures are above the fold and start
    // immediately; the same component further down a page waits its turn rather
    // than finishing before anybody has scrolled to it.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        timer = setTimeout(run, delay);
      },
      { threshold: 0.25 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [parsed, delay]);

  if (!parsed) return <span className={className}>{value}</span>;

  const shown =
    current === null
      ? value
      : parsed.prefix +
        new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
          minimumFractionDigits: parsed.fractionDigits,
          maximumFractionDigits: parsed.fractionDigits,
          useGrouping: parsed.grouped,
        }).format(current) +
        parsed.suffix;

  return (
    <span ref={ref} className={className}>
      {/*
        The finished figure for assistive technology, once, and the tick-over
        for the eye. Announcing the animation would read a different number
        sixty times a second; announcing both would read the figure twice.
      */}
      <span className="sr-only">{value}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
