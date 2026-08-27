import { prisma } from '@/lib/prisma';
import { applicationFolder, deleteFolder, extractPublicId, deleteImage } from '@/lib/cloudinary';

/**
 * Erasing the identity documents of a refused application.
 *
 * **Why this happens at rejection and not at the retention deadline.**
 * [ADR-033](../../../docs/decisions.md) keeps a rejected application's decision
 * for ever and expires its identity *text* — NID number, parents' names, date of
 * birth, addresses — after `security.rejectedRetentionDays`, so the foundation
 * can explain the refusal and recognise somebody re-applying. None of those
 * purposes needs the **photographs**. A scan of a national identity card is the
 * single most damaging thing this database points at: it is enough on its own to
 * open an account somewhere else in this person's name, it is served from a
 * public URL that needs no login, and the foundation has no further use for it
 * the moment it decides not to admit them.
 *
 * So the tiers differ, deliberately: images go immediately, text goes on the
 * clock, and the decision itself is permanent ([ADR-038](../../../docs/decisions.md)).
 *
 * **Why a folder rather than a list of rows.** `documents` records what was
 * *recorded*; Cloudinary holds what was *stored*. An upload that succeeded
 * before a failed row insert is in the second and not the first, and deleting
 * only what the table remembers leaves behind precisely the assets nothing is
 * tracking. `applications/APP-2026-000001` is the whole submission.
 *
 * This is in Next rather than in the Go retention sweep for the same reason the
 * member erasure is: Cloudinary is configured here and in one place, and a
 * second client in a second language is a second thing to get wrong.
 */

export interface PurgeResult {
  /** `documents` rows removed. */
  rows: number;
  /**
   * Assets Cloudinary reported deleting, or `null` when the call failed.
   * A caller must not treat `null` as "nothing to do" — see `deleteFolder`.
   */
  assets: number | null;
}

/**
 * Remove one application's stored documents.
 *
 * Deletes the Cloudinary folder **first** and the rows second. The order is
 * deliberate: a row without an asset is a broken thumbnail on an admin screen,
 * while an asset without a row is an NID scan online that nothing knows to
 * delete. If this is interrupted, be interrupted in the direction that leaves
 * evidence.
 */
export async function purgeApplicationDocuments(userId: string): Promise<PurgeResult> {
  const applicant = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, formNumber: true, documents: { select: { id: true, url: true } } },
  });
  if (!applicant) return { rows: 0, assets: 0 };

  let assets = await deleteFolder(applicationFolder(applicant.formNumber, applicant.id));

  // A registration filed before the application folders existed put its four
  // documents under `people/<accountNo>` — and, for the applications this
  // replaced, under a cuid. Those have no folder this function can name, so they
  // are deleted one URL at a time from what the table does remember, which for
  // them is everything there is.
  if (assets === 0 && applicant.documents.length > 0) {
    let byUrl = 0;
    for (const doc of applicant.documents) {
      const publicId = extractPublicId(doc.url);
      if (publicId && (await deleteImage(publicId))) byUrl += 1;
    }
    assets = byUrl;
  }

  if (assets === null) {
    // Keep the rows. They are the only remaining description of what is still
    // stored, and the sweep needs them to try again.
    console.error(
      `[Retention] Cloudinary would not delete the documents for application ` +
        `${applicant.formNumber ?? applicant.id}; the rows are kept so the sweep retries. ` +
        `See docs/runbook.md.`,
    );
    return { rows: 0, assets: null };
  }

  const { count } = await prisma.document.deleteMany({ where: { userId } });
  return { rows: count, assets };
}
