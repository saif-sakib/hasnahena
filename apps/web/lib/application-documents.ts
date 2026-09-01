import { prisma } from '@/lib/prisma';
import {
  applicationFolder,
  deleteEmptyFolder,
  deleteFolder,
  deleteImage,
  extractPublicId,
  moveAsset,
  personFolder,
} from '@/lib/cloudinary';

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
    select: { id: true, formNumber: true, documents: { select: { type: true, url: true } } },
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

/**
 * The four documents a registration submits, and what each is called.
 *
 * One definition, because three places have to agree about it and they are in
 * different layers: the registration route names the Cloudinary asset from
 * `slug`, the `documents` row stores `type`, and `fileApplicationDocuments`
 * below re-derives the name when it moves the asset into the member's own
 * folder. They were two lists, and a mismatch would not have shown up as an
 * error — it would have shown up as an approved member whose NID scan is filed
 * under a name nothing looks for.
 *
 * `member_signature` maps to `signature` rather than to its own type, which is
 * the one place the two spellings differ and the reason this is a table and not
 * a `replace('_', '-')`.
 */
export const APPLICATION_DOCUMENTS = [
  { type: 'nid_front', slug: 'nid-front', label: 'NID front image', formKey: 'nidFrontImage' },
  { type: 'nid_back', slug: 'nid-back', label: 'NID back image', formKey: 'nidBackImage' },
  { type: 'member_photo', slug: 'member-photo', label: 'Member photo', formKey: 'memberPhotoImage' },
  { type: 'member_signature', slug: 'signature', label: 'Member signature', formKey: 'signatureImage' },
] as const;

const SLUG_BY_TYPE = new Map<string, string>(APPLICATION_DOCUMENTS.map((d) => [d.type, d.slug]));

/**
 * What a document should be called inside the folder it is being moved into.
 *
 * The row's `type` when it is one of the four, and otherwise the name the asset
 * already has. The fallback exists for rows filed before the four types were
 * fixed; `avatar` is refused because that name is already taken by the member's
 * profile picture in the same folder, and overwriting it with a scan of an
 * identity card is the one collision here that would be actively harmful.
 */
function destinationSlug(type: string | null, sourcePublicId: string): string {
  const known = type ? SLUG_BY_TYPE.get(type) : undefined;
  if (known) return known;
  const basename = sourcePublicId.split('/').pop() || 'document';
  return basename === 'avatar' ? 'document-avatar' : basename;
}

export interface FileResult {
  /** Assets whose public id now sits under the member's own folder. */
  moved: number;
  /** Rows that were already filed there — a repeat call, and not a failure. */
  alreadyFiled: number;
  /** Rows whose asset would not move. Their URLs are left pointing at the old
   *  location, which still serves, so nothing is broken; it can be retried. */
  failed: number;
}

/**
 * Move an admitted member's registration documents into their own folder.
 *
 * **Why this is a move and not where they were put in the first place.** The
 * four documents are uploaded by a public form, before anybody is a member and
 * therefore before an account number exists — `ACC-KH-33001` is issued at
 * approval and nowhere else ([ADR-039](../../../docs/decisions.md)). So the
 * upload can only name the folder after the application, and the folder can only
 * be named after the person once there is a person.
 *
 * **Why move them at all.** The asset tree is the only description of this
 * account that survives leaving Cloudinary. Split across two trees, a member's
 * files are their avatar under `people/ACC-KH-33001` and their identity
 * documents under `applications/APP-2026-000001` — and nothing in the folder
 * names says the two are the same human being. Answering "delete everything you
 * hold about this member" then depends on the database still holding the join,
 * which is exactly the thing an erasure destroys. One folder per person means
 * one prefix, and `hasnahena/people/ACC-KH-33001` is the whole answer.
 *
 * **Idempotent, and safe to call on a member who has none.** A row already under
 * the member's folder is counted and skipped, and a source that is not there is
 * a failure that changes nothing. Nothing is deleted: `moveAsset` is a rename,
 * so a URL that is not rewritten still points at a file that still exists.
 *
 * The `documents.url` rewrite happens per row and only after that row's asset
 * has actually moved. Rewriting them in a batch afterwards would mean one
 * failure in the middle leaves rows pointing at files that are no longer there.
 */
export async function fileApplicationDocuments(userId: string): Promise<FileResult> {
  const member = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      accountNo: true,
      formNumber: true,
      documents: { select: { url: true, type: true } },
    },
  });

  const result: FileResult = { moved: 0, alreadyFiled: 0, failed: 0 };
  // No account number means they have not been admitted, and there is nowhere
  // to file anything. Not an error — the caller may be a retry.
  if (!member?.accountNo || member.documents.length === 0) return result;

  const home = `hasnahena/${personFolder(member.accountNo, member.id)}`;

  for (const doc of member.documents) {
    const source = extractPublicId(doc.url);
    if (!source) {
      result.failed += 1;
      continue;
    }
    if (source.startsWith(`${home}/`)) {
      result.alreadyFiled += 1;
      continue;
    }

    const target = `${home}/${destinationSlug(doc.type, source)}`;
    const url = await moveAsset(source, target);
    if (!url) {
      result.failed += 1;
      continue;
    }
    // Keyed on whose it is and what it is (ADR-044) — a document has no id of
    // its own, because those two facts already name exactly one row.
    await prisma.document.update({
      where: { userId_type: { userId: member.id, type: doc.type } },
      data: { url },
    });
    result.moved += 1;
  }

  // The application folder is now empty, and an asset tree that keeps one
  // directory per member ever admitted is a second record of who applied that
  // nothing manages. Only ever removed when nothing is left in it — see
  // `deleteEmptyFolder`, which refuses rather than deleting a half-moved set.
  if (result.moved > 0 && result.failed === 0) {
    await deleteEmptyFolder(applicationFolder(member.formNumber, member.id));
  }

  return result;
}
