import * as React from 'react';
import { Underline } from '@/components/ui/section-heading';

/**
 * The opening of every interior public page: eyebrow, title with the same
 * brushed mark as the home page's sections, and a lead — on the lattice,
 * so the page reads as part of the site the home page started. No copy lives
 * here; no reveal either, because it is always above the fold.
 *
 * `pt-32 md:pt-40` clears the fixed header at its tallest.
 */
export function PageHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** Anything below the lead (a revision date, say). */
  children?: React.ReactNode;
}) {
  return (
    <section className="surface-veil relative pt-32 pb-12 md:pt-40 md:pb-16">
      {/* The lattice fades out downward, so the cards below sit on plain paper rather than across an edge. */}
      <div
        aria-hidden="true"
        className="lattice-tile pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_35%,transparent)]"
      />
      <div className="container-wide relative max-w-3xl text-center">
        {eyebrow && <p className="eyebrow mb-4 text-emerald-700 dark:text-emerald-400">{eyebrow}</p>}
        <h1 className="text-3xl font-bold leading-tight text-slate-900 text-balance sm:text-4xl md:text-5xl dark:text-white">
          {title}
        </h1>
        {/* A short centred rule: a title that wraps would stretch a full-width one past its words. */}
        <Underline className="mx-auto mt-3 block h-3 w-32 text-emerald-400 dark:text-emerald-500" />
        {lead && (
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600 md:text-lg dark:text-slate-300">
            {lead}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

/** The body of an interior page, below its hero. */
export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={['container-wide pb-16 md:pb-24', className ?? ''].join(' ')}>{children}</div>;
}

/** An emerald icon tile — the one icon treatment on public pages. */
export function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
      {children}
    </div>
  );
}

/** A white card that sits on the ivory paper (the home page's card). */
export const paperCard =
  'rounded-sm border border-slate-200/70 bg-white card-raise dark:border-slate-800 dark:bg-slate-900';
