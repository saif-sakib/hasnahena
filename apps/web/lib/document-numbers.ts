/**
 * Document reference numbers (DEP-2026-000123, LOAN-2026-000012…), readable
 * because they are read aloud (ADR-008). Allocated atomically from
 * document_sequences — the same table the Go API uses.
 */

import { prisma } from '@/lib/prisma';

export const SERIES = {
  deposit: 'DEP',
  withdrawal: 'WDR',
  loan: 'LOAN',
  loanRepayment: 'REP',
  /**
   * The applicant's number, `APP-2026-000001` (users.formNumber). The account
   * number is issued only at approval, so a rejection burns nothing (ADR-039).
   */
  application: 'APP',
} as const;

export type Series = (typeof SERIES)[keyof typeof SERIES];

/** Minimal shape shared by the Prisma client and an interactive transaction. */
type Queryable = Pick<typeof prisma, '$queryRaw'>;

export const formatDocumentNumber = (series: Series, year: number, counter: bigint | number): string =>
  `${series}-${year}-${String(counter).padStart(6, '0')}`;

/** Allocate the next number; pass the transaction client so a rollback releases it. */
export async function nextDocumentNumber(
  series: Series,
  client: Queryable = prisma
): Promise<string> {
  const year = new Date().getFullYear();

  // Timestamps written explicitly: Prisma's @updatedAt has no DB default.
  const rows = await client.$queryRaw<Array<{ counter: bigint }>>`
    INSERT INTO document_sequences (series, year, counter, "createdAt", "updatedAt")
    VALUES (${series}, ${year}, 1, NOW(), NOW())
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
