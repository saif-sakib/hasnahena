import { describe, it, expect } from 'vitest';
import { serializeTransaction, serializeLoan, generateTemporaryPassword } from './api-utils';

// WO-61. Both serialisers used a truthiness guard on a BigInt:
//
//   amount: tx.amount ? Number(tx.amount) : null
//
// `BigInt(0)` is falsy, so every legitimate zero became `null`. A fully repaid
// loan reported `remainingAmount: null`; a withdrawal that emptied an account
// reported `savingsAfter: null` — and `savingsAfter` exists so the printed
// passbook can show a running balance. A blank is not a balance.

const TRANSACTION_MONEY = ['amount', 'balanceAfter', 'savingsAfter', 'loanAfter', 'disputeCorrectAmount'] as const;
const LOAN_MONEY = [
  'principalAmount',
  'remainingAmount',
  'installmentAmount',
  'applicationFee',
  'totalPaid',
  'amount',
  'monthlyInstallment',
] as const;

const zeroed = (fields: readonly string[]) =>
  Object.fromEntries(fields.map((f) => [f, BigInt(0)])) as Record<string, bigint>;

describe('serializeTransaction', () => {
  it('keeps a zero a zero', () => {
    const out = serializeTransaction({ id: 'txn-1', ...zeroed(TRANSACTION_MONEY) });
    for (const field of TRANSACTION_MONEY) {
      expect(out[field], `${field} of a zero transaction`).toBe(0);
    }
  });

  it('converts a BigInt to a number', () => {
    const out = serializeTransaction({
      id: 'txn-2',
      amount: BigInt(50_000),
      savingsAfter: BigInt(0),
      loanAfter: BigInt(1),
    });
    expect(out.amount).toBe(50_000);
    expect(out.savingsAfter).toBe(0);
    expect(out.loanAfter).toBe(1);
  });

  it('reports a field that was never set as null, not NaN', () => {
    const out = serializeTransaction({ id: 'txn-3' });
    for (const field of TRANSACTION_MONEY) {
      expect(out[field], `${field} when absent`).toBeNull();
    }
  });

  it('survives JSON.stringify — the whole reason it exists (WO-57)', () => {
    const out = serializeTransaction({
      id: 'txn-4',
      status: 'DISPUTED',
      createdAt: new Date('2026-08-18T00:00:00Z'),
      amount: BigInt(0),
    });
    expect(() => JSON.stringify(out)).not.toThrow();
    expect(JSON.parse(JSON.stringify(out))).toMatchObject({ id: 'txn-4', status: 'DISPUTED', amount: 0 });
  });

  it('leaves everything that is not money alone', () => {
    const created = new Date('2026-08-18T00:00:00Z');
    const out = serializeTransaction({
      id: 'txn-5',
      type: 'WITHDRAWAL',
      disputeReason: 'wrong amount',
      createdAt: created,
      amount: BigInt(7),
    });
    expect(out.type).toBe('WITHDRAWAL');
    expect(out.disputeReason).toBe('wrong amount');
    expect(out.createdAt).toBe(created);
  });
});

describe('serializeLoan', () => {
  it('keeps a zero a zero', () => {
    const out = serializeLoan({ id: 'loan-1', ...zeroed(LOAN_MONEY) });
    for (const field of LOAN_MONEY) {
      expect(out[field], `${field} of a settled loan`).toBe(0);
    }
  });

  it('reports a repaid loan as repaid rather than unknown', () => {
    const out = serializeLoan({
      id: 'loan-2',
      loanNumber: 'LN-0001',
      principalAmount: BigInt(50_000),
      totalPaid: BigInt(50_000),
      remainingAmount: BigInt(0),
      // Zero interest, zero fees — a real loan has this at 0 (rule 3).
      applicationFee: BigInt(0),
    });
    expect(out.remainingAmount).toBe(0);
    expect(out.applicationFee).toBe(0);
    expect(out.loanNumber).toBe('LN-0001');
  });

  it('reports a field that was never set as null, not NaN', () => {
    const out = serializeLoan({ id: 'loan-3' });
    for (const field of LOAN_MONEY) {
      expect(out[field], `${field} when absent`).toBeNull();
    }
  });
});

describe('generateTemporaryPassword', () => {
  it('is twelve characters from the intended alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(12);
      expect(password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%]+$/);
    }
  });
});
