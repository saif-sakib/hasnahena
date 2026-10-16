/**
 * Retention periods the privacy policy quotes. security.rejectedRetentionDays
 * is what the Go sweep counts (ADR-033), so /privacy must quote the same.
 * Its own module because system-config.ts imports Prisma.
 */

/**
 * How long an audit row lives, by tier (ADR-038). Here so the public /privacy
 * page need not import the admin catalogue (audit-actions.ts re-exports it).
 * Code, not a setting: shortening accountability records deserves a review.
 */
export const AUDIT_RETENTION_DAYS = {
  /** Security history — password changes, resets, lockouts, profile edits. */
  long: 730,
  /** Operational noise — sign-ins, verification codes, unknown-identifier resets. */
  short: 180,
} as const;

/** Matches the seeded default in `scripts/seed.mjs`, and the owner's ruling of 2026-08-25. */
export const DEFAULT_REJECTED_RETENTION_DAYS = 365;

export function rejectedRetentionDaysFrom(
  settings: Record<string, string> | null | undefined,
): number {
  const parsed = Number(settings?.['security.rejectedRetentionDays']);
  // Never render "erased 0 days after": fall back to the seeded default.
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : DEFAULT_REJECTED_RETENTION_DAYS;
}
