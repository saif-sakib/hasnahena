import * as React from 'react';
import { LeafMark } from './leaf-flourish';

/**
 * The heading at the top of a marketing section.
 *
 * WHY IT IS A COMPONENT. The home page had this block written out seven times —
 * `<div className="reveal text-center mb-12">`, an `h2` at four breakpoints, an
 * optional badge, an optional `text-muted-foreground` paragraph — and they had
 * already drifted: two carried a badge, one had no subtitle, and the type
 * scales agreed only because nobody had touched them separately yet. Seven
 * copies is seven places to forget the ornament, and the ornament is the part
 * a reader notices.
 *
 * WHAT THE ORNAMENT IS. A leaf mark above the heading and a rule–leaf–rule
 * divider under it, from the references the owner supplied. It does the job a
 * horizontal rule does — say "a new section starts here" — without drawing a
 * line across the page, and it is the same botanical motif as the sprigs and
 * the same five-pointed geometry as the khatam lattice behind them. A section
 * that supplies its own `icon` (scripture gets a book) shows that instead of
 * the leaf mark above; the divider is always there, so the sections still
 * rhyme.
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
  /** A badge shown above the title, in place of the leaf mark. */
  icon?: React.ReactNode;
  /** Which of the two section palettes the badge and ornament use. */
  accent?: 'emerald' | 'amber';
  className?: string;
}) {
  const tone = accent === 'amber' ? ACCENTS.amber : ACCENTS.emerald;

  return (
    <div className={['reveal text-center', className ?? 'mb-12'].join(' ')}>
      {icon ? (
        <div
          className={[
            'mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl',
            tone.badge,
          ].join(' ')}
        >
          {icon}
        </div>
      ) : (
        <LeafMark className={['mx-auto mb-3 h-5 w-[25px]', tone.mark].join(' ')} />
      )}

      <h2 className="text-2xl font-bold sm:text-3xl md:text-4xl">{title}</h2>

      {/*
        The divider. Two rules that fade away from the centre and a leaf
        between them — `aria-hidden` as a whole, because it is punctuation and
        a screen reader announcing it between a heading and its first sentence
        is noise.
      */}
      <div className="mt-4 flex items-center justify-center gap-2.5" aria-hidden="true">
        <span className={['h-px w-10 sm:w-14', tone.ruleLeft].join(' ')} />
        <LeafMark leaves={1} className={['h-3.5 w-[9px]', tone.mark].join(' ')} />
        <span className={['h-px w-10 sm:w-14', tone.ruleRight].join(' ')} />
      </div>

      {subtitle && (
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

/**
 * The two palettes, spelled out rather than interpolated.
 *
 * Tailwind compiles the classes it can see as whole strings in the source, so
 * `text-${accent}-600` produces a class that exists in the markup and in no
 * stylesheet — the failure is silent and looks like a colour that "did not
 * apply". Both variants are written out for that reason, not for clarity.
 */
const ACCENTS = {
  emerald: {
    badge: 'bg-emerald-100 dark:bg-emerald-900/30',
    mark: 'text-emerald-500/70 dark:text-emerald-400/60',
    ruleLeft: 'bg-linear-to-r from-transparent to-emerald-500/40',
    ruleRight: 'bg-linear-to-l from-transparent to-emerald-500/40',
  },
  amber: {
    badge: 'bg-amber-100 dark:bg-amber-900/30',
    mark: 'text-amber-500/70 dark:text-amber-400/60',
    ruleLeft: 'bg-linear-to-r from-transparent to-amber-500/40',
    ruleRight: 'bg-linear-to-l from-transparent to-amber-500/40',
  },
} as const;
