// WO-59 / WO-55 — the registration success path and its compensation (uploads
// and the user row undone on a later failure). Cloudinary is stubbed — CI must
// never touch the real account. Needs a database.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const cloudinary = vi.hoisted(() => {
  let counter = 0;
  const uploaded: string[] = [];
  const deleted: string[] = [];
  /** Set to the 1-based call number that should fail. */
  let failOnCall = 0;

  return {
    uploaded,
    deleted,
    reset(failAt = 0) {
      counter = 0;
      failOnCall = failAt;
      uploaded.length = 0;
      deleted.length = 0;
    },
    uploadImage: vi.fn(async (_buffer: Buffer, folder: string) => {
      counter += 1;
      if (failOnCall && counter === failOnCall) {
        throw new Error('Failed to upload image to Cloudinary');
      }
      const publicId = `hasnahena/${folder}/asset-${counter}`;
      uploaded.push(publicId);
      return {
        url: `https://res.cloudinary.com/hasnahena/image/upload/v1/${publicId}.jpg`,
        publicId,
        format: 'jpg',
      };
    }),
    deleteImage: vi.fn(async (publicId: string) => {
      deleted.push(publicId);
      return true;
    }),
  };
});

vi.mock('@/lib/cloudinary', async (importOriginal) => {
  // Real module, network functions replaced — a hand-listed mock loses new exports.
  const actual = await importOriginal<typeof import('@/lib/cloudinary')>();
  return {
    ...actual,
    uploadImage: cloudinary.uploadImage,
    deleteImage: cloudinary.deleteImage,
  };
});

import { testPrisma, hasTestDatabase, disconnectTestPrisma } from '../route-harness';
import * as registrations from '@/app/api/v1/registrations/route';

const skip = !hasTestDatabase();

const APPLICANT = {
  phone: '01955509001',
  email: 'wo59-applicant@routes.test',
};

function payload() {
  return {
    nameEn: 'Registration Success Path',
    fatherName: 'Test Father',
    motherName: 'Test Mother',
    phone: APPLICANT.phone,
    email: APPLICANT.email,
    nidNumber: '1234567890',
    maritalStatus: 'MARRIED',
    childrenCount: 2,
    gender: 'MALE',
    bloodGroup: 'O+',
    profession: 'Farmer',
    dateOfBirth: '1990-01-01',
    permanentHouseNo: '12',
    permanentVillage: 'Test Village',
    permanentUnion: 'Test Union',
    permanentPoliceStation: 'Kotwali',
    permanentDistrict: 'Jessore',
    sameAsPermanent: true,
    nomineeName: 'Test Nominee',
    nomineeRelationship: 'Spouse',
    nomineeNid: '9876543210',
  };
}

/** Four documents, as the form submits them. */
function submission(overrides: Record<string, unknown> = {}): Request {
  const form = new FormData();
  form.set('payload', JSON.stringify({ ...payload(), ...overrides }));
  for (const key of ['nidFrontImage', 'nidBackImage', 'memberPhotoImage', 'signatureImage']) {
    form.set(key, new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00])], `${key}.jpg`, { type: 'image/jpeg' }));
  }
  return new Request('http://localhost:3000/api/v1/registrations', { method: 'POST', body: form });
}

async function removeApplicant() {
  const db = testPrisma();
  const users = await db.user.findMany({
    where: { OR: [{ phone: APPLICANT.phone }, { email: APPLICANT.email }] },
    select: { id: true, nameEn: true },
  });
  for (const user of users) {
    await db.notification.deleteMany({ where: { message: { contains: user.nameEn } } });
    await db.user.delete({ where: { id: user.id } });
  }
}

/** Reset this address's submission rate limit (the harness shares one bucket). */
async function clearSubmissionRateLimit() {
  // `rate_limits.id` is the composite key `action:identifier` — there is no
  // separate action column.
  await testPrisma().rateLimit.deleteMany({
    where: { id: { startsWith: 'registration-submit:' } },
  });
}

describe.skipIf(skip)('POST /api/v1/registrations', () => {
  beforeAll(async () => {
    await removeApplicant();
  });

  afterAll(async () => {
    await removeApplicant();
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    cloudinary.reset();
    vi.clearAllMocks();
    await removeApplicant();
    // Cleared per test, so the limit stays the production number.
    await clearSubmissionRateLimit();
  });

  it('creates the member, stores four documents, and tells the admins', async () => {
    const res = await registrations.POST(submission());
    const body = (await res.json()) as { ok: boolean; user?: { id: string; formNumber: string } };

    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.ok).toBe(true);

    const user = await testPrisma().user.findUnique({
      where: { id: body.user!.id },
      include: { documents: true, nominee: true, account: true },
    });
    expect(user?.status).toBe('PENDING');
    // No account number until approval (ADR-039).
    expect(user?.accountNo).toBeNull();
    expect(user?.formNumber).toMatch(/^APP-\d{4}-\d{6}$/);
    expect(body.user?.formNumber).toBe(user?.formNumber);
    expect(user?.documents.map((d) => d.type).sort()).toEqual([
      'member_photo',
      'member_signature',
      'nid_back',
      'nid_front',
    ]);
    expect(user?.nominee?.name).toBe('Test Nominee');
    // An account with an opening balance of zero, not no account: the member
    // has somewhere to deposit the moment they are approved.
    expect(user?.account?.savingsBalance).toBe(BigInt(0));

    // One registration, one admin notification (the floating-promise census is
    // test/unit/floating-promises.test.ts).
    const notification = await testPrisma().notification.findFirst({
      where: { type: 'NEW_REGISTRATION', targetRole: 'ADMIN', message: { contains: user!.nameEn } },
    });
    expect(
      notification,
      'the admin is not told a registration is waiting, and the member waits for an approval nobody knows to give',
    ).not.toBeNull();
    expect(notification?.message).toContain(APPLICANT.phone);

    expect(cloudinary.deleteImage).not.toHaveBeenCalled();
  });

  it('leaves nothing behind when an upload fails', async () => {
    cloudinary.reset(3);

    const res = await registrations.POST(submission());
    expect(res.status).toBe(503);

    // No user row left behind (email and phone would stay taken).
    const user = await testPrisma().user.findFirst({
      where: { OR: [{ phone: APPLICANT.phone }, { email: APPLICANT.email }] },
    });
    expect(user).toBeNull();

    // No orphaned assets.
    expect(cloudinary.uploaded.length).toBeGreaterThan(0);
    expect([...cloudinary.deleted].sort()).toEqual([...cloudinary.uploaded].sort());
  });

  it('refuses a submission that is not multipart, before touching anything', async () => {
    const res = await registrations.POST(
      new Request('http://localhost:3000/api/v1/registrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
      }),
    );
    expect(res.status).toBe(400);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('requires every document', async () => {
    const form = new FormData();
    form.set('payload', JSON.stringify(payload()));
    form.set('nidFrontImage', new File([new Uint8Array([1])], 'nid.jpg', { type: 'image/jpeg' }));

    const res = await registrations.POST(
      new Request('http://localhost:3000/api/v1/registrations', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('NID back image');
    expect(cloudinary.uploadImage, 'nothing may be uploaded before the whole form is valid').not.toHaveBeenCalled();

    const user = await testPrisma().user.findFirst({ where: { phone: APPLICANT.phone } });
    expect(user).toBeNull();
  });

  it('refuses a document that is not an image', async () => {
    const form = new FormData();
    form.set('payload', JSON.stringify(payload()));
    for (const key of ['nidFrontImage', 'nidBackImage', 'memberPhotoImage', 'signatureImage']) {
      form.set(key, new File([new Uint8Array([1])], `${key}.pdf`, { type: 'application/pdf' }));
    }

    const res = await registrations.POST(
      new Request('http://localhost:3000/api/v1/registrations', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T-07, 2026-08-26 — what the entry-path audit found
  // -------------------------------------------------------------------------

  it('throttles submissions from one address', async () => {
    // The POST is throttled per address.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await registrations.POST(submission({
        phone: `019555091${String(attempt).padStart(2, '0')}`,
        email: `throttle-${attempt}@routes.test`,
        nidNumber: `55500000000${String(attempt).padStart(2, '0')}`,
      }));
      expect(res.status, `attempt ${attempt} should still be allowed`).toBe(201);
    }

    const blocked = await registrations.POST(submission({
      phone: '01955509199',
      email: 'throttle-6@routes.test',
      nidNumber: '5550000009999',
    }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();

    // Cleaned up here rather than by removeApplicant, which only knows the one
    // canonical applicant.
    await testPrisma().user.deleteMany({ where: { email: { contains: 'throttle-' } } });
  });

  it('refuses an applicant below the minimum age, and says what the limit is', async () => {
    // The age floor applies.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const res = await registrations.POST(submission({
      dateOfBirth: yesterday.toISOString().slice(0, 10),
    }));
    const body = (await res.json()) as { error: string; field?: string; code?: string; minimumAge?: number };

    expect(res.status).toBe(400);
    expect(body.field).toBe('dateOfBirth');
    expect(body.code).toBe('DOB_TOO_YOUNG');
    // The limit is stated. "Not eligible" leaves an applicant unable to tell a
    // typo from a rule.
    expect(body.minimumAge).toBeGreaterThan(0);
    expect(body.error).toContain(String(body.minimumAge));

    expect(cloudinary.uploadImage, 'nothing is uploaded for an ineligible applicant')
      .not.toHaveBeenCalled();
    expect(await testPrisma().user.findFirst({ where: { phone: APPLICANT.phone } })).toBeNull();
  });

  it('refuses an applicant who nominates themselves', async () => {
    // A member cannot be their own nominee.
    const res = await registrations.POST(submission({ nomineeNid: payload().nidNumber }));
    const body = (await res.json()) as { field?: string; code?: string };

    expect(res.status).toBe(400);
    expect(body.field).toBe('nomineeNid');
    expect(body.code).toBe('NOMINEE_IS_APPLICANT');
    expect(await testPrisma().user.findFirst({ where: { phone: APPLICANT.phone } })).toBeNull();
  });

  it('refuses a second live member holding the same NID, and names that field', async () => {
    // A duplicate NID is refused, naming the NID.
    expect((await registrations.POST(submission())).status).toBe(201);

    const res = await registrations.POST(submission({
      phone: '01955509077',
      email: 'different-person@routes.test',
    }));
    const body = (await res.json()) as { error: string; field?: string };

    expect(res.status).toBe(409);
    expect(body.field).toBe('NID number');
    expect(body.error).toContain('NID');

    await testPrisma().user.deleteMany({ where: { email: 'different-person@routes.test' } });
  });

  it('lets a rejected applicant apply again with the same email, phone and NID', async () => {
    // A rejected applicant may reapply with the same details.
    const first = await registrations.POST(submission());
    expect(first.status).toBe(201);
    const created = (await first.json()) as { user: { id: string } };

    // Rejected, the way the Go handler does it: status only, contact details
    // untouched.
    await testPrisma().user.update({
      where: { id: created.user.id },
      data: {
        status: 'INACTIVE',
        rejectionReasonCode: 'INCOMPLETE_DOCUMENTS',
        rejectedAt: new Date(),
      },
    });

    const again = await registrations.POST(submission());
    expect(
      again.status,
      'a rejected applicant must be able to reapply with the details they used before',
    ).toBe(201);

    // Both rows exist: the decision is kept, and the new application is live.
    const rows = await testPrisma().user.findMany({
      where: { phone: APPLICANT.phone },
      select: { status: true, rejectionReasonCode: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('INACTIVE');
    expect(rows[0].rejectionReasonCode).toBe('INCOMPLETE_DOCUMENTS');
    expect(rows[1].status).toBe('PENDING');
  });
});
