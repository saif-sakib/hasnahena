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
 * The staff series — `STF-0001`, allocated from the max issued under an
 * advisory lock, like the member series. One series for every role, so a
 * promotion never renumbers anyone (ADR-023) — the number also names their
 * image folder. Four digits is padding, not a limit.
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

/** The next staff number. Legacy `STF-<base36>-<hex>` values are ignored and kept. */
export const NEXT_STAFF_NO_SQL = `
  SELECT COALESCE(
    MAX(CAST(SUBSTRING("accountNo" FROM 'STF-([0-9]+)$') AS INTEGER)),
    0
  ) + 1 AS next_seq
  FROM users
  WHERE "accountNo" ~ '^STF-[0-9]+$'
`;

/** A separate lock id, so hiring a worker never waits behind registrations. */
export const STAFF_NO_ADVISORY_LOCK_SQL = `SELECT pg_advisory_xact_lock(873922)`;
