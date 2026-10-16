'use client';

import * as React from 'react';

/**
 * A figure that counts up when it comes into view. It takes the admin's STRING
 * (`৳২৫ লক্ষ+`, `135+`), finds the number inside — Bengali or ASCII digits —
 * animates it in the reader's locale, and puts the rest back as written; no
 * number means no animation. Grouping only if the admin's string had it. The
 * finished value renders server-side and for reduced motion.
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

    // Start only once on screen.
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
      {/* Screen readers get the finished figure once; the ticking digits are aria-hidden. */}
      <span className="sr-only">{value}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
