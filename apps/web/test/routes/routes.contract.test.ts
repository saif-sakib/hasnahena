// TEST-16 — the access contract for all 21 Next route methods.
//
// The Go half of this lives in `apps/api/cmd/server/routes_integration_test.go`
// and enumerates its routes by walking the router. Next has no router to walk:
// a route *is* a file at a path, so the enumeration here is the import list
// below, and `TestEveryRouteFileIsUnderContract` checks it against the
// filesystem so a route added tomorrow cannot quietly escape the table.
//
// Needs a database, because `requireActiveAuth` reads `token_blacklist` (SEC-11)
// and most handlers then read the user. Skips cleanly without one.
//
//   scripts/test-stack.sh up
//   eval "$(scripts/test-stack.sh env)"
//   pnpm --filter @hasnahena/web test:routes

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  routeRequest,
  readBody,
  seedRoleUsers,
  tokenFor,
  mintToken,
  hasTestDatabase,
  testPrisma,
  disconnectTestPrisma,
  TEST_JWT_SECRET,
  type TestRole,
} from '../route-harness';

import * as auditLogs from '@/app/api/v1/admin/audit-logs/route';
import * as adminWorkers from '@/app/api/v1/admin/workers/route';
import * as adminBranches from '@/app/api/v1/admin/branches/route';
import * as adminMemberErase from '@/app/api/v1/admin/members/[id]/erase/route';
import * as authLogin from '@/app/api/v1/auth/login/route';
import * as supportProxy from '@/app/api/v1/dashboard/support/[...path]/route';
import * as gallery from '@/app/api/v1/gallery/route';
import * as loanApplications from '@/app/api/v1/loans/applications/route';
import * as guarantorApproval from '@/app/api/v1/loans/[id]/guarantor-approval/route';
import * as membersLookup from '@/app/api/v1/members/lookup/route';
import * as dispute from '@/app/api/v1/member/transactions/[id]/dispute/route';
import * as registrations from '@/app/api/v1/registrations/route';
import * as settings from '@/app/api/v1/settings/route';

// Route handlers vary in signature: some take `Request`, some `NextRequest`,
// some a second argument for a dynamic segment. At runtime the harness supplies
// a plain `Request` and, where the row declares one, the context object — which
// is exactly what Next supplies. The double cast says that explicitly rather
// than widening the handlers themselves to satisfy a test.
type Handler = (req: Request, ctx?: unknown) => Promise<Response>;
const asHandler = (fn: unknown) => fn as Handler;

/** Who may reach a route. `null` roles means any authenticated caller. */
type Contract = {
  /** No credential needed. */
  public?: boolean;
  /** Roles allowed. Undefined with `public: false` means any authenticated role. */
  roles?: TestRole[];
  /** Second argument Next passes for a dynamic segment. */
  context?: unknown;
  /** Body to send on writes. */
  body?: unknown;
  /** Query string appended to the path. */
  query?: string;
};

const ADMINS: TestRole[] = ['ADMIN', 'SUPER_ADMIN'];
const STAFF: TestRole[] = ['ADMIN', 'SUPER_ADMIN', 'WORKER'];

/**
 * One row per exported method. `file` is the route directory relative to
 * `app/api`, used by the filesystem check at the bottom.
 */
const ROUTES: Array<{
  name: string;
  file: string;
  method: string;
  handler: Handler;
  path: string;
  contract: Contract;
}> = [
  {
    name: 'GET /api/v1/admin/audit-logs',
    file: 'v1/admin/audit-logs',
    method: 'GET',
    handler: asHandler(auditLogs.GET),
    path: '/api/v1/admin/audit-logs',
    contract: { roles: ADMINS },
  },
  {
    // WO-72. Branches became a managed entity when users.assignedBranch stopped
    // being a free string. Admin-only throughout: a branch decides which office
    // a worker belongs to, so it is staff configuration, not member data.
    name: 'GET /api/v1/admin/branches',
    file: 'v1/admin/branches',
    method: 'GET',
    handler: asHandler(adminBranches.GET),
    path: '/api/v1/admin/branches',
    contract: { roles: ADMINS },
  },
  {
    name: 'POST /api/v1/admin/branches',
    file: 'v1/admin/branches',
    method: 'POST',
    handler: asHandler(adminBranches.POST),
    path: '/api/v1/admin/branches',
    contract: { roles: ADMINS, body: {} },
  },
  {
    name: 'PUT /api/v1/admin/branches',
    file: 'v1/admin/branches',
    method: 'PUT',
    handler: asHandler(adminBranches.PUT),
    path: '/api/v1/admin/branches',
    contract: { roles: ADMINS, body: {} },
  },
  {
    name: 'DELETE /api/v1/admin/branches',
    file: 'v1/admin/branches',
    method: 'DELETE',
    handler: asHandler(adminBranches.DELETE),
    path: '/api/v1/admin/branches?id=no-such-branch',
    contract: { roles: ADMINS },
  },
  {
    // WO-93 / FR-23. Erasure is the one irreversible action on this API, so the
    // contract that matters most is who cannot reach it: a worker must not.
    name: 'POST /api/v1/admin/members/[id]/erase',
    file: 'v1/admin/members/[id]/erase',
    method: 'POST',
    handler: asHandler(adminMemberErase.POST),
    path: '/api/v1/admin/members/no-such-member/erase',
    contract: {
      roles: ADMINS,
      context: { params: Promise.resolve({ id: 'no-such-member' }) },
      body: { confirmAccountNo: 'ACC-KH-00000', reason: 'contract test' },
    },
  },
  {
    name: 'POST /api/v1/admin/workers',
    file: 'v1/admin/workers',
    method: 'POST',
    handler: asHandler(adminWorkers.POST),
    path: '/api/v1/admin/workers',
    contract: { roles: ADMINS, body: {} },
  },
  {
    name: 'PUT /api/v1/admin/workers',
    file: 'v1/admin/workers',
    method: 'PUT',
    handler: asHandler(adminWorkers.PUT),
    path: '/api/v1/admin/workers',
    contract: { roles: ADMINS, body: {} },
  },
  {
    name: 'PATCH /api/v1/admin/workers',
    file: 'v1/admin/workers',
    method: 'PATCH',
    handler: asHandler(adminWorkers.PATCH),
    path: '/api/v1/admin/workers',
    contract: { roles: ADMINS, body: {} },
  },
  {
    name: 'DELETE /api/v1/admin/workers',
    file: 'v1/admin/workers',
    method: 'DELETE',
    handler: asHandler(adminWorkers.DELETE),
    path: '/api/v1/admin/workers',
    contract: { roles: ADMINS, body: {} },
  },
  {
    // Public by necessity: this is how a caller gets a credential.
    name: 'POST /api/v1/auth/login',
    file: 'v1/auth/login',
    method: 'POST',
    handler: asHandler(authLogin.POST),
    path: '/api/v1/auth/login',
    contract: { public: true, body: { identifier: 'nobody', password: 'nope' } },
  },
  {
    // The gallery is public content on the marketing site.
    name: 'GET /api/v1/gallery',
    file: 'v1/gallery',
    method: 'GET',
    handler: asHandler(gallery.GET),
    path: '/api/v1/gallery',
    contract: { public: true },
  },
  {
    name: 'POST /api/v1/gallery',
    file: 'v1/gallery',
    method: 'POST',
    handler: asHandler(gallery.POST),
    path: '/api/v1/gallery',
    contract: { roles: ADMINS, body: {} },
  },
  {
    name: 'PUT /api/v1/gallery',
    file: 'v1/gallery',
    method: 'PUT',
    handler: asHandler(gallery.PUT),
    path: '/api/v1/gallery',
    contract: { roles: ADMINS, body: {} },
  },
  {
    name: 'DELETE /api/v1/gallery',
    file: 'v1/gallery',
    method: 'DELETE',
    handler: asHandler(gallery.DELETE),
    path: '/api/v1/gallery',
    contract: { roles: ADMINS, body: {} },
  },
  {
    name: 'POST /api/v1/loans/applications',
    file: 'v1/loans/applications',
    method: 'POST',
    handler: asHandler(loanApplications.POST),
    path: '/api/v1/loans/applications',
    contract: { roles: ['MEMBER'], body: { amount: 1000, installments: 6, purpose: 'test purpose' } },
  },
  {
    name: 'POST /api/v1/loans/[id]/guarantor-approval',
    file: 'v1/loans/[id]/guarantor-approval',
    method: 'POST',
    handler: asHandler(guarantorApproval.POST),
    path: '/api/v1/loans/no-such-loan/guarantor-approval',
    contract: {
      roles: ['MEMBER'],
      context: { params: Promise.resolve({ id: 'no-such-loan' }) },
      body: { decision: 'APPROVE' },
    },
  },
  {
    name: 'GET /api/v1/members/lookup',
    file: 'v1/members/lookup',
    method: 'GET',
    handler: asHandler(membersLookup.GET),
    path: '/api/v1/members/lookup',
    contract: { roles: ['MEMBER'], query: '?accountNo=RT-MEMBER' },
  },
  {
    name: 'POST /api/v1/member/transactions/[id]/dispute',
    file: 'v1/member/transactions/[id]/dispute',
    method: 'POST',
    handler: asHandler(dispute.POST),
    path: '/api/v1/member/transactions/no-such-txn/dispute',
    contract: {
      roles: ['MEMBER'],
      context: { params: Promise.resolve({ id: 'no-such-txn' }) },
      body: { reason: 'a reason long enough to pass validation' },
    },
  },
  {
    // Availability check during sign-up — necessarily unauthenticated.
    name: 'GET /api/v1/registrations',
    file: 'v1/registrations',
    method: 'GET',
    handler: asHandler(registrations.GET),
    path: '/api/v1/registrations',
    contract: { public: true, query: '?email=nobody@example.test' },
  },
  {
    // Sign-up itself.
    name: 'POST /api/v1/registrations',
    file: 'v1/registrations',
    method: 'POST',
    handler: asHandler(registrations.POST),
    path: '/api/v1/registrations',
    contract: { public: true, body: {} },
  },
  {
    // Read by the marketing pages and the login screen before anyone signs in.
    name: 'GET /api/v1/settings',
    file: 'v1/settings',
    method: 'GET',
    handler: asHandler(settings.GET),
    path: '/api/v1/settings',
    contract: { public: true },
  },
  {
    // Staff, not admins — but the *keys* decide, not only the role. A worker
    // edits Content & Media, which posts `CONTENT_CONFIG_KEYS`; the money and
    // policy rows stay an admin's. The row below covers the role gate; the
    // key gate has its own test under "role separation".
    name: 'PUT /api/v1/settings',
    file: 'v1/settings',
    method: 'PUT',
    handler: asHandler(settings.PUT),
    path: '/api/v1/settings',
    contract: { roles: STAFF, body: {} },
  },
  // The support routes are a transparent proxy to the Go API, which does its
  // own authorization. They are listed so the filesystem check passes and so
  // the "never a 5xx" sweep covers them, but they get no role row: the answer
  // is whatever Go says, and Go's own contract is TEST-15's job.
  {
    name: 'GET /api/v1/dashboard/support/[...path] (proxy)',
    file: 'v1/dashboard/support/[...path]',
    method: 'GET',
    handler: asHandler(supportProxy.GET),
    path: '/api/v1/dashboard/support/threads',
    contract: { public: true, context: { params: Promise.resolve({ path: ['threads'] }) } },
  },
  {
    name: 'POST /api/v1/dashboard/support/[...path] (proxy)',
    file: 'v1/dashboard/support/[...path]',
    method: 'POST',
    handler: asHandler(supportProxy.POST),
    path: '/api/v1/dashboard/support/messages',
    contract: { public: true, context: { params: Promise.resolve({ path: ['messages'] }) }, body: {} },
  },
  {
    name: 'PUT /api/v1/dashboard/support/[...path] (proxy)',
    file: 'v1/dashboard/support/[...path]',
    method: 'PUT',
    handler: asHandler(supportProxy.PUT),
    path: '/api/v1/dashboard/support/config',
    contract: { public: true, context: { params: Promise.resolve({ path: ['config'] }) }, body: {} },
  },
];

/**
 * Routes that forward to the Go API rather than answering themselves.
 *
 * They are excluded from the sweeps because the answer is Go's, not theirs, and
 * because reaching Go needs the API process running — which would make this
 * suite depend on `test-stack.sh up --serve` rather than on a database alone.
 * Their contracts are TEST-15's, over there. `POST /api/v1/auth/login` is one
 * of these: it hands the credentials to Go and relays the response.
 */
const isProxy = (name: string) => name.includes('(proxy)') || name === 'POST /api/v1/auth/login';

async function call(
  route: (typeof ROUTES)[number],
  token?: string,
  bodyOverride?: { body?: unknown; raw?: string },
): Promise<{ status: number; text: string; json: unknown }> {
  const req = routeRequest(route.path + (route.contract.query ?? ''), {
    token,
    method: route.method,
    ...(bodyOverride?.raw !== undefined
      ? { raw: bodyOverride.raw }
      : { body: bodyOverride?.body ?? route.contract.body }),
  });
  // Dynamic segments get Next's second argument; the rest ignore it.
  const res = await route.handler(req, route.contract.context as never);
  return readBody(res);
}

const skip = !hasTestDatabase();

describe.skipIf(skip)('TEST-16 — Next route access contract', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    await seedRoleUsers();
  });
  afterAll(async () => {
    await disconnectTestPrisma();
  });

  const guarded = ROUTES.filter((r) => !r.contract.public && !isProxy(r.name));

  describe('an anonymous caller', () => {
    for (const route of guarded) {
      it(`is refused 401 by ${route.name}`, async () => {
        const res = await call(route);
        expect(res.status, `body: ${res.text}`).toBe(401);
      });
    }
  });

  describe('a token signed with the wrong key', () => {
    const forged = mintToken({
      sub: 'nextroute-admin',
      role: 'SUPER_ADMIN',
      secret: 'a-completely-different-signing-key',
    });
    for (const route of guarded) {
      it(`is refused 401 by ${route.name}`, async () => {
        const res = await call(route, forged);
        expect(res.status, `body: ${res.text}`).toBe(401);
      });
    }
  });

  describe('an expired token', () => {
    const expired = mintToken({ sub: 'nextroute-admin', role: 'ADMIN', expiresInSeconds: -60 });
    for (const route of guarded) {
      it(`is refused 401 by ${route.name}`, async () => {
        const res = await call(route, expired);
        // 401, never 500 — this was the Phase 1 defect and it must stay fixed
        // at the route level, not only in lib/auth.ts.
        expect(res.status, `body: ${res.text}`).toBe(401);
      });
    }
  });

  describe('role separation', () => {
    const roles: TestRole[] = ['MEMBER', 'WORKER', 'ADMIN'];
    for (const route of guarded) {
      for (const role of roles) {
        const allowed = route.contract.roles ? route.contract.roles.includes(role) : true;
        it(`${role} ${allowed ? 'may' : 'may not'} call ${route.name}`, async () => {
          const res = await call(route, tokenFor(role));
          if (allowed) {
            expect(res.status, `body: ${res.text}`).not.toBe(401);
            expect(res.status, `body: ${res.text}`).not.toBe(403);
          } else {
            expect(res.status, `body: ${res.text}`).toBe(403);
          }
        });
      }
    }

    // The settings PUT is the one route where the role is not the whole
    // contract. Content & Media is a worker's screen and Settings is not, so
    // the same endpoint takes a worker for one set of keys and refuses them for
    // another. Without this, widening the role gate would silently hand a
    // worker the loan multiplier and the bKash number.
    //
    // Two of these three probes are *accepted*, which means they write. This
    // database is shared with the browser suite, so the rows are put back —
    // seeding `branding.logo` with a value that was not a URL once made every
    // public page answer 500 for the rest of a run.
    describe('the key decides too, not only the role', () => {
      const PROBE_KEYS = ['hero.tagline', 'donation.bkash'];
      let before: Array<{ key: string; value: string }> = [];

      const settingsPut = () => guarded.find((r) => r.name === 'PUT /api/v1/settings')!;
      const put = (body: Record<string, unknown>, role: TestRole) => {
        const route = settingsPut();
        return call({ ...route, contract: { ...route.contract, body } }, tokenFor(role));
      };

      beforeAll(async () => {
        before = await testPrisma().systemConfig.findMany({
          where: { key: { in: PROBE_KEYS } },
          select: { key: true, value: true },
        });
      });

      afterAll(async () => {
        const db = testPrisma();
        const kept = new Set(before.map((row) => row.key));
        await db.systemConfig.deleteMany({
          where: { key: { in: PROBE_KEYS.filter((key) => !kept.has(key)) } },
        });
        for (const row of before) {
          await db.systemConfig.update({ where: { key: row.key }, data: { value: row.value } });
        }
      });

      it('WORKER may write a content key', async () => {
        const res = await put({ 'hero.tagline': 'worker probe' }, 'WORKER');
        expect(res.status, `body: ${res.text}`).not.toBe(403);
      });

      it('WORKER may not write a settings key', async () => {
        const res = await put({ 'donation.bkash': '01700000000' }, 'WORKER');
        expect(res.status, `body: ${res.text}`).toBe(403);
      });

      it('ADMIN may write a settings key', async () => {
        const res = await put({ 'donation.bkash': '01700000000' }, 'ADMIN');
        expect(res.status, `body: ${res.text}`).not.toBe(403);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// TEST-18, the Next half
// ---------------------------------------------------------------------------

const HOSTILE_BODIES: Array<{ name: string; raw: string }> = [
  { name: 'empty body', raw: '' },
  { name: 'not JSON', raw: '<html></html>' },
  { name: 'JSON null', raw: 'null' },
  { name: 'array where an object belongs', raw: '[1,2,3]' },
  { name: 'truncated JSON', raw: '{"amount": 100' },
  { name: 'duplicate keys', raw: '{"amount":1,"amount":999999999}' },
  { name: 'prototype pollution', raw: '{"__proto__":{"role":"SUPER_ADMIN"},"amount":1}' },
  { name: 'constructor pollution', raw: '{"constructor":{"prototype":{"role":"ADMIN"}}}' },
  { name: 'SQL metacharacters', raw: '{"purpose":"\'; DROP TABLE users; --","reason":"\' OR \'1\'=\'1"}' },
  { name: 'RTL override', raw: '{"purpose":"‮evil‬","reason":"‮evil‬"}' },
  { name: 'escaped NUL', raw: '{"purpose":"a\\u0000b","reason":"a\\u0000b"}' },
  { name: 'amount as a string', raw: '{"amount":"1000","installments":6,"purpose":"x"}' },
  { name: 'amount as a float', raw: '{"amount":1000.5,"installments":6,"purpose":"aaa"}' },
  { name: 'amount beyond Number.MAX_SAFE_INTEGER', raw: '{"amount":99999999999999999999,"installments":6,"purpose":"aaa"}' },
  { name: 'negative amount', raw: '{"amount":-1000,"installments":6,"purpose":"aaa"}' },
  { name: 'Infinity-ish', raw: '{"amount":1e400,"installments":6,"purpose":"aaa"}' },
  { name: 'deeply nested', raw: '{"a":'.repeat(5000) + '1' + '}'.repeat(5000) },
];

describe.skipIf(skip)('TEST-18 — Next routes under hostile input', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    await seedRoleUsers();
  });
  afterAll(async () => {
    await disconnectTestPrisma();
  });

  const writes = ROUTES.filter(
    (r) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) &&
      !isProxy(r.name) &&
      // Registration POST is multipart and enforces its own content-type
      // check; its hostile-input coverage is e2e/registration.spec.ts.
      r.name !== 'POST /api/v1/registrations',
  );

  for (const route of writes) {
    for (const hb of HOSTILE_BODIES) {
      it(`${route.name} refuses "${hb.name}" without a 5xx`, async () => {
        // The role that is *allowed* here, so the body reaches validation
        // rather than stopping at the 403.
        const role = route.contract.roles?.[0] ?? 'ADMIN';
        const res = await call(route, tokenFor(role), { raw: hb.raw });
        expect(res.status, `body sent: ${hb.raw.slice(0, 200)}\nresponse: ${res.text.slice(0, 300)}`)
          .toBeLessThan(500);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// The table cannot go stale
// ---------------------------------------------------------------------------

describe('TEST-16 — the contract table covers every route file', () => {
  it('has a row for every exported method under app/api', () => {
    const root = join(process.cwd(), 'app', 'api');

    const routeFiles: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full, rel ? `${rel}/${entry}` : entry);
        } else if (entry === 'route.ts') {
          routeFiles.push(rel);
        }
      }
    };
    walk(root, '');

    const declared = new Set(ROUTES.map((r) => r.file));
    const missing = routeFiles.filter((f) => !declared.has(f));
    expect(
      missing,
      `these route files have no entry in ROUTES — add one saying who may call each method:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);

    const phantom = [...declared].filter((f) => !routeFiles.includes(f));
    expect(phantom, `ROUTES names route files that no longer exist:\n  ${phantom.join('\n  ')}`).toEqual([]);
  });
});
