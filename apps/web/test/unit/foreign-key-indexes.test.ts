import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * WO-68. Every foreign key is indexed, with its column **leading** the index.
 *
 * Two costs, and the second is the one that gets missed:
 *
 * 1. **Reads.** `Loan.guarantorId` is filtered in nine places, including a
 *    correlated subquery evaluated once per row of the member list —
 *    `EXISTS(SELECT 1 FROM loans l WHERE l."guarantorId" = u.id AND …)`. With no
 *    index that is a sequential scan of `loans` per member rendered. Invisible at
 *    today's row counts; quadratic as membership grows.
 * 2. **Writes to the *parent*.** Postgres validates a foreign key by looking for
 *    referencing rows, and with no index on the child that means scanning the
 *    whole child table — while holding a lock. Deleting or updating a user is
 *    slow for a reason nothing about the user table explains.
 *
 * This is a census, not a list, deliberately: the point is that the *next*
 * foreign key someone adds fails the build until it is indexed. A list of the
 * six that were missing on 2026-08-19 would be satisfied and then stale.
 *
 * "Leading" matters. Postgres can use `@@index([a, b])` for a predicate on `a`,
 * but not for one on `b` alone — so an index that merely *contains* the column
 * does not answer a lookup by it.
 */

const SCHEMA = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);

type Model = { name: string; body: string };

function models(): Model[] {
  const out: Model[] = [];
  for (const m of SCHEMA.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    out.push({ name: m[1], body: m[2] });
  }
  return out;
}

/** The scalar fields named in `@relation(fields: [...])` — i.e. the actual FK columns. */
function foreignKeys(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/@relation\([^)]*fields:\s*\[([^\]]+)\]/g)) {
    for (const field of m[1].split(',')) out.add(field.trim());
  }
  return [...out];
}

/**
 * Columns that lead *some* index on the model.
 *
 * Counts `@@index`, `@@unique`, `@@id` and a single-field `@unique`, because
 * every one of those is backed by a real index Postgres can use. The
 * `(sort: Desc)` suffix is stripped — it changes the ordering, not what the
 * index can answer.
 */
function indexedLeadingColumns(body: string): Set<string> {
  const out = new Set<string>();
  const lead = (list: string) => list.split(',')[0].trim().split('(')[0].trim();

  for (const m of body.matchAll(/@@index\(\[([^\]]+)\]/g)) out.add(lead(m[1]));
  for (const m of body.matchAll(/@@unique\(\[([^\]]+)\]/g)) out.add(lead(m[1]));
  for (const m of body.matchAll(/@@id\(\[([^\]]+)\]/g)) out.add(lead(m[1]));
  for (const m of body.matchAll(/^\s*(\w+)\s+[\w[\]?]+[^\n]*@unique/gm)) out.add(m[1]);
  for (const m of body.matchAll(/^\s*(\w+)\s+[\w[\]?]+[^\n]*@id\b/gm)) out.add(m[1]);

  return out;
}

const MODELS = models();

describe('every foreign key is indexed', () => {
  it('can read the schema at all', () => {
    // A regex that silently matches nothing would make this whole file pass
    // while checking not one thing.
    expect(MODELS.length).toBeGreaterThan(15);
    expect(MODELS.flatMap((m) => foreignKeys(m.body)).length).toBeGreaterThan(10);
  });

  it('has no foreign key without an index leading on it', () => {
    const missing: string[] = [];
    for (const { name, body } of MODELS) {
      const indexed = indexedLeadingColumns(body);
      for (const fk of foreignKeys(body)) {
        if (!indexed.has(fk)) missing.push(`${name}.${fk}`);
      }
    }
    expect(
      missing.sort(),
      'These columns are foreign keys with no index leading on them. Every lookup ' +
        'through one is a sequential scan, and so is every foreign-key check when ' +
        'the parent row is written. Add `@@index([<column>])` — or a composite ' +
        'index with the column first — and generate a migration.\n  ' +
        missing.join('\n  '),
    ).toEqual([]);
  });
});

describe('the indexes the hot paths actually need', () => {
  /**
   * A bare `@@index([guarantorId])` satisfies the census above, but every real
   * predicate is `guarantorId = ? AND status IN (…)`. The composite answers it
   * from the index alone rather than reading the heap to check the status.
   *
   * Pinned separately because the census cannot know the query shape, and
   * because someone tidying "redundant" indexes would otherwise be told nothing.
   */
  it('loans are indexed by guarantor *and* status together', () => {
    const loan = MODELS.find((m) => m.name === 'Loan');
    expect(loan).toBeDefined();
    expect(
      /@@index\(\[guarantorId,\s*status\]/.test(loan!.body),
      'member_repository, worker_repository and transaction_repository all filter ' +
        'loans by guarantorId together with status — the composite index is what ' +
        'makes the per-row EXISTS on the member list an index lookup',
    ).toBe(true);
  });
});
