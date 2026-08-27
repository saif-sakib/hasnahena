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
  /**
   * The application's own number — `APP-2026-000001`, stored in
   * `users.formNumber` ("ফরম নং").
   *
   * An applicant needs a reference the moment they submit, and for a while that
   * reference was their **account number**, allocated by the registration route
   * before anybody had looked at the application. Rejecting the first applicant
   * therefore consumed `ACC-KH-33001` for ever and gave the next one `002` — a
   * hole in the foundation's own register, punched by a public form that anyone
   * can submit.
   *
   * So there are two numbers, which is what the paper world already does: you
   * are given a **form number** when you apply, and a **membership number** when
   * you are admitted. `accountNo` is now issued by the approval path and by
   * nothing else, so the register is continuous and `ACC-KH-33001` means "the
   * first member" rather than "the first person who opened the form".
   */
  application: 'APP',
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

  // "createdAt" and "updatedAt" are written explicitly. Both are NOT NULL, and
  // Prisma's `@updatedAt` is applied by the client rather than by the database
  // — a raw INSERT gets no value for it, so the *first* allocation of a series
  // in a given year failed a NOT NULL check while every later one succeeded via
  // the DO UPDATE branch. Because the first one never landed, the conflict path
  // was never reached either: no loan application could be created at all until
  // a row for that series and year existed. The Go allocator names both columns
  // for exactly this reason (utils.NextDocumentNumberQuery); this copy did not.
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
