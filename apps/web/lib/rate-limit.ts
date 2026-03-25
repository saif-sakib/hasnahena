/**
 * In-memory rate limiting utility
 * For production, consider using Redis
 */

interface RateLimitRecord {
  attempts: number;
  lockedUntil: number;
}

const LOCKOUT_DURATION_MS = 30 * 1000; // 30 seconds
const MAX_ATTEMPTS = 5;

const rateLimitStore = new Map<string, RateLimitRecord>();

export function checkRateLimit(key: string): { allowed: boolean; remainingTime?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (record) {
    if (record.lockedUntil > now) {
      return { allowed: false, remainingTime: Math.ceil((record.lockedUntil - now) / 1000) };
    }
    if (record.lockedUntil <= now && record.attempts >= MAX_ATTEMPTS) {
      rateLimitStore.set(key, { attempts: 0, lockedUntil: 0 });
    }
  }

  return { allowed: true };
}

export function recordFailedAttempt(key: string): { locked: boolean; remainingTime?: number; attemptsRemaining: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key) || { attempts: 0, lockedUntil: 0 };

  record.attempts += 1;

  if (record.attempts >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    rateLimitStore.set(key, record);
    return { locked: true, remainingTime: Math.ceil(LOCKOUT_DURATION_MS / 1000), attemptsRemaining: 0 };
  }

  rateLimitStore.set(key, record);
  return { locked: false, attemptsRemaining: MAX_ATTEMPTS - record.attempts };
}

export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

export function getRateLimitInfo(key: string): { attempts: number; attemptsRemaining: number; isLocked: boolean } {
  const record = rateLimitStore.get(key);
  const now = Date.now();

  if (!record) {
    return { attempts: 0, attemptsRemaining: MAX_ATTEMPTS, isLocked: false };
  }

  const isLocked = record.lockedUntil > now;
  return {
    attempts: record.attempts,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - record.attempts),
    isLocked
  };
}
