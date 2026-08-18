// WO-64 — the support proxy forwards only what it is meant to forward.
//
// Next percent-decodes catch-all segments before a handler sees them and
// `fetch` normalises `..` away before the request leaves the process, so the
// old `parts.join('/')` reached any path on the API base. Nothing here proves
// that was exploitable — the Go API authorises every route itself — but the
// proxy is the wrong place to be relying on that.
//
//   scripts/test-stack.sh up && eval "$(scripts/test-stack.sh env)"
//   pnpm --filter @hasnahena/web test:routes

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { hasTestDatabase, testPrisma, disconnectTestPrisma } from '../route-harness';
import * as supportProxy from '@/app/api/v1/dashboard/support/[...path]/route';

const skip = !hasTestDatabase();

const API_BASE = 'http://api.test.invalid:9999';

/** What the stub saw, per call. */
type Seen = { url: string; init: RequestInit };

let seen: Seen[] = [];
let fetchStub: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

function request(
  segments: string[],
  init: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
) {
  const method = init.method ?? 'GET';
  const url = `http://localhost/api/v1/dashboard/support/${segments.join('/')}`;
  const req = new NextRequest(url, {
    method,
    body: method === 'GET' || method === 'HEAD' ? undefined : (init.body ?? '{}'),
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...(init.signal ? { signal: init.signal } : {}),
  });
  return { req, context: { params: Promise.resolve({ path: segments }) } };
}

function call(
  method: 'GET' | 'POST' | 'PUT',
  segments: string[],
  init: Parameters<typeof request>[1] = {},
) {
  const { req, context } = request(segments, { ...init, method });
  return supportProxy[method](req, context);
}

describe.skipIf(skip)('support proxy', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_API_URL = API_BASE;
  });

  beforeEach(async () => {
    seen = [];
    fetchStub = vi.fn(async (input: unknown, init: RequestInit = {}) => {
      seen.push({ url: String(input), init });
      return new Response('{"success":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    // Each test starts with a fresh quota; the limiter key is shared by design.
    await testPrisma().rateLimit.deleteMany({ where: { id: { startsWith: 'support:' } } });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  describe('the allow-list', () => {
    it('forwards a route the Go API actually mounts', async () => {
      const res = await call('GET', ['threads']);
      expect(res.status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe(`${API_BASE}/v1/dashboard/support/threads`);
    });

    it('forwards a two-segment route', async () => {
      const res = await call('POST', ['threads', 'processed']);
      expect(res.status).toBe(200);
      expect(seen[0].url).toBe(`${API_BASE}/v1/dashboard/support/threads/processed`);
    });

    it('keeps the query string', async () => {
      const { req, context } = request(['messages'], {});
      const withQuery = new NextRequest(
        'http://localhost/api/v1/dashboard/support/messages?threadId=abc',
        { method: 'GET', headers: req.headers },
      );
      const res = await supportProxy.GET(withQuery, context);
      expect(res.status).toBe(200);
      expect(seen[0].url).toBe(`${API_BASE}/v1/dashboard/support/messages?threadId=abc`);
    });

    // The defect. Next hands these over already decoded, which is why checking
    // for '%2e' would have caught nothing.
    it.each([
      [['..', '..', 'v1', 'admin', 'members']],
      [['..', 'admin']],
      [['../../admin/members']],
      [['.']],
    ])('404s a traversal: %j', async (segments) => {
      const res = await call('GET', segments as string[]);
      expect(res.status).toBe(404);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('404s a path that is not part of the support surface', async () => {
      const res = await call('GET', ['whatever']);
      expect(res.status).toBe(404);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('404s an empty path', async () => {
      const res = await call('GET', []);
      expect(res.status).toBe(404);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    // The method matters as much as the path: `threads` is a read upstream, and
    // a proxy that forwards a PUT to it is inventing a route.
    it('404s a known path with a method the Go API does not mount there', async () => {
      const res = await call('PUT', ['threads']);
      expect(res.status).toBe(404);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('404s a key inherited from Object.prototype', async () => {
      const res = await call('GET', ['constructor']);
      expect(res.status).toBe(404);
      expect(fetchStub).not.toHaveBeenCalled();
    });
  });

  describe('the member disconnecting', () => {
    it('passes the request signal upstream', async () => {
      await call('GET', ['stream']);
      expect(seen[0].init.signal).toBeDefined();
    });

    it('answers rather than throwing when the member has gone', async () => {
      const controller = new AbortController();
      fetchStub.mockImplementation(async (_input: unknown, init: RequestInit = {}) => {
        const signal = init.signal as AbortSignal | undefined;
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        throw new Error('expected the test to abort first');
      });
      controller.abort();

      const res = await call('GET', ['stream'], { signal: controller.signal });
      expect(res.status).toBe(499);
    });

    it('answers 502, not an unhandled throw, when the Go API is unreachable', async () => {
      fetchStub.mockImplementation(async () => {
        throw new Error('ECONNREFUSED');
      });
      const res = await call('GET', ['threads']);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ success: false });
    });
  });

  describe('per-member rate limiting', () => {
    // The Go limiter sees Vercel's address for everything that arrives through
    // this proxy, so without a limit on this side one member's burst is spent
    // out of a bucket the whole membership shares.
    it('stops a single caller from spending the shared upstream quota', async () => {
      const headers = { 'x-real-ip': '203.0.113.7' };
      let blocked = 0;
      for (let i = 0; i < 70; i++) {
        const res = await call('POST', ['messages'], { headers });
        if (res.status === 429) blocked++;
      }
      expect(blocked).toBeGreaterThan(0);
      expect(fetchStub.mock.calls.length).toBeLessThan(70);
    });

    it('does not count reads', async () => {
      const headers = { 'x-real-ip': '203.0.113.8' };
      for (let i = 0; i < 70; i++) {
        const res = await call('GET', ['threads'], { headers });
        expect(res.status).toBe(200);
      }
      expect(fetchStub).toHaveBeenCalledTimes(70);
    });

    it('keys on the caller, so one member cannot block another', async () => {
      for (let i = 0; i < 65; i++) {
        await call('POST', ['messages'], { headers: { 'x-real-ip': '203.0.113.9' } });
      }
      const other = await call('POST', ['messages'], { headers: { 'x-real-ip': '203.0.113.10' } });
      expect(other.status).toBe(200);
    });
  });

  // The proxy must not add an X-Forwarded-For entry. The Go API reads that
  // header from the trusted end using TRUSTED_PROXIES, one global number; an
  // entry added here lands at an index it does not read, and raising the number
  // to compensate would make it believe a spoofed entry on the traffic that
  // reaches it directly. ADR-021 has the full reasoning.
  it('does not forward a caller-supplied X-Forwarded-For', async () => {
    await call('POST', ['messages'], { headers: { 'x-forwarded-for': '9.9.9.9' } });
    const headers = new Headers((seen[0].init.headers ?? {}) as HeadersInit);
    expect(headers.get('x-forwarded-for')).toBeNull();
  });
});
