// TEST-03 — the harness Phase 3 needs to drive the Next route handlers.
//
// A route handler in the App Router is just an exported async function taking a
// `Request`. Nothing about it requires a browser, a server, or Next itself —
// only a token that verifies and a database the Prisma client can reach. That
// is what this file supplies, so a route test reads:
//
//   const res = await POST(jsonRequest('/api/v1/loans/applications', { … }, { as: 'MEMBER' }));
//   expect(res.status).toBe(401);
//
// Deliberately not built during Phase 0: the auth work needed the `lib/`
// modules directly and a harness with no caller is scaffolding. It arrives with
// its first user, which is TEST-16 next door.

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

export const TEST_JWT_SECRET = 'test-secret-at-least-thirty-two-characters';

/** The four roles a caller can present. */
export type TestRole = 'MEMBER' | 'WORKER' | 'ADMIN' | 'SUPER_ADMIN';

const b64url = (input: Buffer | string) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Mint a token the same way the Go login endpoint does: HS256 over
 * `{sub, role, iat, exp}` with the shared secret.
 *
 * Minting rather than logging in is the point. A test that has to log in first
 * cannot easily produce the interesting tokens — expired, forged, for a deleted
 * user — and those are most of what an authorization test is about.
 */
export function mintToken(opts: {
  sub: string;
  role?: string;
  expiresInSeconds?: number;
  issuedAtSeconds?: number;
  secret?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: opts.sub,
      role: opts.role,
      iat: opts.issuedAtSeconds ?? now,
      exp: now + (opts.expiresInSeconds ?? 3600),
    }),
  );
  const signature = b64url(
    crypto
      .createHmac('sha256', opts.secret ?? process.env.JWT_SECRET ?? TEST_JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest(),
  );
  return `${header}.${payload}.${signature}`;
}

type RequestOptions = {
  /** Token to send. Omit for an anonymous request. */
  token?: string;
  method?: string;
  headers?: Record<string, string>;
  /** Sent as a JSON body. Use `raw` for anything that is not valid JSON. */
  body?: unknown;
  raw?: string;
};

/**
 * Build a `Request` the way Next would hand one to a route handler.
 *
 * The absolute origin matters: handlers call `new URL(req.url)` to read query
 * parameters, and that throws on a relative URL — which surfaces as a 500 and
 * looks like a handler bug rather than a test one.
 */
export function routeRequest(path: string, options: RequestOptions = {}): Request {
  const { token, method = 'GET', headers = {}, body, raw } = options;

  const init: RequestInit = {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
  };
  if (raw !== undefined) {
    init.body = raw;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return new Request(`http://localhost:3000${path}`, init);
}

/**
 * Read a handler's response without caring whether it answered JSON.
 * An unhandled throw inside a route often produces an HTML error page, and
 * `await res.json()` on that fails with a parse error that hides the status.
 */
export async function readBody(res: Response): Promise<{ status: number; text: string; json: unknown }> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // left null on purpose — the caller asserts on `status` and `text`
  }
  return { status: res.status, text, json };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let prisma: PrismaClient | null = null;

/** The shared client. Null when no database is configured. */
export function testPrisma(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

export function hasTestDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL);
}

const ROLE_IDS: Record<TestRole, string> = {
  MEMBER: 'nextroute-member',
  WORKER: 'nextroute-worker',
  ADMIN: 'nextroute-admin',
  SUPER_ADMIN: 'nextroute-superadmin',
};

const ROLE_PHONES: Record<TestRole, string> = {
  MEMBER: '01955500001',
  WORKER: '01955500002',
  ADMIN: '01955500003',
  SUPER_ADMIN: '01955500004',
};

/**
 * Create (once) an ACTIVE user of each role, plus an account for the member.
 *
 * Upserted rather than truncated: this suite shares a database with the Go
 * integration tests, and a test that clears tables out from under a
 * neighbouring suite is a test that fails depending on execution order.
 */
export async function seedRoleUsers(): Promise<Record<TestRole, string>> {
  const db = testPrisma();
  for (const role of Object.keys(ROLE_IDS) as TestRole[]) {
    const id = ROLE_IDS[role];
    await db.user.upsert({
      where: { id },
      update: { status: 'ACTIVE', role: role as never },
      create: {
        id,
        phone: ROLE_PHONES[role],
        email: `${id}@routes.test`,
        passwordHash: 'x-not-a-valid-bcrypt-hash',
        role: role as never,
        status: 'ACTIVE',
        accountNo: `RT-${role}`,
        nameEn: `Route ${role}`,
        fatherName: '-',
        motherName: '-',
      },
    });
    if (role === 'MEMBER') {
      await db.account.upsert({
        where: { userId: id },
        update: {},
        create: {
          savingsBalance: BigInt(50000),
          loanBalance: BigInt(0),
          isLoanEligible: true,
          maxLoanAmount: BigInt(0),
          userId: id,
        },
      });
    }
  }
  return ROLE_IDS;
}

/** A live token for a seeded role. */
export function tokenFor(role: TestRole): string {
  return mintToken({ sub: ROLE_IDS[role], role });
}
