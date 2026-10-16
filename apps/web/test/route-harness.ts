// TEST-03 — drive Next route handlers directly: a token that verifies and a
// reachable database, no server or browser.
//
//   const res = await POST(jsonRequest('/api/v1/loans/applications', { … }, { as: 'MEMBER' }));
//   expect(res.status).toBe(401);

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

/** Mint a token as the Go login does (HS256 {sub, role, iat, exp}) — so expired or forged ones are easy. */
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

/** A Request as Next would pass it; absolute, since handlers call new URL(req.url). */
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

/** Read a response whether or not it is JSON (a crash answers HTML). */
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

/** Upsert one ACTIVE user per role (+ the member's account); never truncate — the database is shared. */
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
