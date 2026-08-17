import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// TEST-09 / SEC-11. The Next handlers verified a token's signature and expiry
// and stopped there, so a token kept working after logout, after a password
// change and after an admin revoked the user — on every Next endpoint,
// including the one that sets loan policy.
//
// These tests pin the two mechanisms against the Go implementation they have to
// agree with (`internal/services/security_service.go`). If the two ever
// disagree, a token is dead on one surface and live on the other.

const findFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { tokenBlacklist: { findFirst: (...args: unknown[]) => findFirst(...args) } },
}));

const { checkRevocation, requireActiveAuth, issuedBeforeRevocation, RevocationCheckError } =
  await import('./auth-revocation');
const { isAuthError, authErrorStatus } = await import('./auth');

const SECRET = 'test-secret-at-least-thirty-two-characters';
const b64url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function sign(payload: Record<string, unknown>) {
  const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const s = b64url(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest());
  return `${h}.${p}.${s}`;
}
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const future = () => Math.floor(Date.now() / 1000) + 3600;

/** Answer the two queries by which key they ask for. */
function blacklist({ exact = false, revokeAllAt = null as Date | null }) {
  findFirst.mockImplementation((args: { where: { tokenHash: string } }) => {
    const key = args.where.tokenHash;
    if (typeof key === 'string' && key.startsWith('all:')) {
      return Promise.resolve(revokeAllAt ? { createdAt: revokeAllAt } : null);
    }
    return Promise.resolve(exact ? { id: 'row-1' } : null);
  });
}

let savedSecret: string | undefined;
beforeEach(() => {
  findFirst.mockReset();
  savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

describe('checkRevocation', () => {
  it('allows a token with no blacklist rows', async () => {
    blacklist({});
    expect(await checkRevocation('tok', 'user-1', future())).toEqual({ revoked: false });
  });

  it('refuses a token whose own hash is blacklisted — the logout case', async () => {
    blacklist({ exact: true });
    expect(await checkRevocation('tok', 'user-1', future())).toEqual({
      revoked: true,
      reason: 'token_revoked',
    });
  });

  it('looks the token up by SHA-256, never by the token itself', async () => {
    // The table must not be a collection of working credentials.
    blacklist({});
    await checkRevocation('the-real-token', 'user-1');
    const keys = findFirst.mock.calls.map((c) => (c[0] as any).where.tokenHash);
    expect(keys).toContain(sha256('the-real-token'));
    expect(keys).not.toContain('the-real-token');
  });

  it('refuses a token issued before a revoke-all marker — the password-change case', async () => {
    const revokedAt = new Date();
    const issuedAt = Math.floor(revokedAt.getTime() / 1000) - 60;
    blacklist({ revokeAllAt: revokedAt });
    expect(await checkRevocation('tok', 'user-1', issuedAt)).toEqual({
      revoked: true,
      reason: 'all_tokens_revoked',
    });
  });

  it('allows a token issued after a revoke-all marker', async () => {
    const revokedAt = new Date();
    const issuedAt = Math.floor(revokedAt.getTime() / 1000) + 60;
    blacklist({ revokeAllAt: revokedAt });
    expect(await checkRevocation('tok', 'user-1', issuedAt)).toEqual({ revoked: false });
  });

  it('scopes the revoke-all marker to the user it belongs to', async () => {
    blacklist({});
    await checkRevocation('tok', 'user-42');
    const keys = findFirst.mock.calls.map((c) => (c[0] as any).where.tokenHash);
    expect(keys).toContain('all:user-42');
  });

  it('throws rather than allowing when the lookup itself fails', async () => {
    // Fails closed. The rate limiter fails open because a few extra availability
    // checks are cheap; honouring a revoked admin token is not.
    findFirst.mockRejectedValue(new Error('connection terminated'));
    await expect(checkRevocation('tok', 'user-1')).rejects.toBeInstanceOf(RevocationCheckError);
  });
});

describe('issuedBeforeRevocation', () => {
  // This rule is load-bearing, and getting it wrong breaks first login for
  // every member rather than failing loudly.
  it('survives a token issued in the same second as the revocation', () => {
    // First login changes the temporary password, then signs in ~200ms later.
    // A raw comparison would reject that brand-new token.
    const revokedAt = new Date('2026-08-17T10:00:00.750Z');
    const sameSecond = Math.floor(revokedAt.getTime() / 1000);
    expect(issuedBeforeRevocation(sameSecond, revokedAt)).toBe(false);
  });

  it('rejects a token issued in any earlier second', () => {
    const revokedAt = new Date('2026-08-17T10:00:00.750Z');
    const before = Math.floor(revokedAt.getTime() / 1000) - 1;
    expect(issuedBeforeRevocation(before, revokedAt)).toBe(true);
  });

  it('allows a token issued in a later second', () => {
    const revokedAt = new Date('2026-08-17T10:00:00.750Z');
    const after = Math.floor(revokedAt.getTime() / 1000) + 1;
    expect(issuedBeforeRevocation(after, revokedAt)).toBe(false);
  });
});

describe('requireActiveAuth', () => {
  const withToken = (token: string) =>
    new Request('https://x.test/api', { headers: { authorization: `Bearer ${token}` } });

  it('returns the user for a live token', async () => {
    blacklist({});
    const user = await requireActiveAuth(withToken(sign({ sub: 'u1', role: 'ADMIN', iat: future(), exp: future() })));
    expect(user).toMatchObject({ id: 'u1', role: 'ADMIN' });
  });

  it('answers 401 for a revoked token, not 403 or 500', async () => {
    blacklist({ exact: true });
    let thrown: unknown;
    try {
      await requireActiveAuth(withToken(sign({ sub: 'u1', iat: future(), exp: future() })));
    } catch (err) {
      thrown = err;
    }
    expect(isAuthError(thrown)).toBe(true);
    expect(authErrorStatus(thrown)).toBe(401);
    expect((thrown as Error).message).toBe('Session has been revoked');
  });

  it('rejects an invalid token without ever reaching the database', async () => {
    blacklist({});
    await expect(requireActiveAuth(withToken('not-a-jwt'))).rejects.toThrow();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('refuses the request when the revocation lookup errors', async () => {
    findFirst.mockRejectedValue(new Error('db down'));
    let thrown: unknown;
    try {
      await requireActiveAuth(withToken(sign({ sub: 'u1', iat: future(), exp: future() })));
    } catch (err) {
      thrown = err;
    }
    expect(isAuthError(thrown)).toBe(true);
    expect(authErrorStatus(thrown)).toBe(500);
  });
});
