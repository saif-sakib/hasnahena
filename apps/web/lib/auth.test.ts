import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { requireAuth, authErrorStatus, isAuthError, AuthError } from './auth';

// TEST-06. The defect this pins: route handlers decided the HTTP status by
// searching the error message for the word "authorization". Only two of the
// eight failures this module produces contain it, so six — **including an
// expired token** — answered 500. A member whose session ran out was told the
// server had failed, so the client never knew to send them to log in.
//
// The rule these tests encode: anything the caller could fix is 401; only a
// server misconfiguration is 500. Nothing depends on message text.

const SECRET = 'test-secret-at-least-thirty-two-characters';

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function sign(payload: Record<string, unknown>, secret = SECRET, header?: object) {
  const h = b64url(Buffer.from(JSON.stringify(header ?? { alg: 'HS256', typ: 'JWT' })));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const s = b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${s}`;
}

const req = (headers: Record<string, string> = {}) =>
  new Request('https://example.test/api/v1/thing', { headers });

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;

let original: string | undefined;
beforeEach(() => {
  original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
});
afterEach(() => {
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
});

describe('requireAuth', () => {
  it('returns the claims for a valid token', () => {
    const token = sign({ sub: 'user-1', role: 'ADMIN', email: 'a@b.test', exp: future() });
    expect(requireAuth(req({ authorization: `Bearer ${token}` }))).toEqual({
      id: 'user-1',
      role: 'ADMIN',
      email: 'a@b.test',
      phone: undefined,
    });
  });

  it('reads the header case-insensitively, both name and scheme', () => {
    const token = sign({ sub: 'u', exp: future() });
    expect(requireAuth(req({ Authorization: `bearer ${token}` })).id).toBe('u');
    expect(requireAuth(req({ authorization: `BEARER ${token}` })).id).toBe('u');
  });

  it('defaults a missing role to the empty string rather than undefined', () => {
    // A route comparing `role !== 'ADMIN'` must not be handed undefined and
    // accidentally pass a loose check somewhere downstream.
    expect(requireAuth(req({ authorization: `Bearer ${sign({ sub: 'u', exp: future() })}` })).role)
      .toBe('');
  });

  describe('every failure carries its own status', () => {
    const cases: Array<{ name: string; headers: Record<string, string>; status: 401 | 500; failure: string }> = [
      { name: 'no Authorization header', headers: {}, status: 401, failure: 'missing_header' },
      { name: 'wrong scheme', headers: { authorization: 'Basic abc' }, status: 401, failure: 'malformed_header' },
      { name: 'bare token, no scheme', headers: { authorization: 'abc.def.ghi' }, status: 401, failure: 'malformed_header' },
      { name: 'Bearer with nothing after it', headers: { authorization: 'Bearer   ' }, status: 401, failure: 'malformed_header' },
      { name: 'malformed token', headers: { authorization: 'Bearer not-a-jwt' }, status: 401, failure: 'invalid_token' },
      { name: 'bad signature', headers: { authorization: `Bearer ${sign({ sub: 'u', exp: future() }, 'another-secret-entirely')}` }, status: 401, failure: 'invalid_token' },
      { name: 'truncated signature', headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.x' }, status: 401, failure: 'invalid_token' },
      { name: 'alg none', headers: { authorization: `Bearer ${sign({ sub: 'u', exp: future() }, SECRET, { alg: 'none' })}` }, status: 401, failure: 'invalid_token' },
      { name: 'expired token', headers: { authorization: `Bearer ${sign({ sub: 'u', exp: past() })}` }, status: 401, failure: 'expired_token' },
      { name: 'no sub claim', headers: { authorization: `Bearer ${sign({ role: 'ADMIN', exp: future() })}` }, status: 401, failure: 'invalid_claims' },
    ];

    it.each(cases)('$name → $status', ({ headers, status, failure }) => {
      let thrown: unknown;
      try {
        requireAuth(req(headers));
      } catch (err) {
        thrown = err;
      }
      expect(isAuthError(thrown)).toBe(true);
      expect((thrown as AuthError).failure).toBe(failure);
      expect(authErrorStatus(thrown)).toBe(status);
    });

    // The one case that genuinely is the server's fault.
    it('a missing JWT_SECRET is the only 500', () => {
      delete process.env.JWT_SECRET;
      let thrown: unknown;
      try {
        requireAuth(req({ authorization: `Bearer ${sign({ sub: 'u', exp: future() })}` }));
      } catch (err) {
        thrown = err;
      }
      expect((thrown as AuthError).failure).toBe('server_misconfigured');
      expect(authErrorStatus(thrown)).toBe(500);
    });

    it('an expired token is never reported as a server error', () => {
      // Stated separately because this is the case members actually hit, and
      // the one that used to answer 500. If this ever regresses, sessions stop
      // recovering and the symptom looks like a backend outage.
      try {
        requireAuth(req({ authorization: `Bearer ${sign({ sub: 'u', exp: past() })}` }));
        throw new Error('should have thrown');
      } catch (err) {
        expect(authErrorStatus(err)).toBe(401);
      }
    });
  });

  it('never leaks the secret or the token in the error message', () => {
    const token = sign({ sub: 'u', exp: future() }, 'a-different-secret');
    try {
      requireAuth(req({ authorization: `Bearer ${token}` }));
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(token);
    }
  });
});

describe('authErrorStatus', () => {
  it('returns null for anything that is not an auth failure', () => {
    // A route falls through to its own handling on null. Returning a status for
    // an unrelated error would turn a genuine 500 into a silent 401.
    expect(authErrorStatus(new Error('database is on fire'))).toBeNull();
    expect(authErrorStatus(new TypeError('undefined is not a function'))).toBeNull();
    expect(authErrorStatus('a string')).toBeNull();
    expect(authErrorStatus(null)).toBeNull();
    expect(authErrorStatus(undefined)).toBeNull();
  });

  it('does not classify by message text', () => {
    // The old implementation would have called this 401 because of one word.
    expect(authErrorStatus(new Error('failed to write authorization audit row'))).toBeNull();
  });
});
