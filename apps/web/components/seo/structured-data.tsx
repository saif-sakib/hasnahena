import type { Locale } from '@/i18n';
import { faqEntries, noticePeriodDaysFrom } from '@/lib/faq';
import {
  pageLabel,
  publicPageGraph,
  serializeJsonLd,
} from '@/lib/structured-data';

/**
 * The site's JSON-LD for one public page (WO-79) — the repo's only raw-HTML
 * sink, required because React would entity-escape a script child. Safe because
 * it takes locale/path (not a string), serializeJsonLd escapes `<`, and
 * csp.test.ts fails on a second sink (ADR-024).
 */
export function StructuredData({
  locale,
  path,
  settings,
}: {
  locale: Locale;
  path: string;
  settings: Record<string, string>;
}) {
  const graph = publicPageGraph({
    settings,
    locale,
    path,
    label: pageLabel(locale, path),
    // From the same settings map the page renders from, so the rich
    // result and the visible answer cannot disagree.
    faq: path === '/faq' ? faqEntries(locale, noticePeriodDaysFrom(settings)) : undefined,
  });

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }}
    />
  );
}
