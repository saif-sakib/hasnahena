import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_JWT_EXPIRY_SECONDS,
  REVOCATION_MARGIN_SECONDS,
  revocationMarker,
  revocationTtlSeconds,
} from '@/lib/auth-revocation';

/**
 * WO-91. `token_blacklist` is now **written** in two languages as well as read
 * in two languages.
 *
 * The Go API writes the revoke-all marker when a password changes or resets;
 * the Next admin route writes it when a worker is deactivated, archived or
 * deleted. Both backends check it on every authenticated request. So the row has
 * to be the same row: the same key, and a lifetime that outlives the same
 * tokens.
 *
 * A mismatch is invisible in either file — each looks correct alone. It surfaces
 * as a dismissed worker whose staff token is refused by one backend and honoured
 * by the other, which is worse than neither checking, because it looks like it
 * works.
 *
 * Read off disk, no database, no network.
 */

const goPath = (relative: string) =>
  fileURLToPath(new URL(`../../../api/internal/${relative}`, import.meta.url));

const authService = readFileSync(goPath('services/auth_service.go'), 'utf8');
const authRepository = readFileSync(goPath('repositories/auth_repository.go'), 'utf8');
const config = readFileSync(goPath('config/config.go'), 'utf8');

describe('the revoke-all marker is the same row on both backends', () => {
  it('is keyed the same way', () => {
    // The Go half is `return "all:" + userID`.
    const prefix = authRepository.match(
      /TokenRevocationMarker\(userID string\) string \{\s*return "([^"]+)" \+ userID/,
    );
    if (!prefix) throw new Error('TokenRevocationMarker is no longer a shape this test can read');
    expect(revocationMarker('user_42')).toBe(`${prefix[1]}user_42`);
  });

  it('outlives the token lifetime by the same margin', () => {
    // `const revocationMargin = time.Hour`
    const margin = authService.match(/revocationMargin\s*=\s*time\.(\w+)/);
    if (!margin) throw new Error('revocationMargin is no longer a shape this test can read');
    const goMarginSeconds = { Second: 1, Minute: 60, Hour: 3600 }[margin[1]];
    expect(goMarginSeconds, `unhandled time unit ${margin[1]}`).toBeDefined();
    expect(REVOCATION_MARGIN_SECONDS).toBe(goMarginSeconds);
  });

  it('defaults to the token lifetime the Go config defaults to', () => {
    // Only Render mints tokens, so only Render has to have JWT_EXPIRY_SECONDS
    // set — which means the Next half runs on the default far more often than
    // the Go half does. If the two defaults ever part, the marker on this side
    // is the wrong length on every deployment that never set the variable.
    const fallback = config.match(/getEnvInt64\("JWT_EXPIRY_SECONDS",\s*(\d+)\)/);
    if (!fallback) throw new Error('JWT_EXPIRY_SECONDS is no longer read the way this test expects');
    expect(DEFAULT_JWT_EXPIRY_SECONDS).toBe(Number(fallback[1]));
  });

  it('never returns a lifetime shorter than the tokens it revokes', () => {
    const original = process.env.JWT_EXPIRY_SECONDS;
    try {
      for (const value of ['3600', '604800', '86400']) {
        process.env.JWT_EXPIRY_SECONDS = value;
        expect(revocationTtlSeconds()).toBeGreaterThan(Number(value));
      }
      // A marker shorter than the token brings revoked tokens back to life when
      // it expires, so nonsense falls back to the default rather than to zero.
      for (const bad of ['', 'not-a-number', '-1', '0']) {
        process.env.JWT_EXPIRY_SECONDS = bad;
        expect(revocationTtlSeconds()).toBe(DEFAULT_JWT_EXPIRY_SECONDS + REVOCATION_MARGIN_SECONDS);
      }
    } finally {
      if (original === undefined) delete process.env.JWT_EXPIRY_SECONDS;
      else process.env.JWT_EXPIRY_SECONDS = original;
    }
  });

  it('is upserted, not inserted, on both sides', () => {
    // `tokenHash` is unique, so a second revocation for the same account has to
    // move the existing marker forward. An INSERT would raise a constraint
    // violation and — in the Next half, inside the transaction that deactivates
    // the worker — roll the deactivation back.
    expect(authRepository).toMatch(/ON CONFLICT \("tokenHash"\) DO UPDATE SET/);
    const nextSource = readFileSync(
      fileURLToPath(new URL('../../lib/auth-revocation.ts', import.meta.url)),
      'utf8',
    );
    expect(nextSource).toMatch(/tokenBlacklist\.upsert\(/);
    // And it must move `createdAt`, because that is the timestamp every `iat` is
    // compared against — a repeat revocation that left it alone would revoke
    // nothing issued since the first one.
    expect(authRepository).toMatch(/"createdAt" = EXCLUDED\."createdAt"/);
    expect(nextSource).toMatch(/update: \{ reason, expiresAt, createdAt: now \}/);
  });
});

describe('every path that ends a staff session writes the marker', () => {
  const workersRoute = readFileSync(
    fileURLToPath(new URL('../../app/api/v1/admin/workers/route.ts', import.meta.url)),
    'utf8',
  );

  /**
   * A census, not a list. The three branches that end a worker's access today
   * are PATCH → INACTIVE, DELETE → archive and DELETE → hard delete, and all
   * three used to stop one step short of revoking. The point of counting rather
   * than naming them is that a fourth branch added tomorrow fails here.
   */
  it('has a revocation call for every branch that deactivates or deletes', () => {
    const revocations = workersRoute.match(/revokeAllTokens\(tx, id, 'admin_revoke'\)/g) ?? [];
    const endings =
      (workersRoute.match(/UserStatus\.INACTIVE/g) ?? []).length +
      (workersRoute.match(/tx\.user\.delete\(/g) ?? []).length;

    expect(
      revocations.length,
      'A branch that deactivates or deletes a worker without writing the ' +
        'revocation marker leaves them holding a working staff token until it ' +
        'expires — up to a day of posting deposits and processing withdrawals ' +
        'after being dismissed. `status` is read at login and nowhere else.',
    ).toBe(endings);
  });

  it('writes it inside the transaction, not beside it', () => {
    // Two statements with a crash in between is the same defect on a smaller
    // scale: the worker is deactivated and their token is not revoked, or the
    // reverse, and nothing anywhere says which.
    expect(workersRoute).not.toMatch(/revokeAllTokens\(prisma[,)]/);
    expect(workersRoute).toMatch(/prisma\.\$transaction\(async \(tx\)/);
  });
});
