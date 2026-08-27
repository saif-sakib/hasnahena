// ADR-040 — an admitted member's files live in one folder, named after them.
//
// The four registration documents arrive from a public form, before anybody is
// a member and therefore before an account number exists, so they are uploaded
// under the application. Approval moves them next to the avatar. This walks the
// route that does it.
//
// **Cloudinary is stubbed at the module boundary.** That account holds real
// members' NID scans and CI has no credentials for it on purpose, so a spec that
// drives the real thing fails the whole workflow. Stubbing also buys the half
// that cannot be tested against it either way: the *successful* move, where the
// URL is rewritten and the emptied folder is cleaned up.
//
// Only the two functions that talk over the network are replaced. `personFolder`
// and `extractPublicId` are pure and come from the real module — restating them
// here would let the route and the test agree with each other and with nothing.
//
//   scripts/test-stack.sh up && eval "$(scripts/test-stack.sh env)"
//   pnpm --filter @hasnahena/web test:routes

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// `vi.hoisted`, because `vi.mock` is lifted to the top of the file and a plain
// `const` above it is not yet initialised when the factory runs.
const cloud = vi.hoisted(() => ({
  moveAsset: vi.fn<(from: string, to: string) => Promise<string | null>>(),
  deleteEmptyFolder: vi.fn<(folder: string) => Promise<void>>(),
}));

vi.mock('@/lib/cloudinary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cloudinary')>();
  return { ...actual, moveAsset: cloud.moveAsset, deleteEmptyFolder: cloud.deleteEmptyFolder };
});

import {
  routeRequest,
  readBody,
  seedRoleUsers,
  tokenFor,
  testPrisma,
  hasTestDatabase,
  disconnectTestPrisma,
} from '../route-harness';

import * as refile from '@/app/api/v1/admin/members/[id]/refile-documents/route';

const skip = !hasTestDatabase();
const d = skip ? describe.skip : describe;

const TAG = 'docfiling';

d('filing an admitted member’s documents', () => {
  let adminToken: string;

  beforeAll(async () => {
    await seedRoleUsers();
    adminToken = tokenFor('ADMIN');
  });

  afterAll(async () => {
    await testPrisma().user.deleteMany({ where: { phone: { startsWith: `01${TAG}` } } });
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await testPrisma().user.deleteMany({ where: { phone: { startsWith: `01${TAG}` } } });
    cloud.moveAsset.mockReset();
    cloud.deleteEmptyFolder.mockReset().mockResolvedValue(undefined);
    // The default is a move that does not happen — an image host that is down,
    // or credentials that are absent, which is what CI has. Each test that cares
    // about the happy path says so.
    cloud.moveAsset.mockResolvedValue(null);
  });

  async function makeUser(opts: { accountNo: string | null; formNumber: string; docs: string[] }) {
    const user = await testPrisma().user.create({
      data: {
        email: `${TAG}-${opts.formNumber}@example.test`,
        phone: `01${TAG}${opts.formNumber.slice(-4)}`,
        passwordHash: 'x'.repeat(60),
        role: 'MEMBER',
        status: opts.accountNo ? 'ACTIVE' : 'PENDING',
        accountNo: opts.accountNo,
        formNumber: opts.formNumber,
        nameEn: 'Filing Subject',
        fatherName: 'F',
        motherName: 'M',
      },
      select: { id: true },
    });
    if (opts.docs.length) {
      await testPrisma().document.createMany({
        data: opts.docs.map((url, i) => ({
          userId: user.id,
          type: ['nid_front', 'nid_back', 'member_photo', 'member_signature'][i] ?? 'other',
          url,
          fileName: `doc-${i}.jpg`,
          mimeType: 'image/jpeg',
          size: 1000,
        })),
      });
    }
    return user.id;
  }

  async function call(id: string, token = adminToken) {
    const res = await refile.POST(
      routeRequest(`/api/v1/admin/members/${id}/refile-documents`, {
        method: 'POST',
        token,
      }),
      { params: Promise.resolve({ id }) },
    );
    return readBody(res);
  }

  it('refuses an application that has not been approved', async () => {
    // There is no folder to file into. Saying so is more useful than reporting
    // a successful move of nothing, which is what a 200 here would be.
    const id = await makeUser({ accountNo: null, formNumber: 'APP-2026-009001', docs: [] });
    const { status } = await call(id);
    expect(status).toBe(409);
  });

  it('answers 404 for somebody who is not a member', async () => {
    const staff = (await seedRoleUsers()).WORKER;
    const { status } = await call(staff);
    expect(status).toBe(404);
  });

  it('counts a document already filed under the member as needing nothing', async () => {
    // Idempotency is the whole safety of this route: the approvals screen calls
    // it and so does the nightly sweep, so "already there" has to be an outcome
    // rather than a failure — and it must not be a Cloudinary round trip either.
    const id = await makeUser({
      accountNo: 'ACC-KH-39001',
      formNumber: 'APP-2026-009002',
      docs: [
        'https://res.cloudinary.com/demo/image/upload/v1/hasnahena/people/ACC-KH-39001/nid-front.jpg',
      ],
    });
    const { status, json } = await call(id);
    expect(status).toBe(200);
    const data = (json as { data: { moved: number; alreadyFiled: number; failed: number } }).data;
    expect(data).toMatchObject({ moved: 0, alreadyFiled: 1, failed: 0 });
  });

  it('moves each document into the member’s folder and rewrites its URL', async () => {
    const moved =
      'https://res.cloudinary.com/demo/image/upload/v2/hasnahena/people/ACC-KH-39004/nid-front.jpg';
    cloud.moveAsset.mockResolvedValue(moved);
    const id = await makeUser({
      accountNo: 'ACC-KH-39004',
      formNumber: 'APP-2026-009005',
      docs: [
        'https://res.cloudinary.com/demo/image/upload/v1/hasnahena/applications/APP-2026-009005/nid-front.jpg',
      ],
    });

    const { status, json } = await call(id);
    expect(status).toBe(200);
    expect((json as { data: { moved: number } }).data.moved).toBe(1);

    // Named from the row's `type`, not from wherever the asset happened to be —
    // the four names are declared once in `lib/application-documents.ts`.
    expect(cloud.moveAsset).toHaveBeenCalledWith(
      'hasnahena/applications/APP-2026-009005/nid-front',
      'hasnahena/people/ACC-KH-39004/nid-front',
    );
    const rows = await testPrisma().document.findMany({ where: { userId: id }, select: { url: true } });
    expect(rows.map((r) => r.url)).toEqual([moved]);

    // And the emptied application folder goes — an asset tree that keeps one
    // directory per member ever admitted is a second record of who applied.
    expect(cloud.deleteEmptyFolder).toHaveBeenCalledWith('applications/APP-2026-009005');
  });

  it('leaves the application folder alone when anything failed to move', async () => {
    // Half-moved is the dangerous state. Removing the folder here would need
    // `deleteFolder`, which deletes contents — finishing the move by destroying
    // the half that did not move.
    const id = await makeUser({
      accountNo: 'ACC-KH-39005',
      formNumber: 'APP-2026-009006',
      docs: [
        'https://res.cloudinary.com/demo/image/upload/v1/hasnahena/applications/APP-2026-009006/nid-front.jpg',
        'https://res.cloudinary.com/demo/image/upload/v1/hasnahena/applications/APP-2026-009006/nid-back.jpg',
      ],
    });
    cloud.moveAsset
      .mockResolvedValueOnce('https://res.cloudinary.com/demo/image/upload/v2/hasnahena/people/ACC-KH-39005/nid-front.jpg')
      .mockResolvedValueOnce(null);

    const { json } = await call(id);
    expect((json as { data: { moved: number; failed: number } }).data).toMatchObject({
      moved: 1,
      failed: 1,
    });
    expect(cloud.deleteEmptyFolder).not.toHaveBeenCalled();
  });

  it('leaves the row alone when the move cannot happen', async () => {
    // The URL must still point at where the file actually is: rewriting it on a
    // move that did not happen is the one outcome worse than not moving, because
    // the row then names nothing and the sweep has nothing to retry from.
    const url =
      'https://res.cloudinary.com/demo/image/upload/v1/hasnahena/applications/APP-2026-009003/nid-front.jpg';
    const id = await makeUser({
      accountNo: 'ACC-KH-39002',
      formNumber: 'APP-2026-009003',
      docs: [url],
    });
    const { status, json } = await call(id);
    expect(status).toBe(200);
    const data = (json as { data: { moved: number; failed: number } }).data;
    expect(data.moved).toBe(0);
    expect(data.failed).toBe(1);

    const rows = await testPrisma().document.findMany({ where: { userId: id }, select: { url: true } });
    expect(rows.map((r) => r.url), 'a failed move must not rewrite the URL').toEqual([url]);
  });

  it('never deletes a document row', async () => {
    // Filing is not purging. `purgeApplicationDocuments` deletes rows and
    // assets at a rejection; this one only ever renames, and a bug that
    // confused the two would destroy an admitted member's identity documents.
    const id = await makeUser({
      accountNo: 'ACC-KH-39003',
      formNumber: 'APP-2026-009004',
      docs: [
        'https://res.cloudinary.com/demo/image/upload/v1/hasnahena/applications/APP-2026-009004/nid-front.jpg',
        'https://res.cloudinary.com/demo/image/upload/v1/hasnahena/applications/APP-2026-009004/nid-back.jpg',
      ],
    });
    await call(id);
    expect(await testPrisma().document.count({ where: { userId: id } })).toBe(2);
  });
});
