export const MEMBER_ID_PREFIX = 'ACC-KH-33';

const MEMBER_ID_REGEX = /^ACC-KH-33(\d+)$/;

export function formatMemberSequenceNumber(sequence: number): string {
  return sequence.toString().padStart(3, '0');
}

export function formatMemberId(sequence: number): string {
  return `${MEMBER_ID_PREFIX}${formatMemberSequenceNumber(sequence)}`;
}

export function parseMemberSequence(memberId: string | null | undefined): number | null {
  if (!memberId) return null;
  const match = memberId.match(MEMBER_ID_REGEX);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isStandardMemberId(memberId: string | null | undefined): boolean {
  return Boolean(memberId && MEMBER_ID_REGEX.test(memberId));
}

export const NEXT_MEMBER_ID_SQL = `
  SELECT COALESCE(
    MAX(CAST(SUBSTRING("memberId" FROM 'ACC-KH-33(\\d+)$') AS INTEGER)),
    0
  ) + 1 AS next_seq
  FROM users
  WHERE "memberId" ~ '^ACC-KH-33[0-9]+$'
`;

export const MEMBER_ID_ADVISORY_LOCK_SQL = `SELECT pg_advisory_xact_lock(873921)`;
