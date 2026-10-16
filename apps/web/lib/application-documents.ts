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
 * Registration documents (APPLICATION_DOCUMENTS) and their lifecycle:
 *   refusal → purgeApplicationDocuments deletes the images at once (ADR-038);
 *   approval → fileApplicationDocuments moves them into people/<accountNo> (ADR-040).
 * Folder-based, because the documents table does not know about orphaned uploads.
 */

export interface PurgeResult {
  /** `documents` rows removed. */
  rows: number;
  /** Assets deleted, or null when the call failed (null ≠ "nothing to do"). */
  assets: number | null;
}

/**
 * Remove one application's stored documents: the folder FIRST, then the rows,
 * so an interruption leaves evidence rather than an untracked NID scan.
 */
export async function purgeApplicationDocuments(userId: string): Promise<PurgeResult> {
  const applicant = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, formNumber: true, documents: { select: { type: true, url: true } } },
  });
  if (!applicant) return { rows: 0, assets: 0 };

  let assets = await deleteFolder(applicationFolder(applicant.formNumber, applicant.id));

  // Pre-folder registrations: delete one URL at a time from the table.
  if (assets === 0 && applicant.documents.length > 0) {
    let byUrl = 0;
    for (const doc of applicant.documents) {
      const publicId = extractPublicId(doc.url);
      if (publicId && (await deleteImage(publicId))) byUrl += 1;
    }
    assets = byUrl;
  }

  if (assets === null) {
    // Keep the rows — the only record of what is still stored, for the retry.
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
 * The four registration documents. One list for the upload name (`slug`), the
 * documents row (`type`) and the move. `member_signature` → `signature` is the
 * one mismatch, hence a table.
 */
export const APPLICATION_DOCUMENTS = [
  { type: 'nid_front', slug: 'nid-front', label: 'NID front image', formKey: 'nidFrontImage' },
  { type: 'nid_back', slug: 'nid-back', label: 'NID back image', formKey: 'nidBackImage' },
  { type: 'member_photo', slug: 'member-photo', label: 'Member photo', formKey: 'memberPhotoImage' },
  { type: 'member_signature', slug: 'signature', label: 'Member signature', formKey: 'signatureImage' },
] as const;

const SLUG_BY_TYPE = new Map<string, string>(APPLICATION_DOCUMENTS.map((d) => [d.type, d.slug]));

/**
 * Destination name for a moved document: its type, else its current name.
 * Never `avatar`, which would overwrite the profile picture.
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
  /** Rows whose asset did not move; their URLs still serve. Retryable. */
  failed: number;
}

/**
 * Move an admitted member's documents from applications/<APP-…> into
 * people/<accountNo>, so one prefix holds everything about a person (ADR-040).
 * Idempotent; nothing is deleted; each row's URL is rewritten only after its
 * asset has moved.
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
  // Not admitted yet (or nothing to file) — not an error; may be a retry.
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
    // Keyed on (userId, type) (ADR-044).
    await prisma.document.update({
      where: { userId_type: { userId: member.id, type: doc.type } },
      data: { url },
    });
    result.moved += 1;
  }

  // Remove the now-empty application folder (deleteEmptyFolder refuses if not empty).
  if (result.moved > 0 && result.failed === 0) {
    await deleteEmptyFolder(applicationFolder(member.formNumber, member.id));
  }

  return result;
}
