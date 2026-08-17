import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { readJsonBody, routeErrorStatus, routeErrorMessage, BadRequestError } from './route-errors';
import { AuthError } from './auth';

// TEST-18. Every Next route used to end `catch { return 500 }`, so a truncated
// body from a phone that lost signal mid-POST and an expired session both came
// back as "the server is broken". These tests pin the classification that fixed
// it — in the fast suite, because it is pure logic and the route tests that
// depend on it need a database.

const request = (body: string) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

describe('readJsonBody', () => {
  it('parses a JSON object', async () => {
    await expect(readJsonBody(request('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it('rejects an empty body rather than defaulting it to {}', async () => {
    // Defaulting it meant `PUT /api/v1/settings` accepted a body-less request,
    // saved nothing, and answered 200 — a success report for work never done.
    await expect(readJsonBody(request(''))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects whitespace-only', async () => {
    await expect(readJsonBody(request('   \n  '))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects malformed JSON as a client error, not a SyntaxError', async () => {
    const err = await readJsonBody(request('{"amount": 100')).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(routeErrorStatus(err)).toBe(400);
  });

  it('rejects JSON null', async () => {
    // `body.imageUrl` on null threw a TypeError and produced a 500 in
    // POST /api/v1/gallery.
    await expect(readJsonBody(request('null'))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects a bare array', async () => {
    await expect(readJsonBody(request('[1,2,3]'))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects a bare string', async () => {
    await expect(readJsonBody(request('"amount"'))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects a bare number', async () => {
    await expect(readJsonBody(request('42'))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects trailing garbage after a valid object', async () => {
    await expect(readJsonBody(request('{"a":1} DROP TABLE users'))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('keeps the last value for a duplicate key, as JSON.parse does', async () => {
    // Not a defect, but worth pinning: a proxy that reads the *first* value
    // while the app reads the last is how a request-smuggling bug starts.
    await expect(readJsonBody(request('{"amount":1,"amount":2}'))).resolves.toEqual({ amount: 2 });
  });

  it('does not let __proto__ in a body pollute Object.prototype', async () => {
    const parsed = await readJsonBody(request('{"__proto__":{"role":"SUPER_ADMIN"},"a":1}'));
    expect((parsed as Record<string, unknown>).a).toBe(1);
    expect(({} as Record<string, unknown>).role).toBeUndefined();
  });
});

describe('routeErrorStatus', () => {
  it('maps an expired session to 401, not 500', () => {
    expect(routeErrorStatus(new AuthError('expired_token', 'Token expired'))).toBe(401);
  });

  it('keeps a misconfigured server at 500', () => {
    expect(routeErrorStatus(new AuthError('server_misconfigured', 'Server missing JWT_SECRET'))).toBe(500);
  });

  it('maps a Zod failure to 400', () => {
    const err = z.object({ a: z.number() }).safeParse({ a: 'x' });
    expect(err.success).toBe(false);
    if (!err.success) expect(routeErrorStatus(err.error)).toBe(400);
  });

  it('maps a malformed body to 400', () => {
    expect(routeErrorStatus(new BadRequestError('Malformed JSON body'))).toBe(400);
  });

  it('maps Prisma P2025 (record not found) to 404', () => {
    // Deleting a gallery item that is not there used to be a 500.
    expect(routeErrorStatus(Object.assign(new Error('not found'), { code: 'P2025' }))).toBe(404);
  });

  it('maps Prisma P2002 (unique violation) to 409', () => {
    expect(routeErrorStatus(Object.assign(new Error('duplicate'), { code: 'P2002' }))).toBe(409);
  });

  it('maps Prisma P2003 (foreign key) to 409', () => {
    expect(routeErrorStatus(Object.assign(new Error('fk'), { code: 'P2003' }))).toBe(409);
  });

  it('leaves an unrecognised Prisma code alone, so it stays a 500', () => {
    expect(routeErrorStatus(Object.assign(new Error('boom'), { code: 'P1001' }))).toBeNull();
  });

  it('returns null for a genuine server fault', () => {
    expect(routeErrorStatus(new TypeError('cannot read properties of undefined'))).toBeNull();
  });

  it('prefers the auth status when an error is both', () => {
    // Ordering matters: a caller who may not be here should not be told which
    // fields the endpoint wants.
    const err = new AuthError('invalid_token', 'Invalid token signature');
    expect(routeErrorStatus(Object.assign(err, { code: 'P2025' }))).toBe(401);
  });
});

describe('routeErrorMessage', () => {
  it('never echoes a server error back to the caller', () => {
    const leaky = new Error('relation "users" does not exist at character 42');
    expect(routeErrorMessage(leaky, 'Failed to create staff account')).toBe('Failed to create staff account');
  });

  it('says Unauthorized for a 401, whatever the internal wording was', () => {
    expect(routeErrorMessage(new AuthError('expired_token', 'Token expired'), 'x')).toBe('Unauthorized');
  });

  it('passes a client-error message through, since it is actionable', () => {
    expect(routeErrorMessage(new BadRequestError('Request body is required'), 'x'))
      .toBe('Request body is required');
  });

  it('says Validation failed for Zod rather than dumping the issue list', () => {
    const parsed = z.object({ a: z.number() }).safeParse({});
    if (!parsed.success) expect(routeErrorMessage(parsed.error, 'x')).toBe('Validation failed');
  });
});
