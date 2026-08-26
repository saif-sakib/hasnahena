import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { formatCurrency } from '@/lib/utils';

/**
 * The four figures beside the home page headline, **counted rather than typed**.
 *
 * History, because the shape of this file is an answer to it. The figures were
 * once four literals in `messages/{en,bn}.json` — "125+" members, "BDT 250,000+"
 * deposits, "BDT 180,000+" lent. Invented when the page was designed, published
 * on the live site for months, and beyond the foundation's reach without a
 * developer. They moved into `system_config` on 2026-08-26 so an admin could
 * correct them, and were seeded **empty** so nothing untrue shipped.
 *
 * That fixed the honesty problem and created a maintenance one: the home page
 * of a cooperative showed no figures at all until somebody typed them, and a
 * typed figure is stale the day after it is typed. The owner asked for the
 * boxes to be filled (2026-08-26).
 *
 * The resolution is that this platform already **knows** all four numbers. It
 * holds the members, the ledger and the loan book, so the trustworthy version
 * of "125+ members" is `SELECT count(*)`. Counting them:
 *
 *   - is true by construction, and cannot drift from the ledger the way a
 *     typed figure does;
 *   - is never empty on a foundation that has one member and one deposit,
 *     which is what the owner was actually asking for;
 *   - costs an admin nothing, for ever.
 *
 * A `stats.*` setting still **overrides** the count, because there are real
 * reasons to publish "৩০+" rather than "৩১" and that is the foundation's call
 * to make, not this file's. Precedence is: an admin's words, then the count,
 * then no card at all.
 *
 * ## What counts
 *
 * Rule 6a — a `transactions` row is not necessarily money that moved. A
 * `PENDING` deposit is a request and a `PENDING` withdrawal is an unpaid
 * intention; only `CONFIRMED` moved money, so every aggregate here filters on
 * status. Four aggregates in this codebase once did not and reported intentions
 * as income ([ADR-016](../../../docs/decisions.md)).
 *
 * Loans are counted by `disbursementDate`, not by status: "distributed" means
 * the money left the fund, and it stays distributed after the loan is
 * `COMPLETED`. Filtering on status would need a list of five labels that a sixth
 * would silently fall out of.
 *
 * ## Freshness
 *
 * An hour, and deliberately not less. Balance changes happen in the Go API
 * (rule 2), which cannot call `revalidateTag` on a Next cache — so unlike
 * `getPublicSettings`, whose tag is invalidated by the settings `PUT`, there is
 * no write here that can announce itself. The interval **is** the mechanism.
 * That is the right trade for a marketing page: an hour-old member count is
 * accurate enough to publish, and the alternative is a Neon read on every
 * anonymous visit to the busiest page on the site (WO-73).
 */
export interface PublicStats {
  /** Active members. Workers and admins are staff, not members. */
  members: number;
  /** Every confirmed deposit ever taken, in whole taka (rule 1). */
  deposits: bigint;
  /** Principal of every loan that has actually been disbursed, in whole taka. */
  loans: bigint;
  /** Every confirmed donation ever received, in whole taka. */
  charity: bigint;
}

/**
 * `0n`, spelled the long way.
 *
 * `tsconfig.json` targets ES2017, where a BigInt *literal* is a syntax error
 * even though the runtime has had them for years. Every other BigInt in this
 * codebase is written this way for the same reason.
 */
const ZERO = BigInt(0);

/** What a page renders when the database is unreachable: no cards, not zeroes. */
export const NO_PUBLIC_STATS: PublicStats = {
  members: 0,
  deposits: ZERO,
  loans: ZERO,
  charity: ZERO,
};

export async function getPublicStats(): Promise<PublicStats> {
  try {
    const raw = await getCachedPublicStats();
    return {
      members: raw.members,
      deposits: BigInt(raw.deposits),
      loans: BigInt(raw.loans),
      charity: BigInt(raw.charity),
    };
  } catch (error) {
    // A marketing page must be renderable without a database — `next build`
    // prerenders it, and the Docker image builds against a `DATABASE_URL` that
    // does not resolve. Same reasoning, and the same placement, as the `catch`
    // in `getPublicSettings`: outside the cache, so a transient Neon outage is
    // retried on the next request instead of being memoised for an hour.
    console.error('Public statistics unavailable; the figures panel will be omitted:', error);
    return NO_PUBLIC_STATS;
  }
}

/**
 * Serialised as strings inside the cache.
 *
 * `unstable_cache` stores its value as JSON, and `JSON.stringify` throws on a
 * BigInt — the same failure `success-paths.test.ts` exists to catch in route
 * handlers, and it would happen here *after* the queries had run, on the first
 * uncached render of the home page.
 */
/**
 * The cache tag this panel shares.
 *
 * Declared before the `unstable_cache` call that reads it: that call runs at
 * module evaluation, so a `const` written below it is still in the temporal
 * dead zone and throws on import.
 */
export const PUBLIC_STATS_TAG = 'public-stats';

const getCachedPublicStats = unstable_cache(
  async () => {
    const [members, deposits, loans, charity] = await Promise.all([
      prisma.user.count({ where: { role: 'MEMBER', status: 'ACTIVE' } }),
      prisma.transaction.aggregate({
        where: { type: 'DEPOSIT', status: 'CONFIRMED' },
        _sum: { amount: true },
      }),
      prisma.loan.aggregate({
        where: { disbursementDate: { not: null } },
        _sum: { principalAmount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: 'DONATION', status: 'CONFIRMED' },
        _sum: { amount: true },
      }),
    ]);

    return {
      members,
      deposits: (deposits._sum.amount ?? ZERO).toString(),
      loans: (loans._sum.principalAmount ?? ZERO).toString(),
      charity: (charity._sum.amount ?? ZERO).toString(),
    };
  },
  ['public-stats'],
  { tags: [PUBLIC_STATS_TAG], revalidate: 3600 },
);

/**
 * A member count, or `''` when there is nothing worth publishing.
 *
 * Zero is not a figure to put on a home page — it is the state of a foundation
 * that has not opened yet, and a card reading "0 Total Members" is worse than
 * no card. An admin who genuinely wants to publish a zero can type one into the
 * override, which is checked before this is ever called.
 */
export function formatMemberCount(members: number, locale: string): string {
  if (!Number.isFinite(members) || members <= 0) return '';
  return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD').format(Math.trunc(members));
}

/**
 * A taka total, or `''` when it is zero.
 *
 * Goes through `formatCurrency` rather than spelling out an `Intl` call, so the
 * home page cannot disagree with a statement or a receipt about what taka looks
 * like. `Number` is safe here: these are whole-taka totals (rule 1), and the
 * fund would have to hold ninety trillion taka to lose precision.
 */
export function formatTakaTotal(amount: bigint, locale: string): string {
  if (amount <= ZERO) return '';
  return formatCurrency(Number(amount), locale);
}
