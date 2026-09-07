import * as React from 'react';

/**
 * The heading at the top of a marketing section.
 *
 * WHY IT IS A COMPONENT. The home page had this block written out seven times —
 * `<div className="reveal text-center mb-12">`, an `h2` at four breakpoints, an
 * optional badge, an optional `text-muted-foreground` paragraph — and they had
 * already drifted: two carried a badge, one had no subtitle, and the type
 * scales agreed only because nobody had touched them separately yet.
 *
 * THE ORNAMENT IS ONE STROKE UNDER THE TITLE, and it took three tries to get
 * there. It was a leaf mark above the title AND a rule–leaf–rule divider below
 * it, which the owner refused — "I didn't like the style you added at the
 * header's top and bottom" — so both went, along with the `surface-seam`
 * hairline at each section's top edge. What replaced them comes from a
 * reference the owner supplied: a single hand-drawn underline, thicker in the
 * middle, bowed like something brushed under a word. Nothing above the title
 * any more, and one thing below it rather than three.
 *
 * The stroke is sized from the TITLE, not from the section: the `h2` sits in an
 * `inline-block` so the wrapper shrinks to the text, and the underline is
 * absolutely positioned across that. A fixed width would be short under
 * "Your Donation Can Change a Life" and comically wide under "Contact" — and
 * Bengali sets wider than English at the same point size, so any constant here
 * would be wrong in one language by construction.
 *
 * It carries its own `reveal`, so a caller cannot add a heading and forget to
 * animate it.
 *
 * No copy lives here. Every string is passed in, already translated, so this
 * stays invisible to the translation census by construction — see
 * `apps/web/test/unit/messages.test.ts`.
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
      {icon && (
        <div
          className={[
            'mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl',
            amber ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30',
          ].join(' ')}
        >
          {icon}
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
 * The brushed underline.
 *
 * A FILLED path rather than a stroked one, because the whole character of it is
 * that it is thick in the middle and tapers to nothing at both ends, and a
 * stroke has one width everywhere. The shape is two curves that start and end
 * at the same two points: the outward one bows down, the return one bows down
 * slightly less, and the gap between them IS the thickness. At the tips the gap
 * closes to zero, which is the taper.
 *
 * `preserveAspectRatio="none"` so it stretches to whatever the title measures.
 * That is safe here and would not be for the leaf: this shape is nearly
 * horizontal, so stretching it changes its length and almost nothing else,
 * whereas a leaf stretched to 4x reads as a smear.
 *
 * The viewBox is 240x10 and the box it renders into is 12px tall, so the
 * vertical scale is slightly OVER 1 and the stroke keeps its weight. The first
 * version used a 14-unit-tall viewBox in a 10px box — a 0.7x vertical squash
 * that turned a 3-unit stroke into two pixels of hairline. With
 * `preserveAspectRatio="none"` the viewBox's height is not a canvas, it is a
 * divisor.
 */
function Underline({ className }: { className?: string }) {
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
