import { describe, it, expect, vi } from 'vitest';

// The module pulls in the Prisma client for its default argument. Constructing
// a real one in a unit test needs a DATABASE_URL and buys nothing — every test
// here passes its own queryable.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const { SERIES, nextDocumentNumber, formatDocumentNumber } = await import('./document-numbers');

/** Captures the tagged-template SQL instead of running it. */
function stubClient(rows: Array<{ counter: bigint }>) {
  const seen: { sql: string; values: unknown[] } = { sql: '', values: [] };
  const client = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      seen.sql = strings.join(' ? ');
      seen.values = values;
      return Promise.resolve(rows);
    },
  };
  return { client: client as never, seen };
}

describe('nextDocumentNumber', () => {
  // The regression this guards. `document_sequences."updatedAt"` is NOT NULL,
  // and Prisma applies @updatedAt in the client rather than as a database
  // default — so a raw INSERT that does not name the column violates the
  // constraint. Only the *first* allocation of a series in a year takes the
  // INSERT path, and because it could never land, the ON CONFLICT path was
  // never reached either: loan applications failed with a 500 indefinitely.
  // The Go allocator names both columns; this one did not until 2026-08-17.
  it('writes createdAt and updatedAt explicitly on the insert path', async () => {
    const { client, seen } = stubClient([{ counter: BigInt(1) }]);
    await nextDocumentNumber(SERIES.loan, client);

    expect(seen.sql).toContain('"createdAt"');
    expect(seen.sql).toContain('"updatedAt"');
    // Named in the column list *and* given a value, not just in the DO UPDATE.
    const flattened = seen.sql.replace(/\s+/g, ' ');
    expect(flattened).toMatch(/INSERT INTO document_sequences[^)]*"createdAt"[^)]*"updatedAt"/);
    expect(flattened).toMatch(/VALUES \( [^)]*NOW\(\), NOW\(\)/);
  });

  it('still bumps the counter when the row already exists', async () => {
    const { client, seen } = stubClient([{ counter: BigInt(2) }]);
    await nextDocumentNumber(SERIES.deposit, client);
    expect(seen.sql).toContain('DO UPDATE SET counter = document_sequences.counter + 1');
    expect(seen.sql).toContain('ON CONFLICT (series, year)');
  });

  it('files the number under the current year and pads the counter', async () => {
    const year = new Date().getFullYear();
    const { client, seen } = stubClient([{ counter: BigInt(42) }]);
    expect(await nextDocumentNumber(SERIES.loan, client)).toBe(`LOAN-${year}-000042`);
    expect(seen.values).toEqual([SERIES.loan, year]);
  });

  it('fails loudly rather than returning a number nothing allocated', async () => {
    const { client } = stubClient([]);
    await expect(nextDocumentNumber(SERIES.withdrawal, client)).rejects.toThrow(/allocate/i);
  });
});

describe('formatDocumentNumber', () => {
  it('pads to six digits and keeps growing past a million', () => {
    expect(formatDocumentNumber(SERIES.deposit, 2026, 1)).toBe('DEP-2026-000001');
    expect(formatDocumentNumber(SERIES.loanRepayment, 2026, 999999)).toBe('REP-2026-999999');
    expect(formatDocumentNumber(SERIES.loan, 2026, 1234567)).toBe('LOAN-2026-1234567');
  });

  it('accepts the bigint the database actually returns', () => {
    expect(formatDocumentNumber(SERIES.withdrawal, 2026, BigInt(7))).toBe('WDR-2026-000007');
  });
});
