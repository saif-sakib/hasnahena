import { prisma } from '@/lib/prisma';

/**
 * Fixed-window rate limiting for Next route handlers, in the `rate_limits`
 * table — serverless instances cannot share an in-memory counter.
 */

export interface RateLimitOutcome {
  allowed: boolean;
  /** Seconds to wait, for the Retry-After header. Only meaningful when blocked. */
  retryAfterSeconds: number;
}

/** Records one attempt and reports whether it is permitted, in one atomic statement. */
export async function consumeRateLimit(
  action: string,
  identifier: string,
  options: { limit: number; windowSeconds: number },
): Promise<RateLimitOutcome> {
  const key = `${action}:${identifier}`;
  const expiresAt = new Date(Date.now() + options.windowSeconds * 1000);

  try {
    const rows = await prisma.$queryRaw<Array<{ attempts: number; expiresAt: Date }>>`
      INSERT INTO rate_limits (id, attempts, "expiresAt", "updatedAt")
      VALUES (${key}, 1, ${expiresAt}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        attempts = CASE
          WHEN rate_limits."expiresAt" < NOW() THEN 1
          ELSE rate_limits.attempts + 1
        END,
        "expiresAt" = CASE
          WHEN rate_limits."expiresAt" < NOW() THEN ${expiresAt}
          ELSE rate_limits."expiresAt"
        END,
        "updatedAt" = NOW()
      RETURNING attempts, "expiresAt"
    `;

    const row = rows[0];
    if (!row) return { allowed: true, retryAfterSeconds: 0 };

    if (row.attempts > options.limit) {
      const retryMs = row.expiresAt.getTime() - Date.now();
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (err) {
    // Fail OPEN, logged: an outage must not block registration.
    console.error(`Rate limit check failed for ${action}; allowing the request`, err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Caller address for rate-limit keying. Trustworthy only because Vercel
 * overwrites x-real-ip and x-forwarded-for at the edge. Prefers x-real-ip;
 * else the rightmost x-forwarded-for entry.
 */
export function callerAddress(req: Request): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  // No proxy headers (local dev): one shared bucket.
  return 'unknown';
}
