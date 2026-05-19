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
