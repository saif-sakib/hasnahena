/**
 * Making an older audit sentence readable, without rewriting it.
 *
 * `audit_logs` is append-only at the database level (DATA-08) and its trigger
 * refuses UPDATE unconditionally. That is right, and it means the rows written
 * before ADR-044 keep the identifiers they were written with: the migration
 * remapped the `entityId` **column**, because a column is structure, but it did
 * not touch `details`, which is a sentence somebody composed.
 *
 * So a repayment from 2026-09-01 reads:
 *
 *   entityId  LOAN-2026-000002
 *   details   Repayment 19000 BDT on loan 8f7ade16-7e3f-4706-8928-d238091d2aa7
 *             by member ACC-KH-33003, receipt REP-2026-000002
 *
 * — the same loan, named twice, once by a number and once by the key it used to
 * have. Nothing is wrong with the record; the reader is simply being shown an
 * identifier that no longer names anything they can look up.
 *
 * This resolves that at render time. It does not rewrite the row, and it is
 * deliberately narrow:
 *
 *  - only tokens shaped like the identifiers this schema has retired — a UUID,
 *    or a cuid
 *  - only when the row's own `entityId` is **not** one of those, so there is a
 *    current name to put there
 *  - only when the sentence contains exactly **one** distinct retired token,
 *    because with two there is nothing on the row that says which is which, and
 *    guessing would put a loan's number where a member's belongs
 *
 * Anything else is returned untouched. A sentence this cannot resolve is shown
 * as it was written, which is the only honest alternative.
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
