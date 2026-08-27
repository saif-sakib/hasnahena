export const ACCOUNT_NO_PREFIX = 'ACC-KH-33';

const ACCOUNT_NO_REGEX = /^ACC-KH-33(\d+)$/;

export function formatAccountSequenceNumber(sequence: number): string {
  return sequence.toString().padStart(3, '0');
}

export function formatAccountNo(sequence: number): string {
  return `${ACCOUNT_NO_PREFIX}${formatAccountSequenceNumber(sequence)}`;
}

export function parseAccountSequence(accountNo: string | null | undefined): number | null {
  if (!accountNo) return null;
  const match = accountNo.match(ACCOUNT_NO_REGEX);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isStandardAccountNo(accountNo: string | null | undefined): boolean {
  return Boolean(accountNo && ACCOUNT_NO_REGEX.test(accountNo));
}

export const NEXT_ACCOUNT_NO_SQL = `
  SELECT COALESCE(
    MAX(CAST(SUBSTRING("accountNo" FROM 'ACC-KH-33(\\d+)$') AS INTEGER)),
    0
  ) + 1 AS next_seq
  FROM users
  WHERE "accountNo" ~ '^ACC-KH-33[0-9]+$'
`;

export const MEMBER_ID_ADVISORY_LOCK_SQL = `SELECT pg_advisory_xact_lock(873921)`;

/**
 * The staff series — `STF-0001`.
 *
 * Staff account numbers were `STF-MOB97EFH-A1B2C3`: a base-36 millisecond
 * timestamp and six random hex characters. Unique, and meaningless — it cannot
 * be read aloud, it sorts by nothing a human recognises, and it tells you
 * nothing about the person holding it. It exists because a millisecond alone is
 * not unique and randomness was the quickest way to make it so.
 *
 * The members' own numbers had the answer all along: allocate from the maximum
 * already issued, under an advisory lock, in the transaction that creates the
 * row. Same mechanism, same guarantee, and the result is a number somebody can
 * say over a phone.
 *
 * **One series for every role, not `ADM-` and `WRK-`.** A worker promoted to
 * admin keeps their number, because this platform's rule is that a person has
 * exactly one identifier and it never changes ([ADR-023](../../../docs/decisions.md)).
 * Prefixing by role would force a promotion either to renumber somebody or to
 * leave their prefix lying about what they are — and the number is also the name
 * of their folder on the image host, so renumbering would orphan their files.
 *
 * Four digits, not three: this is padding for readability and not a limit —
 * `%04d` of 10,000 is simply `10000`, the same way the member series behaves
 * past 999.
 */
export const STAFF_NO_PREFIX = 'STF-';

const STAFF_NO_REGEX = /^STF-(\d+)$/;

export function formatStaffNo(sequence: number): string {
  return `${STAFF_NO_PREFIX}${sequence.toString().padStart(4, '0')}`;
}

export function parseStaffSequence(accountNo: string | null | undefined): number | null {
  if (!accountNo) return null;
  const match = accountNo.match(STAFF_NO_REGEX);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The next staff number, from the highest already issued.
 *
 * `~ '^STF-[0-9]+$'` deliberately ignores the old `STF-<base36>-<hex>` values:
 * they are not in this series and casting one to an integer would fail. Existing
 * staff keep the number they were given — renumbering a live account would
 * change the folder their avatar lives in for no gain.
 */
export const NEXT_STAFF_NO_SQL = `
  SELECT COALESCE(
    MAX(CAST(SUBSTRING("accountNo" FROM 'STF-([0-9]+)$') AS INTEGER)),
    0
  ) + 1 AS next_seq
  FROM users
  WHERE "accountNo" ~ '^STF-[0-9]+$'
`;

/**
 * A different lock id from the member series.
 *
 * They allocate from disjoint sets of rows, so sharing one lock would make
 * hiring a field worker wait behind every registration — and this lock is taken
 * inside the transaction that creates the account.
 */
export const STAFF_NO_ADVISORY_LOCK_SQL = `SELECT pg_advisory_xact_lock(873922)`;
