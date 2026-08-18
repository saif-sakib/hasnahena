/**
 * Shared utilities for API routes
 */
import crypto from 'crypto';

/**
 * What a money column can arrive as. Prisma hands back `bigint`; a hand-built
 * object in a test or a legacy caller may hand back a `number`; a column the
 * query did not select is `undefined`.
 */
type MoneyValue = bigint | number | null | undefined;

/**
 * Whole taka as a JSON number, or `null` when there is genuinely no figure.
 *
 * `!= null`, never truthiness: `BigInt(0)` is falsy, so a truthiness guard
 * turns every legitimate zero into `null` — a repaid loan with no
 * `remainingAmount`, a passbook line with no balance after it (WO-61).
 */
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
 * Convert a transaction's BigInt columns to numbers for JSON serialization.
 *
 * Not optional politeness: `NextResponse.json` calls `JSON.stringify`, which
 * throws on a BigInt. A route returning a raw Prisma transaction answers 500
 * *after* committing its write — which is how a member came to be told their
 * dispute had failed while it was being recorded (WO-57).
 */
export function serializeTransaction<T extends object>(tx: T) {
  return serializeMoneyFields(tx, TRANSACTION_MONEY_FIELDS);
}

/**
 * Serialize loan data for JSON response
 */
export function serializeLoan<T extends object>(loan: T) {
  return serializeMoneyFields(loan, LOAN_MONEY_FIELDS);
}

/**
 * Generate a secure temporary password
 */
export function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
}
