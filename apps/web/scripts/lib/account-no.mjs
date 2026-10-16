// The staff series, restated for plain-node scripts (no TS loader). Source of
// truth: lib/account-no.ts; purge-script.test.ts checks they agree.

export const STAFF_NO_ADVISORY_LOCK_SQL = `SELECT pg_advisory_xact_lock(873922)`;

export const NEXT_STAFF_NO_SQL = `
  SELECT COALESCE(
    MAX(CAST(SUBSTRING("accountNo" FROM 'STF-([0-9]+)$') AS INTEGER)),
    0
  ) + 1 AS next_seq
  FROM users
  WHERE "accountNo" ~ '^STF-[0-9]+$'
`;

const STAFF_NO_REGEX = /^STF-(\d+)$/;

export function formatStaffNo(sequence) {
  return `STF-${sequence.toString().padStart(4, '0')}`;
}

export function parseStaffSequence(accountNo) {
  const match = accountNo?.match(STAFF_NO_REGEX);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The next staff number, under a transaction-scoped advisory lock. */
export async function allocateStaffNo(tx) {
  await tx.$executeRawUnsafe(STAFF_NO_ADVISORY_LOCK_SQL);
  const [{ next_seq: nextSeq }] = await tx.$queryRawUnsafe(NEXT_STAFF_NO_SQL);
  return formatStaffNo(Number(nextSeq));
}
