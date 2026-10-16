// Block Y — identity integrity (needs a database; skips without one):
//   WO-90  one contact = one account, case-insensitively; a collision is a named 409
//   WO-91  dismissing a worker revokes their token immediately
//   WO-92  a notification belongs to a user and goes with them
//   WO-93  erasure keeps the money and the decision, loses the person (FR-23, ADR-033)

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');

import {
  routeRequest,
  readBody,
  seedRoleUsers,
  tokenFor,
  mintToken,
  testPrisma,
  hasTestDatabase,
  disconnectTestPrisma,
  TEST_JWT_SECRET,
} from '../route-harness';

import * as adminWorkers from '@/app/api/v1/admin/workers/route';
import * as adminMemberErase from '@/app/api/v1/admin/members/[id]/erase/route';
import * as auditLogs from '@/app/api/v1/admin/audit-logs/route';
import { revocationMarker, revocationTtlSeconds } from '@/lib/auth-revocation';
import { PENDING_APPROVAL_PASSWORD_HASH } from '@/lib/rejected-application';

const skip = !hasTestDatabase();

/** Namespaced to this suite (the database is shared with every Go suite). */
const NS = 'blocky-';
const EMAIL_DOMAIN = '@blocky.test';
const phone = (n: number) => `019333000${String(n).padStart(2, '0')}`;

const db = () => testPrisma();

/** Everything this suite creates, by the two shapes it creates them in. */
async function cleanup(): Promise<void> {
  await db().tokenBlacklist.deleteMany({ where: { userId: { startsWith: NS } } });
  await db().loan.deleteMany({ where: { OR: [{ borrowerId: { startsWith: NS } }, { guarantorId: { startsWith: NS } }] } });
  await db().transaction.deleteMany({ where: { userId: { startsWith: NS } } });
  await db().notification.deleteMany({ where: { targetUserId: { startsWith: NS } } });
  await db().passwordResetToken.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  await db().user.deleteMany({ where: { id: { startsWith: NS } } });
  // Workers created *through the route* get a cuid, so they are found by their
  // address instead. `token_blacklist` rows for them are keyed on that id.
  const created = await db().user.findMany({
    where: { email: { endsWith: EMAIL_DOMAIN } },
    select: { id: true },
  });
  if (created.length) {
    const ids = created.map((u) => u.id);
    await db().tokenBlacklist.deleteMany({ where: { userId: { in: ids } } });
    await db().user.deleteMany({ where: { id: { in: ids } } });
  }
  // audit_logs is append-only (DATA-08): rows written by these tests stay, and
  // nothing here counts them.
}

/** A worker row this suite owns, with a live token for it. */
async function seedWorker(suffix: string, n: number): Promise<{ id: string; token: string }> {
  const id = `${NS}${suffix}`;
  await db().user.upsert({
    where: { id },
    update: { status: 'ACTIVE', role: 'WORKER' },
    create: {
      id,
      phone: phone(n),
      email: `${id}${EMAIL_DOMAIN}`,
      passwordHash: 'x-not-a-valid-bcrypt-hash',
      role: 'WORKER',
      status: 'ACTIVE',
      accountNo: `BY-${suffix}`,
      nameEn: `Block Y ${suffix}`,
      fatherName: '-',
      motherName: '-',
    },
  });
  // A minute ago: same-second tokens deliberately survive revocation (first login).
  const issuedAtSeconds = Math.floor(Date.now() / 1000) - 60;
  return { id, token: mintToken({ sub: id, role: 'WORKER', issuedAtSeconds }) };
}

/** Probe via audit-logs: 403 = session alive (role refused), 401 = revoked. */
async function sessionStatus(token: string): Promise<number> {
  const res = await auditLogs.GET(routeRequest('/api/v1/admin/audit-logs', { token }));
  return res.status;
}
const SESSION_LIVE = 403;
const SESSION_REVOKED = 401;

describe.skipIf(skip)('Block Y — identity and deletion integrity', () => {
  let adminToken = '';

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    await seedRoleUsers();
    adminToken = tokenFor('ADMIN');

    // Stub the Go welcome-email call; a create treats its failure as fatal.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  beforeEach(cleanup);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await cleanup();
    await disconnectTestPrisma();
  });

  // -------------------------------------------------------------------------
  // WO-90 — one contact is one account
  // -------------------------------------------------------------------------

  describe('WO-90 — email uniqueness is the database\'s job', () => {
    it('refuses two accounts whose email addresses differ only in case', async () => {
      await seedWorker('case-a', 11);

      // Deliberately NOT through the route (which lowercases): imitates a seed,
      // migration or manual fix.
      const collide = db().user.create({
        data: {
          id: `${NS}case-b`,
          phone: phone(12),
          email: `${NS}CASE-A${EMAIL_DOMAIN.toUpperCase()}`,
          passwordHash: 'x-not-a-valid-bcrypt-hash',
          role: 'WORKER',
          status: 'ACTIVE',
          accountNo: 'BY-case-b',
          nameEn: 'Block Y case b',
          fatherName: '-',
          motherName: '-',
        },
      });

      await expect(
        collide,
        'Without the unique index on lower(email) these are two rows: two ' +
          'accounts, two savings balances, one person — and nothing ever says so.',
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('answers a case-only collision with 409 and names the field', async () => {
      await seedWorker('taken', 13);

      const res = await adminWorkers.POST(
        routeRequest('/api/v1/admin/workers', {
          token: adminToken,
          method: 'POST',
          body: {
            name: 'Someone Else',
            email: `${NS}TAKEN${EMAIL_DOMAIN.toUpperCase()}`,
            phone: phone(14),
          },
        }),
      );
      const { status, json } = await readBody(res);

      expect(status).toBe(409);
      expect(
        String((json as { error?: string })?.error ?? ''),
        'An admin told that "email/phone" is taken, without being told which, ' +
          'has to guess which of the two to change.',
      ).toMatch(/email address/i);
    });

    it('names the phone number when that is what collided', async () => {
      await seedWorker('phone-taken', 15);

      const res = await adminWorkers.POST(
        routeRequest('/api/v1/admin/workers', {
          token: adminToken,
          method: 'POST',
          body: { name: 'Someone Else', email: `fresh${EMAIL_DOMAIN}`, phone: phone(15) },
        }),
      );
      const { status, json } = await readBody(res);

      expect(status).toBe(409);
      expect(String((json as { error?: string })?.error ?? '')).toMatch(/phone number/i);
    });

    /**
     * Apply, be rejected, then be hired: a rejected application owns nothing, so
     * the pre-check must not be stricter than the partial unique indexes.
     */
    it('lets a rejected applicant be hired with their own email and phone', async () => {
      const email = `${NS}rejected-then-hired${EMAIL_DOMAIN}`;
      const theirPhone = phone(21);

      // A refused application as rejection leaves it.
      await db().user.create({
        data: {
          id: `${NS}refused`,
          email,
          phone: theirPhone,
          passwordHash: PENDING_APPROVAL_PASSWORD_HASH,
          role: 'MEMBER',
          status: 'INACTIVE',
          approvedAt: null,
          nameEn: 'Refused Applicant',
          fatherName: 'N/A',
          motherName: 'N/A',
          accountNo: `${NS}ACC-REJ-21`,
          rejectionReasonCode: 'UNCLEAR_DOCUMENTS',
          rejectedAt: new Date(),
        },
      });

      const res = await adminWorkers.POST(
        routeRequest('/api/v1/admin/workers', {
          token: adminToken,
          method: 'POST',
          body: { name: 'Now A Field Worker', email, phone: theirPhone },
        }),
      );
      const { status, json } = await readBody(res);

      expect(
        status,
        'A refused applicant cannot be hired: staff creation refused their own email and ' +
          `phone, which no live row holds. Response: ${JSON.stringify(json)}`,
      ).toBe(200);

      // Both exist; only one is live.
      const rows = await db().user.findMany({
        where: { email },
        select: { role: true, status: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => `${r.role}/${r.status}`)).toEqual([
        'MEMBER/INACTIVE',
        'WORKER/ACTIVE',
      ]);
    });

    /**
     * A DEACTIVATED member (real hash, approvedAt) keeps their identifiers — hence
     * NOT(all four conjuncts), not `status <> 'INACTIVE'`.
     */
    it('still refuses a contact that a deactivated member holds', async () => {
      const email = `${NS}deactivated${EMAIL_DOMAIN}`;
      await db().user.create({
        data: {
          id: `${NS}deactivated`,
          email,
          phone: phone(22),
          passwordHash: 'a-real-bcrypt-hash-would-be-here',
          role: 'MEMBER',
          status: 'INACTIVE',
          approvedAt: new Date(),
          nameEn: 'Former Member',
          fatherName: 'N/A',
          motherName: 'N/A',
          accountNo: `${NS}ACC-DEACT-22`,
        },
      });

      const res = await adminWorkers.POST(
        routeRequest('/api/v1/admin/workers', {
          token: adminToken,
          method: 'POST',
          body: { name: 'Impostor', email, phone: phone(23) },
        }),
      );
      const { status } = await readBody(res);
      expect(
        status,
        'a deactivated member still owns their email — freeing it gives their history away',
      ).toBe(409);
    });

    it('gives two admins adding the same worker at once one success and one 409, never a 500', async () => {
      const body = {
        name: 'Race Worker',
        email: `race${EMAIL_DOMAIN}`,
        phone: phone(16),
      };
      const post = () =>
        adminWorkers.POST(
          routeRequest('/api/v1/admin/workers', { token: adminToken, method: 'POST', body }),
        );

      // Concurrent creates: the loser gets 409 either via P2002 or the pre-check.
      const [a, b] = await Promise.all([post(), post()]);
      const statuses = [a.status, b.status].sort();

      expect(
        statuses,
        'A duplicate is the caller\'s problem (409), not a server fault (500). ' +
          'A 500 here also fires a monitoring alert no operator can act on.',
      ).toEqual([200, 409]);

      const created = await db().user.count({ where: { email: body.email } });
      expect(created).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // WO-91 — dismissal ends the session
  // -------------------------------------------------------------------------

  describe('WO-91 — a dismissed worker stops being staff immediately', () => {
    /** The marker both backends check, and the shape they both must write. */
    async function markerFor(userId: string) {
      return db().tokenBlacklist.findUnique({
        where: { tokenHash: revocationMarker(userId) },
        select: { userId: true, reason: true, expiresAt: true, createdAt: true },
      });
    }

    it('revokes every session when a worker is deactivated', async () => {
      const worker = await seedWorker('deactivate', 21);
      expect(await sessionStatus(worker.token)).toBe(SESSION_LIVE);

      const res = await adminWorkers.PATCH(
        routeRequest('/api/v1/admin/workers', {
          token: adminToken,
          method: 'PATCH',
          body: { id: worker.id, status: 'INACTIVE' },
        }),
      );
      expect(res.status).toBe(200);

      const marker = await markerFor(worker.id);
      expect(marker, 'no revocation marker was written').not.toBeNull();
      expect(marker!.reason).toBe('admin_revoke');
      expect(
        await sessionStatus(worker.token),
        'A deactivated worker kept a working staff token — able to post ' +
          'deposits and process withdrawals — until it expired, up to a day later.',
      ).toBe(SESSION_REVOKED);
    });

    it('leaves the marker alive longer than any token it revokes', async () => {
      const worker = await seedWorker('ttl', 22);
      await adminWorkers.PATCH(
        routeRequest('/api/v1/admin/workers', {
          token: adminToken,
          method: 'PATCH',
          body: { id: worker.id, status: 'INACTIVE' },
        }),
      );

      const marker = await markerFor(worker.id);
      const lifetimeSeconds = (marker!.expiresAt.getTime() - marker!.createdAt.getTime()) / 1000;

      // The marker lifetime is derived from JWT_EXPIRY_SECONDS (WO-85).
      expect(lifetimeSeconds).toBeGreaterThanOrEqual(revocationTtlSeconds() - 5);
      expect(lifetimeSeconds).toBeLessThanOrEqual(revocationTtlSeconds() + 5);
    });

    it('revokes the session of a worker who is archived rather than deleted', async () => {
      const worker = await seedWorker('archive', 23);
      // The branch that runs for every worker who has ever done the job. Any
      // reference will do; an approval is the cheapest to arrange.
      await db().user.update({
        where: { id: 'nextroute-member' },
        data: { approvedBy: worker.id },
      });

      try {
        const res = await adminWorkers.DELETE(
          routeRequest(`/api/v1/admin/workers?id=${worker.id}`, {
            token: adminToken,
            method: 'DELETE',
          }),
        );
        const { status, json } = await readBody(res);
        expect(status).toBe(200);
        expect((json as { data?: { archived?: boolean } })?.data?.archived).toBe(true);

        expect(await markerFor(worker.id)).not.toBeNull();
        expect(
          await sessionStatus(worker.token),
          'Archiving is the branch that runs for any worker who has processed a ' +
            'transaction — which is every real worker — and it only set INACTIVE.',
        ).toBe(SESSION_REVOKED);
      } finally {
        await db().user.update({ where: { id: 'nextroute-member' }, data: { approvedBy: null } });
      }
    });

    it('revokes the session of a worker who is deleted outright', async () => {
      const worker = await seedWorker('delete', 24);
      expect(await sessionStatus(worker.token)).toBe(SESSION_LIVE);

      const res = await adminWorkers.DELETE(
        routeRequest(`/api/v1/admin/workers?id=${worker.id}`, {
          token: adminToken,
          method: 'DELETE',
        }),
      );
      expect(res.status).toBe(200);
      expect(await db().user.findUnique({ where: { id: worker.id } })).toBeNull();

      // Deleting the row is not revocation — tokens are never checked against users.
      expect(await sessionStatus(worker.token)).toBe(SESSION_REVOKED);
    });

    it('does not revoke anything when a worker is re-activated', async () => {
      const worker = await seedWorker('reactivate', 25);
      const res = await adminWorkers.PATCH(
        routeRequest('/api/v1/admin/workers', {
          token: adminToken,
          method: 'PATCH',
          body: { id: worker.id, status: 'ACTIVE' },
        }),
      );
      expect(res.status).toBe(200);
      expect(
        await markerFor(worker.id),
        'Revoking on the way back in would end the sessions of the admin doing ' +
          'the re-activation nothing, and of the worker everything — for an ' +
          'event that grants access rather than withdrawing it.',
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // WO-92 — a notification belongs to a user
  // -------------------------------------------------------------------------

  describe('WO-92 — notifications.targetUserId is a foreign key', () => {
    it('takes a member\'s notifications with them when the member goes', async () => {
      const worker = await seedWorker('cascade', 31);
      await db().notification.create({
        data: {
          type: 'SYSTEM_ALERT',
          title: 'Block Y',
          message: 'cascade',
          targetUserId: worker.id,
        },
      });

      await db().user.delete({ where: { id: worker.id } });

      expect(
        await db().notification.count({ where: { targetUserId: worker.id } }),
        'Notifications were cleaned up by hand in exactly one place — the ' +
          'worker DELETE — and left behind by every other deletion path.',
      ).toBe(0);
    });

    it('refuses a notification addressed to a user who does not exist', async () => {
      await expect(
        db().notification.create({
          data: {
            type: 'SYSTEM_ALERT',
            title: 'Block Y',
            message: 'orphan',
            targetUserId: `${NS}nobody-at-all`,
          },
        }),
        'A notification is read *by target id*, so an id that names nobody is ' +
          'waste and an id that is re-used delivers one member\'s balance and ' +
          'loan detail to another member\'s bell icon.',
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('still allows a notification addressed to a whole role', async () => {
      // targetUserId stays nullable (role-wide notifications).
      const created = await db().notification.create({
        data: {
          type: 'NEW_REGISTRATION',
          title: 'Block Y',
          message: 'role-wide',
          targetRole: 'WORKER',
        },
        select: { id: true },
      });
      await db().notification.delete({ where: { id: created.id } });
    });
  });

  // -------------------------------------------------------------------------
  // WO-93 — a member can be erased
  // -------------------------------------------------------------------------

  describe('ADR-043/044 — a rename does not rewrite the trail', () => {
    /**
     * Pre-admission audit rows keep the APP- id (append-only); the reader
     * resolves them via users.formNumber (ADR-044).
     */
    const OLD_ID = 'APP-2026-096001';
    const NEW_ID = `${NS}rename-new`;

    beforeEach(async () => {
      await db().auditLog.deleteMany({ where: { entityId: { in: [OLD_ID, NEW_ID] } } }).catch(() => {});
      await db().user.deleteMany({ where: { id: NEW_ID } });
    });

    it('still names the person on a row written under their old id', async () => {
      await db().user.create({
        data: {
          id: NEW_ID,
          phone: phone(61),
          email: `${NS}rename${EMAIL_DOMAIN}`,
          passwordHash: 'x-not-a-valid-bcrypt-hash',
          role: 'MEMBER',
          status: 'ACTIVE',
          accountNo: 'ACC-KH-96001',
          formNumber: OLD_ID,
          nameEn: 'Renamed Member',
          fatherName: 'F',
          motherName: 'M',
        },
      });
      await db().auditLog.create({
        data: {
          action: 'APPROVE_REGISTRATION',
          entityType: 'USER',
          entityId: OLD_ID,
          details: 'approved during the rename test',
        },
      });

      const res = await auditLogs.GET(
        routeRequest('/api/v1/admin/audit-logs?q=ACC-KH-96001', { token: adminToken }),
      );
      const { status, json } = await readBody(res);
      expect(status).toBe(200);
      const rows = (json as { data: Array<{ entityId: string; subject: { label: string } | null }> }).data;

      // Found by the *new* account number even though the row holds the old id:
      // admission must not be a hole in a member's own history.
      const row = rows.find((r) => r.entityId === OLD_ID);
      expect(row, 'searching the account number must reach rows written before admission')
        .toBeTruthy();
      expect(row?.subject?.label).toContain('Renamed Member');
      expect(row?.subject?.label).toContain('ACC-KH-96001');
    });

    it('leaves the audit row itself byte-identical', async () => {
      // The whole point. If a future change reaches for an UPDATE here, the
      // database refuses it — this asserts nothing has taught itself to ask.
      await expect(
        db().auditLog.updateMany({ where: { entityType: 'USER' }, data: { entityId: 'anything' } }),
      ).rejects.toThrow(/append-only/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('WO-93 — erasure keeps the money and loses the person', () => {
    /** A member with an account, and optionally the history that decides the outcome. */
    async function seedMember(
      suffix: string,
      n: number,
      opts: { posting?: boolean; documents?: number } = {},
    ) {
      const id = `${NS}${suffix}`;
      const accountNo = `ACC-KH-9${String(n).padStart(4, '0')}`;
      await db().user.create({
        data: {
          id,
          phone: phone(n),
          email: `${id}${EMAIL_DOMAIN}`,
          passwordHash: 'x-not-a-valid-bcrypt-hash',
          role: 'MEMBER',
          status: 'ACTIVE',
          accountNo,
          nameEn: `Block Y ${suffix}`,
          nameBn: 'ব্লক ওয়াই',
          fatherName: 'Father Name',
          motherName: 'Mother Name',
          // Distinct per member (users_nid_live_key).
          nidNumber: `19901${String(n).padStart(8, '0')}`,
          bloodGroup: 'B+',
          profession: 'Farmer',
          gender: 'FEMALE',
          maritalStatus: 'MARRIED',
          childrenCount: 3,
          preferredLocale: 'bn',
          approvedAt: new Date(),
          account: { create: { savingsBalance: BigInt(50000), loanBalance: BigInt(0) } },
          addresses: {
            create: [{
              type: 'PERMANENT',
              houseNo: '12', village: 'Bhekutia', union: 'Kotwali',
              policeStation: 'Kotwali', district: 'Jessore',
            }],
          },
          nominee: { create: { name: 'Nominee', relationship: 'Brother', nidNumber: '1990987654321', phone: phone(n + 40) } },
        },
      });
      // The support conversation must not survive erasure.
      const thread = await db().supportThread.create({
        data: {
          id: `${id}-thread`,
          memberUserId: id,
          status: 'OPEN',
          deleteAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      });
      await db().supportMessage.create({
        data: {
          id: `${id}-msg`,
          threadId: thread.id,
          senderUserId: id,
          message: 'My husband lost his job last month.',
        },
      });

      if (opts.posting) {
        await db().transaction.create({
          data: {
            // The id IS the receipt number (ADR-044). There is no default, so
            // every writer names one — including this fixture.
            id: `DEP-2026-9${String(n).padStart(5, '0')}`,
            type: 'DEPOSIT',
            amount: BigInt(50000),
            status: 'CONFIRMED',
            userId: id,
          },
        });
      }
      // At most one of each type: `(userId, type)` is the key (ADR-044).
      const DOC_TYPES = ['nid_front', 'nid_back', 'passport_photo', 'nominee_photo'];
      for (let i = 0; i < (opts.documents ?? 0); i += 1) {
        await db().document.create({
          data: {
            type: DOC_TYPES[i % DOC_TYPES.length],
            // Not a Cloudinary host, so the asset loop runs without credentials.
            url: `https://example.test/${id}-${i}.jpg`,
            fileName: `${id}-${i}.jpg`,
            mimeType: 'image/jpeg',
            size: 1024,
            userId: id,
          },
        });
      }

      const issuedAtSeconds = Math.floor(Date.now() / 1000) - 60;
      return {
        id,
        accountNo,
        token: mintToken({ sub: id, role: 'MEMBER', issuedAtSeconds }),
      };
    }

    async function erase(id: string, body: Record<string, unknown>) {
      const res = await adminMemberErase.POST(
        routeRequest(`/api/v1/admin/members/${id}/erase`, {
          token: adminToken,
          method: 'POST',
          body,
        }),
        { params: Promise.resolve({ id }) },
      );
      return readBody(res);
    }

    it('anonymises a member who has postings, and keeps every posting', async () => {
      const m = await seedMember('erase-anon', 41, { posting: true, documents: 2 });

      const { status, json } = await erase(m.id, {
        confirmAccountNo: m.accountNo,
        reason: 'member asked through the support thread',
      });
      expect(status).toBe(200);
      const data = (json as { data: { anonymised: boolean; assets: { found: number } } }).data;
      expect(data.anonymised).toBe(true);
      expect(data.assets.found).toBe(2);

      const after = await db().user.findUniqueOrThrow({
        where: { id: m.id },
        select: {
          nidNumber: true, nameBn: true, bloodGroup: true, profession: true,
          fatherName: true, motherName: true, nameEn: true, email: true,
          phone: true, status: true, accountNo: true,
        },
      });
      expect(after.nidNumber).toBeNull();
      expect(after.nameBn).toBeNull();
      expect(after.bloodGroup).toBeNull();
      expect(after.profession).toBeNull();
      expect(after.fatherName).toBe('');
      expect(after.motherName).toBe('');
      expect(after.email).toBeNull();
      expect(after.phone.startsWith('erased-')).toBe(true);
      expect(after.status).toBe('INACTIVE');

      // The money. A posting whose owner has vanished does not make the hourly
      // reconciliation smaller — it makes it permanently wrong (ADR-027).
      expect(after.accountNo).toBe(m.accountNo);
      const account = await db().account.findUniqueOrThrow({
        where: { userId: m.id },
        select: { savingsBalance: true },
      });
      expect(account.savingsBalance).toBe(BigInt(50000));
      expect(await db().transaction.count({ where: { userId: m.id } })).toBe(1);

      // The person.
      expect(await db().document.count({ where: { userId: m.id } })).toBe(0);
      expect(await db().nominee.count({ where: { userId: m.id } })).toBe(0);
      expect(
        await db().address.count({ where: { userId: m.id } }),
      ).toBe(0);
      expect(await db().supportThread.count({ where: { memberUserId: m.id } })).toBe(0);
      expect(await db().supportMessage.count({ where: { senderUserId: m.id } })).toBe(0);

      // The less obvious personal facts are reset too (enums to their default).
      const rest = await db().user.findUniqueOrThrow({
        where: { id: m.id },
        select: {
          gender: true, maritalStatus: true, childrenCount: true,
          preferredLocale: true, assignedBranchId: true, avatarUrl: true,
          dateOfBirth: true, formNumber: true,
        },
      });
      expect(rest).toEqual({
        gender: 'MALE',
        maritalStatus: 'UNMARRIED',
        childrenCount: 0,
        preferredLocale: null,
        assignedBranchId: null,
        avatarUrl: null,
        dateOfBirth: null,
        formNumber: null,
      });
    });

    /**
     * Every column on `users`, enumerated: one neither cleared by the route nor
     * listed as a survivor fails here.
     */
    it('leaves nothing on the row that describes the person', () => {
      const schema = readFileSync(
        join(WEB_ROOT, 'prisma', 'schema.prisma'),
        'utf8',
      );
      const model = /model User \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? '';
      expect(model.length).toBeGreaterThan(200);

      const columns = [...model.matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9]*)\s+\S/gm)]
        .map((m) => m[1])
        // Relation fields and back-references are not columns.
        .filter((name) => !/^(addresses|nominee|account|transactions|processedTransactions|loans|guaranteedLoans|approvedLoans|documents|supportThreads|processedSupportThreads|supportMessages|sseTickets|notifications|assignedBranch|approvedByUser|approvedUsers)$/.test(name));

      /** Columns that survive an erasure on purpose, each for a stated reason. */
      const KEPT: Record<string, string> = {
        id: 'the primary key; every posting points at it',
        accountNo: 'the ledger still needs an owner, and this is all it needs (ADR-023)',
        nameEn: 'NOT NULL, and rewritten to "Erased member <accountNo>" — not the person',
        phone: 'NOT NULL and unique; tombstoned so the next holder of the number inherits nothing',
        passwordHash: 'unchanged and unusable — the revoke-all marker is what ends the session',
        role: 'MEMBER, which is what the row is',
        status: 'set to INACTIVE by the erasure; it is the erasure’s own state',
        createdAt: 'when the account existed from — a fact about the ledger, not the member',
        updatedAt: 'maintained by Prisma',
        approvedAt: 'when the account began. Kept for the same reason as createdAt',
        approvedBy: 'cleared by the route',
      };

      const route = readFileSync(
        join(WEB_ROOT, 'app', 'api', 'v1', 'admin', 'members', '[id]', 'erase', 'route.ts'),
        'utf8',
      );
      const scrub = route.slice(route.indexOf('await tx.user.update('));

      const unaccounted = columns.filter(
        (name) => !(name in KEPT) && !new RegExp(`^\\s+${name}:`, 'm').test(scrub),
      );
      expect(
        unaccounted,
        'these columns on `users` are neither cleared by the erasure nor listed as ' +
          'deliberate survivors. A column that describes the person must be cleared; ' +
          'one that describes the ledger belongs in KEPT with the reason written down',
      ).toEqual([]);
    });

    it('ends the erased member\'s session', async () => {
      const m = await seedMember('erase-session', 42, { posting: true });
      // A MEMBER token is authenticated and then refused for its role on the
      // audit-log endpoint, exactly like a worker's — so 403 still means live.
      expect(await sessionStatus(m.token)).toBe(SESSION_LIVE);

      await erase(m.id, { confirmAccountNo: m.accountNo, reason: 'requested' });

      expect(
        await sessionStatus(m.token),
        'A member whose identity has been removed but whose token still works ' +
          'is a live session belonging to an account that describes nobody.',
      ).toBe(SESSION_REVOKED);
    });

    it('writes nothing it erased into the append-only audit log', async () => {
      const m = await seedMember('erase-audit', 43, { posting: true });
      const before = await db().auditLog.count({ where: { entityId: m.id } });

      await erase(m.id, { confirmAccountNo: m.accountNo, reason: 'member request 2026-08-25' });

      // Asserted as a delta — audit_logs is append-only.
      expect(await db().auditLog.count({ where: { entityId: m.id } })).toBe(before + 1);
      const rows = await db().auditLog.findMany({
        where: { entityId: m.id, action: 'MEMBER_ERASED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { newValue: true, details: true },
      });
      expect(rows).toHaveLength(1);

      const written = JSON.stringify(rows[0]);
      // audit_logs cannot be deleted from (DATA-08), so a row that recorded what
      // it erased would be erasure that preserves what it erased.
      for (const secret of ['1990123456789', 'Father Name', 'Mother Name', 'Bhekutia', 'ব্লক ওয়াই']) {
        expect(written, `the audit row names ${secret}`).not.toContain(secret);
      }
      expect(written).toContain(m.accountNo);
    });

    it('deletes outright a member who never moved any money', async () => {
      const m = await seedMember('erase-delete', 44);

      const { status, json } = await erase(m.id, {
        confirmAccountNo: m.accountNo,
        reason: 'approved, never used',
      });
      expect(status).toBe(200);
      expect((json as { data: { deleted: boolean } }).data.deleted).toBe(true);

      expect(await db().user.findUnique({ where: { id: m.id } })).toBeNull();
      expect(await db().account.findUnique({ where: { userId: m.id } })).toBeNull();
    });

    it('refuses while the member owes a loan', async () => {
      const m = await seedMember('erase-borrower', 45, { posting: true });
      await db().loan.create({
        data: {
          id: `LOAN-2026-09${45}`,
          principalAmount: BigInt(20000),
          remainingAmount: BigInt(20000),
          totalInstallments: 10,
          installmentAmount: BigInt(2000),
          status: 'ACTIVE',
          borrowerId: m.id,
        },
      });

      const { status, json } = await erase(m.id, {
        confirmAccountNo: m.accountNo,
        reason: 'requested',
      });
      expect(status).toBe(409);
      expect(String((json as { error?: string }).error)).toMatch(/not settled/i);
      // A refusal is an answer, not a fault — and it must change nothing.
      const after = await db().user.findUniqueOrThrow({
        where: { id: m.id },
        select: { nidNumber: true },
      });
      expect(after.nidNumber).not.toBeNull();
    });

    it('refuses while the member guarantees somebody else\'s loan', async () => {
      const borrower = await seedMember('erase-other', 46, { posting: true });
      const guarantor = await seedMember('erase-guarantor', 47, { posting: true });
      await db().loan.create({
        data: {
          id: `LOAN-2026-09${47}`,
          principalAmount: BigInt(20000),
          remainingAmount: BigInt(20000),
          totalInstallments: 10,
          installmentAmount: BigInt(2000),
          status: 'ACTIVE',
          borrowerId: borrower.id,
          guarantorId: guarantor.id,
        },
      });

      const { status, json } = await erase(guarantor.id, {
        confirmAccountNo: guarantor.accountNo,
        reason: 'requested',
      });
      expect(status).toBe(409);
      expect(String((json as { error?: string }).error)).toMatch(/guarantor/i);
    });

    it('refuses when the echoed account number is not this member\'s', async () => {
      const m = await seedMember('erase-mistyped', 48, { posting: true });

      const { status } = await erase(m.id, {
        confirmAccountNo: 'ACC-KH-00001',
        reason: 'requested',
      });
      expect(
        status,
        'Erasure is reached from a list and cannot be undone. Echoing the ' +
          'account number is the difference between erasing the member you ' +
          'meant and the one below them.',
      ).toBe(400);
      expect(await db().user.findUnique({ where: { id: m.id } })).not.toBeNull();
    });

    it('refuses to erase a worker here', async () => {
      const worker = await seedWorker('erase-worker', 49);
      const { status, json } = await erase(worker.id, {
        confirmAccountNo: 'BY-erase-worker',
        reason: 'wrong endpoint',
      });
      expect(status).toBe(400);
      expect(String((json as { error?: string }).error)).toMatch(/member accounts/i);
    });
  });
});