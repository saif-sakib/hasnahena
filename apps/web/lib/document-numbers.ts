/**
 * Document reference numbers — DEP-2026-000123, LOAN-2026-000012, and so on.
 *
 * These are printed on receipts, loan agreements and paper passbooks, so they
 * are readable rather than random: a member reading one aloud at the counter
 * needs no decoding, which is the same reasoning behind the `ACC-KH-#####`
 * member IDs (ADR-008).
 *
 * The running number comes from the `document_sequences` table, incremented
 * atomically by an upsert — concurrent requests serialise on the row, so two
 * records can never take the same number. The Go API allocates from the same
 * table for postings it writes, which keeps one series per document type
 * whichever backend created the record.
 */

import { prisma } from '@/lib/prisma';

export const SERIES = {
  deposit: 'DEP',
  withdrawal: 'WDR',
  loan: 'LOAN',
  loanRepayment: 'REP',
} as const;

export type Series = (typeof SERIES)[keyof typeof SERIES];

/** Minimal shape shared by the Prisma client and an interactive transaction. */
type Queryable = Pick<typeof prisma, '$queryRaw'>;

export const formatDocumentNumber = (series: Series, year: number, counter: bigint | number): string =>
  `${series}-${year}-${String(counter).padStart(6, '0')}`;

/**
 * Allocate the next number in a series.
 *
 * Pass the transaction client when the record is written inside one, so a
 * rolled-back write releases the number instead of leaving a gap.
 */
export async function nextDocumentNumber(
  series: Series,
  client: Queryable = prisma
): Promise<string> {
  const year = new Date().getFullYear();

  const rows = await client.$queryRaw<Array<{ counter: bigint }>>`
    INSERT INTO document_sequences (series, year, counter)
    VALUES (${series}, ${year}, 1)
    ON CONFLICT (series, year)
    DO UPDATE SET counter = document_sequences.counter + 1, "updatedAt" = NOW()
    RETURNING counter
  `;

  const counter = rows[0]?.counter;
  if (counter === undefined) {
    throw new Error(`Failed to allocate a ${series} document number`);
  }

  return formatDocumentNumber(series, year, counter);
}
