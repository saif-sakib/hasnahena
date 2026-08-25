import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
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

/** The `token_blacklist` key for a whole account. `TokenRevocationMarker` in Go. */
export function revocationMarker(userId: string): string {
  return `all:${userId}`;
}

/**
 * How far a revoke-all marker must outlive the longest token it can revoke.
 * `revocationMargin` in `apps/api/internal/services/auth_service.go`.
 */
export const REVOCATION_MARGIN_SECONDS = 3600;

/** The token lifetime both backends issue against, when nothing overrides it. */
export const DEFAULT_JWT_EXPIRY_SECONDS = 86400;

/**
 * The marker's lifetime, derived from the token lifetime so the two cannot be
 * configured apart — `revocationTTLFor` in Go, and it must stay equal to it.
 *
 * `JWT_EXPIRY_SECONDS` is set on Render, where tokens are minted. It is read
 * here too, defaulting to the same 86400, because a marker that expires before
 * the tokens it revokes brings those tokens back to life. Raising it on Render
 * alone would do exactly that on this half — which is why `setup.md` now lists
 * the variable against both hosts.
 */
export function revocationTtlSeconds(): number {
  const raw = Number(process.env.JWT_EXPIRY_SECONDS);
  const expiry = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_JWT_EXPIRY_SECONDS;
  return expiry + REVOCATION_MARGIN_SECONDS;
}

/**
 * End every session an account has open — WO-91.
 *
 * Takes the transaction client so it runs in the *same* transaction as whatever
 * made the sessions invalid. Dismissing a worker and revoking their token are
 * one fact; two statements with a crash in between leave a dismissed worker
 * holding a staff token that can post deposits and process withdrawals.
 *
 * The row is written to match `revokeAllUserTokensSQL` in
 * `apps/api/internal/repositories/auth_repository.go` exactly — the same key,
 * the same upsert-on-conflict, the same derived lifetime. If the two ever
 * disagree, a token is revoked on one backend and live on the other, which is
 * worse than neither checking (the reason at the top of this file).
 *
 * `createdAt` is set explicitly on the update branch and that is load-bearing:
 * it is the timestamp every `iat` is compared against, so a repeat revocation
 * that left it alone would revoke nothing issued since the first one.
 */
export async function revokeAllTokens(
  tx: Prisma.TransactionClient,
  userId: string,
  reason: 'admin_revoke' | 'password_change' | 'logout',
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + revocationTtlSeconds() * 1000);
  await tx.tokenBlacklist.upsert({
    where: { tokenHash: revocationMarker(userId) },
    update: { reason, expiresAt, createdAt: now },
    create: { tokenHash: revocationMarker(userId), userId, reason, expiresAt, createdAt: now },
  });
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
        where: { tokenHash: revocationMarker(userId), expiresAt: { gt: now } },
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
