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
