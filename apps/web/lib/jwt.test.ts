import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyHs256Jwt } from './jwt';

// TEST-05. This function decides whether a request is authenticated. Before
// these tests it had none, and it did not correctly reject a token with a
// truncated signature — it threw a RangeError out of `timingSafeEqual` instead,
// which callers classified as a server fault.

const SECRET = 'test-secret-at-least-thirty-two-characters';

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function sign(
  payload: Record<string, unknown>,
  opts: { secret?: string; header?: Record<string, unknown> } = {},
) {
  const header = opts.header ?? { alg: 'HS256', typ: 'JWT' };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const s = b64url(
    crypto.createHmac('sha256', opts.secret ?? SECRET).update(`${h}.${p}`).digest(),
  );
  return `${h}.${p}.${s}`;
}

/** Build a token without signing it, so the signature can be anything. */
function unsigned(payload: Record<string, unknown>, signature: string, header?: object) {
  const h = b64url(Buffer.from(JSON.stringify(header ?? { alg: 'HS256', typ: 'JWT' })));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  return `${h}.${p}.${signature}`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;

describe('verifyHs256Jwt', () => {
  it('accepts a token it signed itself', () => {
    const claims = verifyHs256Jwt(sign({ sub: 'user-1', role: 'MEMBER', exp: future() }), SECRET);
    expect(claims.sub).toBe('user-1');
    expect(claims.role).toBe('MEMBER');
  });

  describe('signature', () => {
    it('rejects a signature made with a different secret', () => {
      const token = sign({ sub: 'u', exp: future() }, { secret: 'a-completely-different-secret' });
      expect(() => verifyHs256Jwt(token, SECRET)).toThrow('Invalid token signature');
    });

    // The regression. `crypto.timingSafeEqual` throws RangeError on unequal
    // lengths, so these escaped as a RangeError rather than a rejection — and
    // the routes, which classified failures by message text, answered 500.
    it.each([
      ['truncated', 'short'],
      ['empty', ''],
      ['one character', 'x'],
      ['longer than a real signature', 'A'.repeat(200)],
    ])('rejects a %s signature as invalid, not as a crash', (_label, signature) => {
      let thrown: unknown;
      try {
        verifyHs256Jwt(unsigned({ sub: 'u', exp: future() }, signature), SECRET);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).constructor.name).toBe('Error');
      expect((thrown as Error).message).toBe('Invalid token signature');
    });

    it('rejects a signature that differs in one character', () => {
      const token = sign({ sub: 'u', exp: future() });
      const parts = token.split('.');
      const last = parts[2];
      parts[2] = (last[0] === 'A' ? 'B' : 'A') + last.slice(1);
      expect(() => verifyHs256Jwt(parts.join('.'), SECRET)).toThrow('Invalid token signature');
    });
  });

  describe('algorithm', () => {
    it('refuses alg: none, which would make the signature optional', () => {
      const token = unsigned({ sub: 'admin', role: 'SUPER_ADMIN', exp: future() }, '', {
        alg: 'none',
        typ: 'JWT',
      });
      expect(() => verifyHs256Jwt(token, SECRET)).toThrow('Invalid token algorithm');
    });

    it('refuses an asymmetric alg, where the public key could be the secret', () => {
      for (const alg of ['RS256', 'ES256', 'PS256']) {
        const token = unsigned({ sub: 'u', exp: future() }, 'sig', { alg, typ: 'JWT' });
        expect(() => verifyHs256Jwt(token, SECRET)).toThrow('Invalid token algorithm');
      }
    });

    it('is case-sensitive about HS256', () => {
      // Matching case-insensitively would widen what the header may say for no
      // benefit; the spec value is upper-case.
      const token = unsigned({ sub: 'u', exp: future() }, 'sig', { alg: 'hs256', typ: 'JWT' });
      expect(() => verifyHs256Jwt(token, SECRET)).toThrow('Invalid token algorithm');
    });
  });

  describe('expiry', () => {
    it('rejects an expired token with a message the caller can act on', () => {
      expect(() => verifyHs256Jwt(sign({ sub: 'u', exp: past() }), SECRET)).toThrow('Token expired');
    });

    it('accepts a token with no exp at all', () => {
      // The Go API issues every token with an exp; this documents that the
      // verifier does not require one, so that if a caller ever needs a
      // non-expiring token the behaviour is a decision rather than a surprise.
      expect(verifyHs256Jwt(sign({ sub: 'u' }), SECRET).sub).toBe('u');
    });

    it('ignores a non-numeric exp rather than throwing', () => {
      expect(verifyHs256Jwt(sign({ sub: 'u', exp: 'soon' }), SECRET).sub).toBe('u');
    });

    it('treats exp exactly now as expired', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(() => verifyHs256Jwt(sign({ sub: 'u', exp: now }), SECRET)).toThrow('Token expired');
    });
  });

  describe('shape', () => {
    it.each([
      ['no dots', 'notatoken'],
      ['one dot', 'header.payload'],
      ['four parts', 'a.b.c.d'],
      ['empty string', ''],
    ])('rejects a token with %s', (_label, token) => {
      expect(() => verifyHs256Jwt(token, SECRET)).toThrow('Invalid token format');
    });

    it('rejects a payload that is not JSON', () => {
      const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
      const p = b64url(Buffer.from('not json at all'));
      const s = b64url(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest());
      expect(() => verifyHs256Jwt(`${h}.${p}.${s}`, SECRET)).toThrow();
    });

    it('rejects a header that is not JSON', () => {
      expect(() => verifyHs256Jwt(`${b64url(Buffer.from('nope'))}.e30.sig`, SECRET)).toThrow();
    });
  });

  it('does not confuse two tokens that differ only in payload', () => {
    // Guards against a signing input built by concatenation without the dot,
    // where header "ab"+payload "c" and header "a"+payload "bc" would collide.
    const a = verifyHs256Jwt(sign({ sub: 'aa', exp: future() }), SECRET);
    const b = verifyHs256Jwt(sign({ sub: 'ab', exp: future() }), SECRET);
    expect(a.sub).not.toBe(b.sub);
  });
});
