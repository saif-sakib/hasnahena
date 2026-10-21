// WO-57 — routes driven along their SUCCESS path (the contract suite only
// proves who may call them). Needs a database.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  routeRequest,
  readBody,
  seedRoleUsers,
  tokenFor,
  testPrisma,
  hasTestDatabase,
  disconnectTestPrisma,
  TEST_JWT_SECRET,
} from '../route-harness';

import * as dispute from '@/app/api/v1/member/transactions/[id]/dispute/route';

const skip = !hasTestDatabase();

/** Namespaced to this suite: the Go suites truncate between their own tests. */
const TXN_ID = 'success-path-txn';

const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(skip)('POST /api/v1/member/transactions/[id]/dispute — success', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    // The member's account exists and is keyed on the member (ADR-044), so
    // there is no id to look up before a posting can be written against them.
    await seedRoleUsers();
  });

  afterAll(async () => {
    await testPrisma().transaction.deleteMany({ where: { id: TXN_ID } });
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    // A settled posting the member says is wrong. `savingsAfter: 0` on purpose: it is a
    // legitimate zero, and the serialiser used to report it as null (WO-61).
    await testPrisma().transaction.upsert({
      where: { id: TXN_ID },
      update: {
        status: 'CONFIRMED',
        disputeReason: null,
        disputeCorrectAmount: null,
      },
      create: {
        id: TXN_ID,
        type: 'WITHDRAWAL',
        amount: BigInt(5000),
        status: 'CONFIRMED',
        savingsAfter: BigInt(0),
        loanAfter: BigInt(0),
        userId: 'nextroute-member',
      },
    });
  });

  const raise = async (body: unknown) =>
    readBody(
      await dispute.POST(
        routeRequest(`/api/v1/member/transactions/${TXN_ID}/dispute`, {
          token: tokenFor('MEMBER'),
          method: 'POST',
          body,
        }),
        context(TXN_ID),
      ),
    );

  it('answers 200 with the frozen transaction', async () => {
    const res = await raise({ reason: 'The amount is wrong — I withdrew 4,000, not 5,000.' });

    expect(res.status, `body: ${res.text}`).toBe(200);
    const body = res.json as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('DISPUTED');
    expect(body.data.amount).toBe(5000);
    // Not null. This is the passbook's running balance after the posting, and
    // "you had nothing left" is a fact the member is entitled to read back.
    expect(body.data.savingsAfter).toBe(0);
  });

  it('records the dispute in the database, which is what the member was told', async () => {
    await raise({ reason: 'This deposit was never mine.', correctAmount: 4000 });

    const row = await testPrisma().transaction.findUnique({ where: { id: TXN_ID } });
    expect(row?.status).toBe('DISPUTED');
    expect(row?.disputeReason).toBe('This deposit was never mine.');
    expect(row?.disputeCorrectAmount).toBe(BigInt(4000));

    const audit = await testPrisma().auditLog.findFirst({
      where: { entityId: TXN_ID, action: 'TRANSACTION_DISPUTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit, 'a dispute is the first step of a correction and must be traceable').not.toBeNull();
  });

  it('refuses a second dispute with 409, having accepted the first', async () => {
    expect((await raise({ reason: 'The amount is wrong.' })).status).toBe(200);
    const second = await raise({ reason: 'The amount is wrong.' });
    expect(second.status).toBe(409);
    expect((second.json as { error: string }).error).toBe('DISPUTE_ALREADY_RAISED');
  });

  it('refuses a negative correction — a member cannot owe a negative amount', async () => {
    const res = await raise({ reason: 'Wrong amount recorded.', correctAmount: -500 });
    expect(res.status, `body: ${res.text}`).toBe(400);

    const row = await testPrisma().transaction.findUnique({ where: { id: TXN_ID } });
    expect(row?.status, 'a rejected dispute must not freeze the transaction').toBe('CONFIRMED');
  });

  it('refuses a reason that is only whitespace', async () => {
    const res = await raise({ reason: '     ' });
    expect(res.status, `body: ${res.text}`).toBe(400);
  });

  it('refuses a correction too large to be an exact integer', async () => {
    const res = await raise({ reason: 'Wrong amount recorded.', correctAmount: 1e20 });
    expect(res.status, `body: ${res.text}`).toBe(400);
  });

  it('refuses a fractional correction — money is whole taka (rule 1)', async () => {
    const res = await raise({ reason: 'Wrong amount recorded.', correctAmount: 4000.5 });
    expect(res.status, `body: ${res.text}`).toBe(400);
  });

  // DISPUTED counts as money that moved (ADR-026). A PROCESSED withdrawal is only
  // ready at the desk — freezing it would make reconciliation count a payout
  // that never happened, and the desk could no longer settle the request.
  it('refuses to dispute a posting that moved no money', async () => {
    await testPrisma().transaction.update({ where: { id: TXN_ID }, data: { status: 'PROCESSED' } });

    const res = await raise({ reason: 'The amount is wrong.' });
    expect(res.status, `body: ${res.text}`).toBe(409);
    expect((res.json as { error: string }).error).toBe('NOT_DISPUTABLE');

    const row = await testPrisma().transaction.findUnique({ where: { id: TXN_ID } });
    expect(row?.status).toBe('PROCESSED');
  });
});

// ---------------------------------------------------------------------------
// The class of defect, not the instance
// ---------------------------------------------------------------------------

/**
 * Routes returning BigInt-model rows must serialise at the boundary —
 * JSON.stringify throws AFTER the write committed. No global toJSON polyfill.
 */
const BIGINT_MODELS = ['transaction', 'loan', 'account', 'documentSequence'];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function routeFiles(): string[] {
  const root = join(process.cwd(), 'app', 'api');
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'route.ts') found.push(full);
    }
  };
  walk(root);
  return found;
}

describe('no route returns a BigInt-bearing model without serialising it', () => {
  for (const file of routeFiles()) {
    const rel = file.slice(file.indexOf('app/api'));
    it(rel, () => {
      const source = stripComments(readFileSync(file, 'utf8'));

      // Variables holding a row from a model with BigInt columns.
      const carriers = new Set<string>();
      const assignment = new RegExp(
        `(?:const|let)\\s+(\\w+)\\s*=\\s*await\\s+prisma\\.(?:${BIGINT_MODELS.join('|')})\\.`,
        'g',
      );
      for (const match of source.matchAll(assignment)) carriers.add(match[1]);

      // The row itself as the payload — `json(row)` or `data: row` — and not
      // `data: serializeLoan(row)`, which is the fix rather than the defect.
      const returned = [...carriers].filter((name) =>
        new RegExp(`(?:data:\\s*|NextResponse\\.json\\(\\s*)${name}\\s*[,)}]`).test(source),
      );

      expect(
        returned,
        `${rel} returns ${returned.join(', ')} — a row with BigInt columns — directly. ` +
          'JSON.stringify throws on a BigInt, so this answers 500 after the write has committed. ' +
          'Use serializeTransaction/serializeLoan from lib/api-utils.ts.',
      ).toEqual([]);
    });
  }
});
