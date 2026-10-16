/**
 * Render-time readability for pre-ADR-044 audit sentences (rows are never
 * rewritten). Replaces a retired UUID/cuid in `details` only when the row's
 * entityId is a current name AND the sentence holds exactly one distinct
 * retired token; anything else is shown as written.
 */

/** A UUID, or a cuid — the two shapes of key this schema has retired. */
const RETIRED_ID =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|c[a-z0-9]{24})\b/gi;

export function isRetiredId(value: string): boolean {
  RETIRED_ID.lastIndex = 0;
  const match = RETIRED_ID.exec(value);
  return match !== null && match[0].length === value.length;
}

export function readableDetails(
  details: string | null,
  entityId: string | null,
): string | null {
  if (!details) return details;
  if (!entityId || isRetiredId(entityId)) return details;

  const found = new Set(details.match(RETIRED_ID) ?? []);
  if (found.size !== 1) return details;

  const [stale] = [...found];
  return details.split(stale).join(entityId);
}
