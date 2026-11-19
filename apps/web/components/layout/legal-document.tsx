import Link from 'next/link';
import { formatLegalDate } from '@/lib/legal';
import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { PageHero, paperCard } from '@/components/layout/page-hero';

interface LegalSection {
  title: string;
  content: string;
}

interface LegalDocumentProps {
  title: string;
  intro: string;
  /** ISO date from `lib/legal.ts`. */
  lastUpdated: string;
  locale: string;
  sections: LegalSection[];
  /** ICU-style `{name}` substitutions for the section bodies. */
  values?: Record<string, string>;
  /** Related pages linked beneath the document body. */
  crossLinks?: Array<{ href: string; label: string }>;
}

/** The shell both legal pages render into, on the interior pages' hero. */
export async function LegalDocument({
  title,
  intro,
  lastUpdated,
  locale,
  sections,
  values,
  crossLinks,
}: LegalDocumentProps) {
  const t = await getTranslations({ locale, namespace: 'legal' });

  /**
   * `{rejectedDays}` → `365`. Manual, because t.raw() skips ICU; the placeholder
   * syntax stays checkable by messages.test.ts.
   */
  const fill = (text: string) =>
    values
      ? text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
      : text;

  return (
    <main className="surface-paper flex-1">
      <PageHero title={title} lead={intro}>
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          <time dateTime={lastUpdated}>
            {t('lastUpdated', { date: formatLegalDate(lastUpdated, locale) })}
          </time>
        </p>
      </PageHero>

      {/* One document, numbered sections divided by hairlines — read like a page, not a deck of cards. */}
      <div className="container-wide max-w-3xl pb-16 md:pb-24">
        <div className={`${paperCard} divide-y divide-slate-100 dark:divide-slate-800`}>
          {sections.map((section, index) => (
            <section key={section.title} className="p-6 md:p-8">
              <h2 className="mb-3 flex gap-3 text-lg font-semibold text-slate-900 dark:text-white">
                <span className="tabular-nums text-emerald-700 dark:text-emerald-400">{index + 1}.</span>
                {section.title}
              </h2>
              <p className="leading-relaxed text-slate-600 dark:text-slate-400">{fill(section.content)}</p>
            </section>
          ))}
        </div>

        {crossLinks && crossLinks.length > 0 && (
          <nav
            aria-label={t('backToHome')}
            className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm"
          >
            {crossLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                {item.label}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ))}
          </nav>
        )}
      </div>
    </main>
  );
}
