import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const { callerAddress } = await import('./rate-limit');

// TEST-07. `callerAddress` is the key the rate limiter counts against. If a
// caller can choose it, they get a fresh bucket per request and the limiter is
// decorative — which matters here because the endpoint it guards is the
// membership-enumeration oracle SEC-08 was opened for.

const req = (headers: Record<string, string>) =>
  new Request('https://example.test/api/v1/registrations', { headers });

describe('callerAddress', () => {
  it('prefers x-real-ip, which is single-valued and cannot be turned into a list', () => {
    expect(callerAddress(req({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('ignores x-forwarded-for entirely when x-real-ip is present', () => {
    const address = callerAddress(
      req({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }),
    );
    expect(address).toBe('203.0.113.9');
  });

  it('takes the RIGHTMOST x-forwarded-for entry, not the leftmost', () => {
    // The rightmost entry is the one the nearest trusted proxy appended.
    // Everything to its left is whatever the caller claimed, so keying on the
    // leftmost — which is the common mistake, and what chi's RealIP does — lets
    // one caller mint unlimited buckets by varying a header they control.
    expect(callerAddress(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('cannot be given a fresh bucket by prepending forged entries', () => {
    const real = '203.0.113.9';
    const forged = ['a', 'b', 'c', 'd'].map(
      (n) => callerAddress(req({ 'x-forwarded-for': `${n}, ${real}` })),
    );
    // Every attempt keys to the same bucket, so they share one limit.
    expect(new Set(forged)).toEqual(new Set([real]));
  });

  it('trims whitespace and skips empty entries', () => {
    expect(callerAddress(req({ 'x-forwarded-for': '1.1.1.1 ,  203.0.113.9  ' }))).toBe('203.0.113.9');
    expect(callerAddress(req({ 'x-real-ip': '  203.0.113.9  ' }))).toBe('203.0.113.9');
  });

  it('falls back to one shared bucket rather than skipping the limit', () => {
    // "unknown" is deliberate: with no proxy headers every caller shares a
    // bucket, which is restrictive. Returning a unique value per request would
    // silently disable the limiter for anyone who can strip the headers.
    expect(callerAddress(req({}))).toBe('unknown');
  });

  it('falls back when the forwarding headers are present but empty', () => {
    expect(callerAddress(req({ 'x-forwarded-for': '' }))).toBe('unknown');
    expect(callerAddress(req({ 'x-forwarded-for': ' , , ' }))).toBe('unknown');
    expect(callerAddress(req({ 'x-real-ip': '   ' }))).toBe('unknown');
  });

  it('reads the header names case-insensitively', () => {
    expect(callerAddress(req({ 'X-Real-IP': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(callerAddress(req({ 'X-Forwarded-For': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('handles IPv6, which contains the colons a naive split would break on', () => {
    expect(callerAddress(req({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(callerAddress(req({ 'x-forwarded-for': '1.1.1.1, 2001:db8::1' }))).toBe('2001:db8::1');
  });
});
