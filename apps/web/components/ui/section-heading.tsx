import * as React from 'react';

/**
 * A marketing section heading: optional badge, title, subtitle, and one
 * brushed underline sized to the TITLE (inline-block), since Bengali sets
 * wider. Carries its own `reveal`. No copy lives here — strings are passed in.
 */
export function SectionHeading({
  title,
  subtitle,
  icon,
  accent = 'emerald',
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** A badge shown above the title. Scripture gets a book; most sections none. */
  icon?: React.ReactNode;
  /** Which of the two section palettes the badge and underline use. */
  accent?: 'emerald' | 'amber';
  className?: string;
}) {
  const amber = accent === 'amber';

  return (
    <div className={['reveal text-center', className ?? 'mb-12'].join(' ')}>
      {/* The badge gets its own block wrapper, or it shares a line with the inline-block title. */}
      {icon && (
        <div className="mb-4 flex justify-center">
          <div
            className={[
              'inline-flex h-14 w-14 items-center justify-center rounded-2xl',
              amber ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30',
            ].join(' ')}
          >
            {icon}
          </div>
        </div>
      )}

      <div className="relative inline-block pb-3">
        <h2 className="text-2xl font-bold sm:text-3xl md:text-4xl">{title}</h2>
        <Underline
          className={[
            'absolute inset-x-0 bottom-0 h-3 w-full',
            amber ? 'text-amber-400 dark:text-amber-500' : 'text-emerald-400 dark:text-emerald-500',
          ].join(' ')}
        />
      </div>

      {subtitle && (
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

/**
 * The brushed underline: a FILLED path (two curves, the gap is the thickness,
 * closing to a taper), stretched with preserveAspectRatio="none". The viewBox
 * height must stay ≤ the box height, or the stroke squashes to a hairline.
 */
export function Underline({ className }: { className?: string }) {
  return (
    <svg
      className={['pointer-events-none select-none', className ?? ''].join(' ')}
      viewBox="0 0 240 10"
      preserveAspectRatio="none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 3.5 C 62 7, 178 7, 237 2.5 C 178 12, 62 12, 3 3.5 Z"
        fill="currentColor"
      />
    </svg>
  );
}
