import { prisma } from '@/lib/prisma';

/**
 * Fixed-window per-caller rate limiting for Next route handlers, backed by the
 * `rate_limits` table.
 *
 * Why this is in the database while the Go API's limiter is in memory
 * ------------------------------------------------------------------
 * They run in different places. The Go API is one long-lived process, so an
 * in-memory counter is shared by every request and costs no I/O
 * (`apps/api/internal/middleware/ratelimit.go`). A Next route handler on Vercel
 * is a serverless function: instances are created and discarded per burst of
 * traffic, so an in-memory counter would be reset by the platform at intervals
 * the caller can provoke and cannot be relied on at all.
 *
 * The endpoints this guards are low-volume — availability checks on a signup
 * form — so one upsert per request is not a hot path.
 */

export interface RateLimitOutcome {
  allowed: boolean;
  /** Seconds to wait, for the Retry-After header. Only meaningful when blocked. */
  retryAfterSeconds: number;
}

/**
 * Records one attempt and reports whether it is permitted.
 *
 * The whole thing is a single statement on purpose. Read-then-write from the
 * application would let two concurrent requests both observe `attempts = limit`
 * and both proceed — which is precisely the case a limiter exists to stop, and
 * the case that only appears under the load that matters.
 */
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
    // Fail OPEN. A database blip must not make the signup form reject everyone:
    // this endpoint guards against bulk enumeration, and the cost of letting a
    // handful of requests through during an outage is far lower than the cost of
    // no one being able to register. Logged so it is not silent.
    console.error(`Rate limit check failed for ${action}; allowing the request`, err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Best-effort caller address for rate-limit keying.
 *
 * Every header here is caller-supplied on a bare connection — the only reason
 * this is trustworthy is that Vercel overwrites both `x-real-ip` and
 * `x-forwarded-for` at the edge before the function sees them. Deploy this
 * behind anything that does not, and the key becomes attacker-chosen.
 *
 * `x-real-ip` is preferred because it is single-valued and cannot be turned into
 * a list. For `x-forwarded-for` the rightmost entry is the one the nearest proxy
 * appended; entries to its left are whatever the caller claimed.
 */
export function callerAddress(req: Request): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  // No proxy headers at all — local development, or a direct connection.
  // Keyed as one bucket rather than skipping the limit entirely.
  return 'unknown';
}
