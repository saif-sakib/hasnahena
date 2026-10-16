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
 * Whole taka, or null (rule 1). The one parser for every money amount box; it
 * never rounds — silently changing a spoken amount cannot be caught later.
 * Pair with `step="1"` on the input.
 */
export function parseWholeTaka(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Weekly/monthly/full quick-fill repayment amounts, whole taka (WO-56). */
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

/** Decode a base64url string (browser atob). */
export function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(`${normalized}${padding}`);
}

/** Parse a JWT payload WITHOUT verification (client-side display only). */
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

/** Whether a JWT is expired. */
export function isJwtExpired(token: string): boolean {
  const payload = parseJwtPayload<{ exp?: number }>(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return Math.floor(Date.now() / 1000) >= payload.exp;
}
