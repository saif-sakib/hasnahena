// The staff account-number series, restated for the scripts.
//
// The source of truth is `apps/web/lib/account-no.ts`. This is a copy, which
// this repository normally refuses — it is here because `scripts/*.mjs` run
// under plain `node`, not under Next: there is no TypeScript loader and no `@/`
// alias resolution, which is why every script in that directory imports nothing
// but its own `./lib/`. Restating four lines is the lesser evil against making
// the seed and the cutover purge depend on a build step.
//
// **One copy, not one per script.** `seed.mjs` and `go-live-purge.mjs` both
// allocate staff numbers, and a second restatement would be a copy of a copy —
// `test/unit/purge-script.test.ts` reads this file against `lib/account-no.ts`
// and fails if they drift, so the copy is checked rather than trusted.

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

/**
 * The next staff number, allocated under the advisory lock.
 *
 * Takes a transaction client. The lock is transaction-scoped, so it is released
 * by the commit or the rollback and never has to be given back by hand — and it
 * is what stops two callers reading the same maximum and both writing `STF-0007`
 * into a uniquely-indexed column.
 */
export async function allocateStaffNo(tx) {
  await tx.$executeRawUnsafe(STAFF_NO_ADVISORY_LOCK_SQL);
  const [{ next_seq: nextSeq }] = await tx.$queryRawUnsafe(NEXT_STAFF_NO_SQL);
  return formatStaffNo(Number(nextSeq));
}
