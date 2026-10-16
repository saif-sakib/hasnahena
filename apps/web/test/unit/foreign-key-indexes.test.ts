import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * WO-68: every foreign key is indexed with its column LEADING the index —
 * unindexed FKs mean per-row scans and full child scans (under lock) when a
 * parent changes. A census, so the next FK fails until indexed.
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

/** Columns that lead some index (@@index, @@unique, @@id, @unique). */
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
  /** guarantorId + status composite: every real predicate filters both. */
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
