import type { ReactNode } from 'react';
import { formatLegalDate } from '@/lib/legal';
import { getTranslations } from 'next-intl/server';

interface LegalSection {
  title: string;
  content: string;
}

interface LegalDocumentProps {
  icon: ReactNode;
  title: string;
  intro: string;
  /** ISO date from `lib/legal.ts`. */
  lastUpdated: string;
  locale: string;
  sections: LegalSection[];
  /** ICU-style `{name}` substitutions for the section bodies. */
  values?: Record<string, string>;
}

/**
 * The shell both legal pages render into.
 *
 * One component rather than two near-identical page bodies, because the two
 * pages had already drifted apart in the ways two copies always do — the same
 * "Last updated: March 2026" literal in both, the same bespoke header in both,
 * and no way to change one without remembering the other.
 *
 * `pt-24` is the shared clearance under the fixed header, matching /support and
 * /faq. Before T-10 the interior pages used `pt-32`, `pt-24` and `pt-20`
 * depending on which was written last.
 */
export async function LegalDocument({
  icon,
  title,
  intro,
  lastUpdated,
  locale,
  sections,
  values,
}: LegalDocumentProps) {
  const t = await getTranslations({ locale, namespace: 'legal' });

  /**
   * `{rejectedDays}` → `365`.
   *
   * Deliberately not next-intl's own interpolation: the section bodies arrive
   * through `t.raw()` as plain strings so the page can iterate them, and `raw`
   * by definition skips the ICU pass. Substituting here keeps the placeholder
   * syntax identical in the message files, so `messages.test.ts` still checks
   * that Bengali carries every `{placeholder}` the English string has.
   */
  const fill = (text: string) =>
    values
      ? text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
      : text;

  return (
    <main className="flex-1 bg-slate-50 dark:bg-slate-950 pt-24 pb-16">
      <div className="container-wide max-w-3xl">
        <div className="mb-8">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
            {icon}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">{title}</h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">{intro}</p>
          <p className="mt-4 text-sm text-slate-500">
            {t('lastUpdated', { date: formatLegalDate(lastUpdated, locale) })}
          </p>
        </div>

        <div className="space-y-6">
          {sections.map((section) => (
            <section
              key={section.title}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800 p-6 shadow-xs"
            >
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
                {section.title}
              </h2>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {fill(section.content)}
              </p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
