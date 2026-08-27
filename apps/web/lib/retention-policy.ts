/**
 * How long a refused application keeps its identity data, as the privacy policy
 * states it.
 *
 * `security.rejectedRetentionDays` is what the Go sweep actually counts from
 * each rejection ([ADR-033](../../../docs/decisions.md),
 * `internal/repositories/retention_repository.go`). The privacy page has to
 * quote the same number: a policy naming a period the sweep does not use is a
 * promise broken silently, and it is the reader who has no way to tell.
 *
 * Its own module rather than a line in `system-config.ts`, for the same reason
 * `localized-settings.ts` is: this is imported by a page that renders the value,
 * and `system-config.ts` imports Prisma.
 */

/**
 * How long an audit row lives, by tier ([ADR-038](../../../docs/decisions.md)).
 *
 * Here rather than in `audit-actions.ts`, where the tiers themselves are
 * declared, because `/privacy` states these periods and is a **public marketing
 * page**: importing the admin catalogue to read two numbers puts 35 admin
 * actions' worth of bilingual labels in reach of a page a stranger loads. Tree
 * shaking may well remove them — it appears to — but "the bundler probably drops
 * it" is not a reason for a marketing page to depend on the dashboard's
 * vocabulary. `audit-actions.ts` re-exports this, so there is still one
 * definition.
 *
 * Days, not a `system_config` key, on purpose: the privacy notice states them,
 * and a dial an admin can turn makes the notice a description of the current
 * setting rather than a commitment. Shortening how long accountability records
 * are kept should be a code change with a review.
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
  // A zero or a nonsense value must not render as "erased 0 days after the
  // refusal", which would describe a sweep that does not exist. Fall back to
  // the seeded default, which is what an unconfigured deployment runs.
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : DEFAULT_REJECTED_RETENTION_DAYS;
}
