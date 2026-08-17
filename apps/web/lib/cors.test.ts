import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { corsHeaders } from './cors';

// TEST-07. SEC-03/SEC-04 were wildcard CORS on endpoints that wrote data. The
// property that matters is not "the allow-list works" but "an origin that is
// not on the list gets no Access-Control-Allow-Origin at all" — a wildcard, or
// an echo of an unvetted origin, is the whole bug.

const saved: Record<string, string | undefined> = {};
const ENV = ['CORS_ORIGINS', 'NEXT_PUBLIC_APP_URL'];

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const withOrigin = (origin?: string) =>
  new Request('https://api.test/x', { headers: origin ? { origin } : {} });

describe('corsHeaders', () => {
  it('never answers a wildcard, whatever the origin', () => {
    process.env.CORS_ORIGINS = 'https://hasnahenafoundation.com';
    for (const origin of [undefined, 'https://evil.test', 'https://hasnahenafoundation.com', '*']) {
      const headers = corsHeaders(withOrigin(origin));
      expect(headers['Access-Control-Allow-Origin']).not.toBe('*');
    }
  });

  it('echoes an allow-listed origin and permits credentials', () => {
    process.env.CORS_ORIGINS = 'https://hasnahenafoundation.com, https://www.hasnahenafoundation.com';
    const headers = corsHeaders(withOrigin('https://www.hasnahenafoundation.com'));
    expect(headers['Access-Control-Allow-Origin']).toBe('https://www.hasnahenafoundation.com');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('omits the header entirely for an origin that is not listed', () => {
    process.env.CORS_ORIGINS = 'https://hasnahenafoundation.com';
    const headers = corsHeaders(withOrigin('https://evil.test'));
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('rejects the near-misses an attacker would actually try', () => {
    process.env.CORS_ORIGINS = 'https://hasnahenafoundation.com';
    for (const origin of [
      'https://hasnahenafoundation.com.evil.test',   // suffix
      'https://evil.test/https://hasnahenafoundation.com',
      'https://hasnahenafoundation.com:8443',        // different port
      'http://hasnahenafoundation.com',              // different scheme
      'https://sub.hasnahenafoundation.com',         // subdomain
      'https://HASNAHENAFOUNDATION.com',             // case
      'null',                                        // sandboxed iframe
      'https://hasnahenafoundation.com/',            // trailing slash
    ]) {
      expect(corsHeaders(withOrigin(origin))['Access-Control-Allow-Origin'], origin)
        .toBeUndefined();
    }
  });

  it('always sets Vary: Origin', () => {
    // Without it a cache can serve one origin's allowed response to another.
    process.env.CORS_ORIGINS = 'https://a.test';
    expect(corsHeaders(withOrigin('https://a.test')).Vary).toBe('Origin');
    expect(corsHeaders(withOrigin('https://b.test')).Vary).toBe('Origin');
    expect(corsHeaders(null).Vary).toBe('Origin');
  });

  it('handles a missing request object', () => {
    expect(corsHeaders(null)['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeaders()['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('tolerates whitespace and empty entries in the list', () => {
    process.env.CORS_ORIGINS = ' https://a.test ,, , https://b.test ';
    expect(corsHeaders(withOrigin('https://a.test'))['Access-Control-Allow-Origin']).toBe('https://a.test');
    expect(corsHeaders(withOrigin('https://b.test'))['Access-Control-Allow-Origin']).toBe('https://b.test');
    // An empty entry must not become a match-anything rule.
    expect(corsHeaders(withOrigin(''))['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('falls back to the app URL when no list is configured', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://hasnahenafoundation.com/';
    expect(corsHeaders(withOrigin('https://hasnahenafoundation.com'))['Access-Control-Allow-Origin'])
      .toBe('https://hasnahenafoundation.com');
  });

  it('falls back to localhost only when nothing at all is configured', () => {
    expect(corsHeaders(withOrigin('http://localhost:3000'))['Access-Control-Allow-Origin'])
      .toBe('http://localhost:3000');
    expect(corsHeaders(withOrigin('https://hasnahenafoundation.com'))['Access-Control-Allow-Origin'])
      .toBeUndefined();
  });

  it('does not let the app-URL fallback widen a configured list', () => {
    process.env.CORS_ORIGINS = 'https://a.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://b.test';
    expect(corsHeaders(withOrigin('https://b.test'))['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
