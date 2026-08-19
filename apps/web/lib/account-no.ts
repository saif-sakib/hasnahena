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
