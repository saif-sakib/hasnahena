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
 * WO-91: token_blacklist is written by both backends (Go on password
 * change/reset, Next on worker deactivation) — the row must match exactly, or a
 * token is dead on one backend and live on the other. Read off disk.
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
    // The defaults must match: the Next half usually runs on the default.
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
    // Upsert: an INSERT would violate the unique key and roll back the deactivation.
    expect(authRepository).toMatch(/ON CONFLICT \("tokenHash"\) DO UPDATE SET/);
    const nextSource = readFileSync(
      fileURLToPath(new URL('../../lib/auth-revocation.ts', import.meta.url)),
      'utf8',
    );
    expect(nextSource).toMatch(/tokenBlacklist\.upsert\(/);
    // And move createdAt — what every iat is compared to.
    expect(authRepository).toMatch(/"createdAt" = EXCLUDED\."createdAt"/);
    expect(nextSource).toMatch(/update: \{ reason, expiresAt, createdAt: now \}/);
  });
});

describe('every path that ends a staff session writes the marker', () => {
  const workersRoute = readFileSync(
    fileURLToPath(new URL('../../app/api/v1/admin/workers/route.ts', import.meta.url)),
    'utf8',
  );

  /** A census: every branch that deactivates or deletes a worker revokes. */
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
    // Inside the caller's transaction, never on the bare client.
    expect(workersRoute).not.toMatch(/revokeAllTokens\(prisma[,)]/);
    expect(workersRoute).toMatch(/prisma\.\$transaction\(async \(tx\)/);
  });
});
