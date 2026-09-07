import * as React from 'react';

/**
 * The heading at the top of a marketing section.
 *
 * WHY IT IS A COMPONENT. The home page had this block written out seven times —
 * `<div className="reveal text-center mb-12">`, an `h2` at four breakpoints, an
 * optional badge, an optional `text-muted-foreground` paragraph — and they had
 * already drifted: two carried a badge, one had no subtitle, and the type
 * scales agreed only because nobody had touched them separately yet. Seven
 * copies is seven places to get the next change half-right.
 *
 * IT CARRIES NO ORNAMENT. It briefly had a leaf mark above the title and a
 * rule–leaf–rule divider under it, taken from the reference designs, and the
 * owner's answer was "I didn't like the style you added at the header's top and
 * bottom" — so both are gone, along with the hairline `surface-seam` that used
 * to sit at each section's top edge. A section is now separated from the one
 * above it by its ground and its spacing, which is what the rest of this site
 * already did. The botanical motif stays where it was welcome: the cropped
 * sprigs (`LeafFlourish`) at the edge of two sections, which were liked.
 *
 * Do not put it back without asking. It is a small change to make and it has
 * been refused once.
 *
 * It carries its own `reveal`, so a caller cannot add a heading and forget to
 * animate it — which is how the gallery block ended up as the one thing on the
 * page that arrived fully formed while everything around it moved.
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
  /** Which of the two section palettes the badge uses. */
  accent?: 'emerald' | 'amber';
  className?: string;
}) {
  return (
    <div className={['reveal text-center', className ?? 'mb-12'].join(' ')}>
      {icon && (
        <div
          className={[
            'mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl',
            accent === 'amber' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30',
          ].join(' ')}
        >
          {icon}
        </div>
      )}

      <h2 className="text-2xl font-bold sm:text-3xl md:text-4xl">{title}</h2>

      {subtitle && (
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
