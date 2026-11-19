import type { Locale } from '@/i18n';
import { faqEntries, noticePeriodDaysFrom } from '@/lib/faq';
import {
  pageLabel,
  publicPageGraph,
  serializeJsonLd,
  type PageGraphInput,
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
  headline,
  description,
  dateModified,
  article,
  howTo,
  activityItems,
  galleryItems,
}: {
  locale: Locale;
  path: string;
  settings: Record<string, string>;
  headline?: string;
  description?: string;
  dateModified?: string;
  article?: PageGraphInput['article'];
  howTo?: PageGraphInput['howTo'];
  activityItems?: PageGraphInput['activityItems'];
  galleryItems?: PageGraphInput['galleryItems'];
}) {
  const graph = publicPageGraph({
    settings,
    locale,
    path,
    label: pageLabel(locale, path),
    headline,
    description,
    dateModified,
    // From the same settings map the page renders from, so the rich
    // result and the visible answer cannot disagree.
    faq: path === '/faq' ? faqEntries(locale, noticePeriodDaysFrom(settings)) : undefined,
    article,
    howTo,
    activityItems,
    galleryItems,
  });

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }}
    />
  );
}
