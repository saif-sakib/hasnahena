// WO-77 (SEC-12) — `GET /api/v1/settings` answers according to who is asking.
//
// The endpoint is unauthenticated on purpose: the marketing pages and the login
// screen read branding from it before anyone signs in. WO-64 already stopped it
// returning `SELECT *`. What was left is that the declared set it *does* return
// included the whole loan policy, to anybody who asked.
//
// Four tiers, and this file is the only thing that checks the boundaries hold:
//
//   anonymous   branding and organisation details
//   member      + the loan policy governing their own money
//   worker      + the content keys, because Content & Media edits them
//   admin       everything, because they are the screen that edits it
//
// Needs a database — the handler reads `system_config`, and deciding the tier
// reads the caller's row. Skips cleanly without one.
//
//   scripts/test-stack.sh up
//   eval "$(scripts/test-stack.sh env)"
//   pnpm --filter @hasnahena/web test:routes

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

/**
 * One key from each tier, chosen for what it would mean to get it wrong.
 *
 * `org.name` is on the letterhead of every generated document and on the login
 * page, so an anonymous caller losing it breaks the public site.
 * `loan.maxLoanMultiplier` is the number SEC-12 is about.
 * `support.chatRetentionDays` is an operational policy no member-facing screen
 * reads, so nothing but the admin form should ever see it.
 */
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

/**
 * A value this key can legally hold.
 *
 * Not a detail. Seeding every key with the string `wo77-fixture` put it in
 * `branding.logo` and the six other image keys, and `next/image` throws
 * "Failed to construct 'URL': Invalid URL" on a src that is not one — so every
 * public page answered **500** for the rest of the run. This suite only checks
 * *which* keys come back, so the value was beneath notice right up until it
 * took the whole marketing site down in the browser suite that ran next.
 */
function fixtureValue(key: string): string {
  return /logo|favicon|image/i.test(key) ? 'https://example.com/fixture.png' : 'wo77-fixture';
}

describeWithDb('GET /api/v1/settings serves one tier per caller', () => {
  /** Only the rows this suite created, so cleanup cannot delete a real one. */
  let createdKeys: string[] = [];

  beforeAll(async () => {
    await seedRoleUsers();
    // Seeded here rather than relying on `pnpm db:seed`: this suite shares a
    // database with the Go integration tests, which truncate between tests, so
    // a row another suite left behind is not something to depend on.
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
    // `system_config` is global — a key cannot be namespaced to one suite the
    // way testing.md's fixture contract asks — so this suite puts back what it
    // found instead. Leaving its rows behind is how it took the marketing pages
    // down for the browser run that shared the database.
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
    // Every key, not a sample. Content & Media is a worker's screen and it
    // renders a controlled input per key; one the worker is not handed shows
    // blank and is then saved back blank over whatever an admin had set.
    //
    // Today every content key happens to be public as well, so a sampled
    // assertion here would pass without testing anything. Adding a content key
    // that is not on a public page — an internal caption, a draft heading — is
    // exactly when this must fail.
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
    // The WO-64 property, re-asserted from the other side of the split: a tier
    // is a subset, and a bug that widened one past SYSTEM_CONFIG_KEYS would be
    // the `SELECT *` regression wearing a new name.
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
