import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, locale: string = 'en') {
  const normalizedAmount = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(normalizedAmount);
}

export function formatDate(date: string | Date, locale: string = 'en') {
  return new Date(date).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Whole taka, or nothing (rule 1).
 *
 * The one parser every amount box on a money form goes through. It returns null
 * for anything that is not a positive whole number — it does **not** round.
 *
 * Rounding is the failure this replaced. Three screens ran
 * `Math.round(Number.parseFloat(value))`, so a worker who typed 1500.75 posted
 * 1501 and was told it worked. Silently changing an amount somebody said out
 * loud is the one thing a money form must not do, and it cannot be caught
 * afterwards: the ledger, the receipt and the audit row all agree on the wrong
 * figure. Pair it with `step="1"` on the input so the control does not invite
 * the paisa in the first place.
 */
export function parseWholeTaka(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Weekly/monthly/full quick-fill amounts for loan repayment (installmentAmount
 * is per month).
 *
 * Every figure here is whole taka (rule 1). These write into an amount box the
 * member submits, and the screens round again on the way out — so a fractional
 * preset would show one number and post another. WO-56.
 */
export function getLoanRepaymentPresets(installmentAmount: number, remainingAmount: number) {
  const wholeTaka = (amount: number) => (Number.isFinite(amount) ? Math.max(Math.trunc(amount), 0) : 0);

  const remaining = wholeTaka(remainingAmount);
  const monthly = wholeTaka(installmentAmount);

  return {
    weekly: Math.min(Math.round(monthly / 4), remaining),
    monthly: Math.min(monthly, remaining),
    full: remaining,
  };
}

/**
 * Decodes a base64url-encoded string (browser-compatible using atob)
 */
export function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(`${normalized}${padding}`);
}

/**
 * Parses JWT payload without verification (for client-side use only)
 */
export function parseJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const payloadRaw = decodeBase64Url(parts[1]);
    return JSON.parse(payloadRaw) as T;
  } catch {
    return null;
  }
}

/**
 * Checks if a JWT token is expired
 */
export function isJwtExpired(token: string): boolean {
  const payload = parseJwtPayload<{ exp?: number }>(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return Math.floor(Date.now() / 1000) >= payload.exp;
}
