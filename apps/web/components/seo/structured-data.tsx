import type { Locale } from '@/i18n';
import { faqEntries, noticePeriodDaysFrom } from '@/lib/faq';
import {
  pageLabel,
  publicPageGraph,
  serializeJsonLd,
} from '@/lib/structured-data';

/**
 * The site's JSON-LD, for one public page — WO-79.
 *
 * ── Why this is the only `dangerouslySetInnerHTML` in the repository ─────────
 *
 * `<script type="application/ld+json">{JSON.stringify(x)}</script>` does not
 * work: React HTML-escapes a text child, and HTML entities are not decoded
 * inside a `<script>` element, so every `"` in the payload arrives at the
 * crawler as `&quot;` and the JSON is unparseable. Next's own JSON-LD guide
 * therefore specifies `dangerouslySetInnerHTML` with `<` escaped to `<`.
 *
 * That matters here because ADR-024 argues the marketing pages may keep
 * `'unsafe-inline'` in `script-src`, and part of that argument was that these
 * pages contain no XSS sink at all. They now contain exactly one, so the
 * argument has to be re-made rather than quietly kept:
 *
 *   - The prop is not a string. It takes a `locale` and a `path`, builds the
 *     object graph itself, and the only text that can reach it is `org.*`
 *     settings an admin typed.
 *   - `serializeJsonLd` escapes `<`, so an admin who writes `</script>` into the
 *     organisation name gets `</script>` — inert text inside the payload,
 *     not a closed element followed by markup.
 *   - That escape lives in the serialiser, not at this call site, so it cannot
 *     be skipped by a second caller.
 *   - `csp.test.ts` counts the occurrences of `dangerouslySetInnerHTML` across
 *     `app/`, `components/` and `lib/`, and fails if a second one appears or if
 *     this one stops escaping. The claim in `lib/csp.ts` is a test, not a
 *     comment.
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
