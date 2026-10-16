import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthError, requireAuthDetailed, type VerifiedToken } from '@/lib/auth';

/**
 * Token revocation for the Next route handlers (SEC-11), matching
 * internal/services/security_service.go exactly — if they disagree a token is
 * revoked on one backend and live on the other.
 *   1. Per-token: SHA-256 of the token, written on logout.
 *   2. Revoke-all: `all:<userId>`, written on password change and admin revoke;
 *      any token issued before it is dead.
 * The iat comparison truncates to whole seconds, or first login (which
 * re-signs ~200ms after revoking) would be born revoked.
 */

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** The `token_blacklist` key for a whole account. `TokenRevocationMarker` in Go. */
export function revocationMarker(userId: string): string {
  return `all:${userId}`;
}

/** How far a revoke-all marker outlives the longest token (Go: revocationMargin). */
export const REVOCATION_MARGIN_SECONDS = 3600;

/** The token lifetime both backends issue against, when nothing overrides it. */
export const DEFAULT_JWT_EXPIRY_SECONDS = 86400;

/**
 * Marker lifetime from JWT_EXPIRY_SECONDS (Go: revocationTTLFor). The variable
 * must be set on BOTH hosts, or markers expire before tokens on this half.
 */
export function revocationTtlSeconds(): number {
  const raw = Number(process.env.JWT_EXPIRY_SECONDS);
  const expiry = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_JWT_EXPIRY_SECONDS;
  return expiry + REVOCATION_MARGIN_SECONDS;
}

/**
 * End every session an account has open (WO-91), inside the caller's
 * transaction. Must match revokeAllUserTokensSQL in auth_repository.go row for
 * row. createdAt is set on update too — it is what every iat is compared to.
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
 * Verify a request and refuse a revoked token. Fails CLOSED on a lookup error,
 * unlike the rate limiter.
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
