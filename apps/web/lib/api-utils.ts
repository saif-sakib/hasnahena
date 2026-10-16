/** Shared utilities for API routes. */
import crypto from 'crypto';

/** A money column as Prisma (bigint), a test (number), or an unselected column. */
type MoneyValue = bigint | number | null | undefined;

/** Whole taka as a JSON number. `!= null`, never truthiness — 0n is falsy (WO-61). */
function toJsonMoney(value: MoneyValue): number | null {
  return value == null ? null : Number(value);
}

type Serialized<T, K extends string> = Omit<T, K> & { [P in K]: number | null };

function serializeMoneyFields<T extends object, K extends string>(
  record: T,
  fields: readonly K[],
): Serialized<T, K> {
  const out: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const field of fields) {
    out[field] = toJsonMoney((record as Record<string, unknown>)[field] as MoneyValue);
  }
  return out as Serialized<T, K>;
}

const TRANSACTION_MONEY_FIELDS = [
  'amount',
  'balanceAfter',
  'savingsAfter',
  'loanAfter',
  'disputeCorrectAmount',
] as const;

const LOAN_MONEY_FIELDS = [
  'principalAmount',
  'remainingAmount',
  'installmentAmount',
  'applicationFee',
  'totalPaid',
  'amount',
  'monthlyInstallment',
] as const;

/**
 * BigInt columns to numbers for JSON — JSON.stringify throws on BigInt, which
 * answers 500 AFTER the write committed (WO-57).
 */
export function serializeTransaction<T extends object>(tx: T) {
  return serializeMoneyFields(tx, TRANSACTION_MONEY_FIELDS);
}

/** Serialize loan data for a JSON response. */
export function serializeLoan<T extends object>(loan: T) {
  return serializeMoneyFields(loan, LOAN_MONEY_FIELDS);
}

/** No I, l, 1, O or 0 (read aloud). Matches tempPasswordAlphabet in the Go API. */
export const TEMPORARY_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';

/** A secure temporary password; randomInt is uniform, unlike `byte % length` (WO-65). */
export function generateTemporaryPassword(): string {
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += TEMPORARY_PASSWORD_ALPHABET[crypto.randomInt(TEMPORARY_PASSWORD_ALPHABET.length)];
  }
  return out;
}
