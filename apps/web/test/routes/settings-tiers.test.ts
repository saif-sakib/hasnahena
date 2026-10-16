// WO-77 (SEC-12) — GET /api/v1/settings answers by caller tier: anonymous,
// member (+ loan policy), worker (+ content keys), admin (everything).
// Needs a database.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  routeRequest,
  readBody,
  seedRoleUsers,
  tokenFor,
  hasTestDatabase,
  testPrisma,
  disconnectTestPrisma,
} from '../route-harness';

import * as settings from '@/app/api/v1/settings/route';
import { CONTENT_CONFIG_KEYS } from '@/lib/system-config';

const describeWithDb = hasTestDatabase() ? describe : describe.skip;

/** One key per tier, chosen for what getting it wrong would mean. */
const PUBLIC_KEY = 'org.name';
const MEMBER_KEY = 'loan.maxLoanMultiplier';
const ADMIN_KEY = 'support.chatRetentionDays';

async function get(token?: string): Promise<Record<string, string>> {
  const res = await settings.GET(routeRequest('/api/v1/settings', { token }) as never);
  const { status, json } = await readBody(res);
  expect(status, 'the settings endpoint answers every caller').toBe(200);
  return json as Record<string, string>;
}

const SEEDED_KEYS = [PUBLIC_KEY, MEMBER_KEY, ADMIN_KEY, ...CONTENT_CONFIG_KEYS];

/** A legal value per key — a non-URL in an image key once 500'd every public page. */
function fixtureValue(key: string): string {
  return /logo|favicon|image/i.test(key) ? 'https://example.com/fixture.png' : 'wo77-fixture';
}

describeWithDb('GET /api/v1/settings serves one tier per caller', () => {
  /** Only the rows this suite created, so cleanup cannot delete a real one. */
  let createdKeys: string[] = [];

  beforeAll(async () => {
    await seedRoleUsers();
    // Seeded here (other suites truncate).
    const db = testPrisma();
    const existing = await db.systemConfig.findMany({
      where: { key: { in: SEEDED_KEYS } },
      select: { key: true },
    });
    const alreadyThere = new Set(existing.map((row) => row.key));
    createdKeys = SEEDED_KEYS.filter((key) => !alreadyThere.has(key));
    for (const key of createdKeys) {
      await db.systemConfig.create({ data: { key, value: fixtureValue(key) } });
    }
  });

  afterAll(async () => {
    // system_config is global: restore what was found.
    const db = testPrisma();
    if (createdKeys.length > 0) {
      await db.systemConfig.deleteMany({ where: { key: { in: createdKeys } } });
    }
    await disconnectTestPrisma();
  });

  it('gives an anonymous caller branding but not the loan policy', async () => {
    const body = await get();
    expect(body[PUBLIC_KEY], 'the public site cannot render without this').toBeDefined();
    expect(
      body[MEMBER_KEY],
      'SEC-12: the loan policy is published to members, not to strangers',
    ).toBeUndefined();
    expect(body[ADMIN_KEY], 'an operational policy, admin only').toBeUndefined();
  });

  it('gives a signed-in member the loan policy as well', async () => {
    const body = await get(tokenFor('MEMBER'));
    expect(body[PUBLIC_KEY]).toBeDefined();
    expect(
      body[MEMBER_KEY],
      'dashboard/member/loans sizes its eligibility calculator from this; without ' +
        'it the screen silently shows the defaults hardcoded in the component',
    ).toBeDefined();
    expect(body[ADMIN_KEY]).toBeUndefined();
  });

  it('gives a worker every content key but no money settings', async () => {
    // EVERY content key — a missing one would be saved back blank.
    const body = await get(tokenFor('WORKER'));
    for (const key of CONTENT_CONFIG_KEYS) {
      expect(body[key], `a worker edits ${key} on Content & Media and must be able to read it`)
        .toBeDefined();
    }
    expect(
      body[ADMIN_KEY],
      'a worker edits what the public pages show, not the retention policy',
    ).toBeUndefined();
  });

  it('gives an admin everything', async () => {
    const body = await get(tokenFor('ADMIN'));
    expect(body[PUBLIC_KEY]).toBeDefined();
    expect(body[MEMBER_KEY]).toBeDefined();
    expect(
      body[ADMIN_KEY],
      'the admin settings form loads from this endpoint and would render a screen ' +
        'with fields missing',
    ).toBeDefined();
  });

  it('treats a garbage token as anonymous rather than answering 401', async () => {
    // This endpoint's job is to answer callers who are not signed in. A member
    // whose session expired must still get a login page with the right logo.
    const body = await get('not.a.token');
    expect(body[PUBLIC_KEY]).toBeDefined();
    expect(body[MEMBER_KEY]).toBeUndefined();
  });

  it('never returns a key outside the declared allow-list, to anyone', async () => {
    // Every tier is a subset of SYSTEM_CONFIG_KEYS (WO-64).
    const db = testPrisma();
    await db.systemConfig.upsert({
      where: { key: 'wo77.undeclared.secret' },
      update: {},
      create: { key: 'wo77.undeclared.secret', value: 'must-never-be-served' },
    });
    try {
      for (const token of [undefined, tokenFor('MEMBER'), tokenFor('WORKER'), tokenFor('ADMIN')]) {
        const body = await get(token);
        expect(body['wo77.undeclared.secret']).toBeUndefined();
      }
    } finally {
      await db.systemConfig.deleteMany({ where: { key: 'wo77.undeclared.secret' } });
    }
  });
});
