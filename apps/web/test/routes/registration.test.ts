// WO-59 and WO-55 — the registration success path, and the compensation that
// undoes it.
//
// This route is the only place in the application that writes a user row and
// then does more work that can fail. It already handles that carefully: it
// records each Cloudinary public id the moment it lands, deletes them all if a
// later upload throws, deletes the user row, and answers 503. What was missing
// was any test of it — so "careful" was a reading of the code, not a fact about
// its behaviour.
//
// Cloudinary is stubbed at the module boundary. CI must never touch the real
// account: it holds members' NID scans.
//
//   scripts/test-stack.sh up && eval "$(scripts/test-stack.sh env)"
//   pnpm --filter @hasnahena/web test:routes

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

vi.mock('@/lib/cloudinary', () => ({
  uploadImage: cloudinary.uploadImage,
  deleteImage: cloudinary.deleteImage,
}));

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
function submission(): Request {
  const form = new FormData();
  form.set('payload', JSON.stringify(payload()));
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
  });

  it('creates the member, stores four documents, and tells the admins', async () => {
    const res = await registrations.POST(submission());
    const body = (await res.json()) as { ok: boolean; user?: { id: string; memberId: string } };

    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.ok).toBe(true);

    const user = await testPrisma().user.findUnique({
      where: { id: body.user!.id },
      include: { documents: true, nominee: true, account: true },
    });
    expect(user?.status).toBe('PENDING');
    expect(user?.memberId).toBeTruthy();
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

    // WO-59. This notification used to be started and never awaited, so on a
    // platform that freezes the function at the response it might never be
    // written — and no admin would know a registration was waiting.
    //
    // Verified: this assertion passes against the un-awaited version too,
    // because Node settles the promise anyway. It pins the contract — one
    // registration, one admin notification, which nothing checked before — and
    // the regression guard for the floating promise itself is the census in
    // test/unit/floating-promises.test.ts, which was seen to fail against it.
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

    // No user row. Leaving one behind is worse than failing: the phone and
    // email are then taken, and the member's second attempt is refused with
    // "already exists" — a dead end only an admin can clear, caused by an
    // image host being briefly unavailable.
    const user = await testPrisma().user.findFirst({
      where: { OR: [{ phone: APPLICANT.phone }, { email: APPLICANT.email }] },
    });
    expect(user).toBeNull();

    // No orphaned assets either. These are NID scans in an account with no
    // export (DATA-06), so an orphan is a document nobody can find and nobody
    // can delete.
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
});
