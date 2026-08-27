import { prisma } from '@/lib/prisma';

/**
 * Which office a new member belongs to, when nobody has been asked.
 *
 * The foundation runs one branch. Registration is a public form and has no
 * business asking an applicant to choose an office they have never heard of, so
 * the answer while there is exactly one is obvious — and the moment there is
 * more than one, guessing becomes wrong in a way nothing would report. So:
 * **assign automatically only when the answer is unambiguous.**
 *
 * `null` for every other case — no branch yet, or several. A member with no
 * branch is a legitimate, visible state: the admin member list already renders
 * the branch and shows a dash for it, and an admin can set it. A member silently
 * filed under the wrong office is not visible at all, and would be discovered
 * the first time somebody ran a per-branch report and the totals were wrong.
 *
 * Inactive branches are excluded. A closed office is not somewhere to put
 * somebody who has just joined.
 *
 * Accepts a transaction client so the lookup can run inside the same transaction
 * that creates the member — one round trip to a metered database rather than
 * two, and no window in which a branch is created between the read and the write.
 */
export async function soleActiveBranchId(
  client: Pick<typeof prisma, 'branch'> = prisma,
): Promise<string | null> {
  // Two rows requested, not one: `findFirst` cannot tell "the only office" from
  // "the first of several", and those are the two cases this exists to separate.
  const active = await client.branch.findMany({
    where: { isActive: true },
    select: { id: true },
    take: 2,
  });
  return active.length === 1 ? active[0].id : null;
}
