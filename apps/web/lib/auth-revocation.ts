import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { AuthError, requireAuthDetailed, type VerifiedToken } from '@/lib/auth';

/**
 * Token revocation for the Next route handlers — SEC-11.
 *
 * The Go API has checked `token_blacklist` on every request since SEC-01. The
 * Next handlers did not: they verified the HS256 signature and `exp` and
 * stopped there. So after **logout**, after a **password change**, and after an
 * **admin revokes a user**, the old token still worked against every Next
 * endpoint — including `PUT /api/v1/settings`, which sets loan policy.
 *
 * Revocation is advertised in the README and in architecture.md. It was
 * half-true: it bound on one backend of two.
 *
 * Two mechanisms, matching `internal/services/security_service.go` exactly. If
 * the two implementations ever disagree, a token is revoked on one surface and
 * live on the other, which is worse than neither checking.
 *
 *  1. **Per-token.** A row keyed by the SHA-256 of the token itself. Written on
 *     logout. The token is hashed rather than stored so the table is not a
 *     collection of working credentials.
 *  2. **Revoke-all.** One row per user keyed `all:<userId>`, written on password
 *     change and admin revoke. Any token issued before the marker is dead.
 *
 * The `iat` comparison truncates the marker to whole seconds, and that is
 * load-bearing rather than sloppy: a JWT `iat` is whole seconds while the
 * marker's `createdAt` carries microseconds. Comparing them raw rejects a token
 * issued in the *same second* as the revocation — which is precisely what first
 * login does, changing the temporary password and signing in again ~200 ms
 * later. That token would be born revoked and every request would 401. The cost
 * is a sub-second window in which an older token survives; the alternative is a
 * broken first login for every member.
 */

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Thrown when the lookup itself fails, so callers can fail closed. */
export class RevocationCheckError extends Error {
  readonly name = 'RevocationCheckError';
}

export type RevocationResult =
  | { revoked: false }
  | { revoked: true; reason: 'token_revoked' | 'all_tokens_revoked' };

/** Pure, so the timestamp rule can be tested without a database. */
export function issuedBeforeRevocation(issuedAtSeconds: number, revokedAt: Date): boolean {
  const markerSeconds = Math.floor(revokedAt.getTime() / 1000);
  return issuedAtSeconds < markerSeconds;
}

export async function checkRevocation(
  token: string,
  userId: string,
  issuedAt?: number,
): Promise<RevocationResult> {
  const now = new Date();

  let exact: { id: string } | null;
  let revokeAll: { createdAt: Date } | null;
  try {
    [exact, revokeAll] = await Promise.all([
      prisma.tokenBlacklist.findFirst({
        where: { tokenHash: hashToken(token), expiresAt: { gt: now } },
        select: { id: true },
      }),
      prisma.tokenBlacklist.findFirst({
        where: { tokenHash: `all:${userId}`, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
  } catch (err) {
    throw new RevocationCheckError(
      err instanceof Error ? err.message : 'revocation lookup failed',
    );
  }

  if (exact) return { revoked: true, reason: 'token_revoked' };

  if (revokeAll && typeof issuedAt === 'number'
      && issuedBeforeRevocation(issuedAt, revokeAll.createdAt)) {
    return { revoked: true, reason: 'all_tokens_revoked' };
  }

  return { revoked: false };
}

/**
 * Verify a request and refuse a revoked token.
 *
 * Fails **closed**: if the revocation lookup itself errors, the request is
 * rejected. That is the opposite of the rate limiter's fail-open, and
 * deliberately so — letting a few extra availability checks through during a
 * database blip is cheap, and honouring a revoked admin token is not.
 */
export async function requireActiveAuth(req: Request): Promise<VerifiedToken['user']> {
  const { user, token, issuedAt } = requireAuthDetailed(req);

  let result: RevocationResult;
  try {
    result = await checkRevocation(token, user.id, issuedAt);
  } catch (err) {
    console.error('Revocation check failed; refusing the request', err);
    throw new AuthError('server_misconfigured', 'Could not verify session state');
  }

  if (result.revoked) {
    throw new AuthError('invalid_token', 'Session has been revoked');
  }
  return user;
}
