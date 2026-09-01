import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireActiveAuth, revokeAllTokens } from '@/lib/auth-revocation';
import { createAuditLog } from '@/lib/audit';
import {
  deleteOldAvatar,
  deleteImage,
  extractPublicId,
  deleteFolder,
  personFolder,
  applicationFolder,
} from '@/lib/cloudinary';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';
import { Gender, LoanStatus, MaritalStatus, UserRole, UserStatus } from '@prisma/client';

/**
 * Erase a member — WO-93, FR-23, [ADR-033](../../../../../../../../../docs/decisions.md).
 *
 * Workers could be deleted; members could not. There was no endpoint, no screen
 * and no repository method, so the only answer the foundation had to "please
 * remove my data" was that it could not.
 *
 * Two outcomes, and which one happens is **counted, not chosen**:
 *
 *  - **Anonymise.** A member with any posting keeps every posting. The ledger is
 *    summed hourly against the stored balances (ADR-027) and a posting whose
 *    owner has vanished does not make that sum smaller, it makes it permanently
 *    wrong. So the person is removed and the money is not: identity columns
 *    cleared, contact tombstoned, addresses and nominee and documents deleted
 *    along with their Cloudinary assets, `accountNo` and `Account` and every
 *    `Transaction` and `Loan` untouched.
 *  - **Delete.** A member with no postings at all — an approval nobody ever
 *    used — is deleted outright and the cascade takes the rest.
 *
 * The count is what turns a database constraint into an answer. `transactions`
 * and `loans` declare no cascade, so they are `ON DELETE RESTRICT`: without the
 * count, "delete this member" answers 500 with a foreign key in it, which is
 * CLAUDE.md rule 2b in the Next half.
 *
 * Why this is a Next route and not a Go one: it is not a balance change, so
 * ADR-001 does not send it to Go — and the deciding factor is Cloudinary. The
 * NID photographs and the passport photo are the most sensitive things this
 * erases, `deleteImage` exists only in `lib/cloudinary.ts`, and an erasure that
 * cleared the URLs while leaving the images served from a public CDN would be
 * theatre. The other half of FR-23 — expiring a *rejected applicant's* identity
 * after a year — runs in the Go API instead, because it needs an always-on
 * process and needs no Cloudinary at all (`retention_repository.go`).
 */

const eraseSchema = z.object({
  /**
   * The member's own account number, echoed back.
   *
   * Not paranoia about the id in the URL: this is the one irreversible action
   * an admin can take from a screen full of reversible ones, and it is reached
   * from a list. Typing `ACC-KH-33001` is the difference between erasing the
   * member you meant and the one below them.
   */
  confirmAccountNo: z.string().trim().min(1),
  /** Why, for the audit row. Free text — the support thread has the detail. */
  reason: z.string().trim().min(3).max(500),
});

/** Loans that still owe somebody something. */
const LIVE_LOAN_STATUSES = [
  LoanStatus.PENDING_GUARANTOR,
  LoanStatus.PENDING_APPROVAL,
  LoanStatus.ACTIVE,
  LoanStatus.DEFAULTED,
] as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireActiveAuth(req);
    if (!['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await ctx.params;
    const parsed = eraseSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { confirmAccountNo, reason } = parsed.data;

    const member = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        accountNo: true,
        // The application's number names the folder holding their four identity
        // documents. Without it the erasure can only delete what `documents`
        // happens to still record.
        formNumber: true,
        avatarUrl: true,
        email: true,
        phone: true,
      },
    });
    if (!member) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    }
    if (member.role !== UserRole.MEMBER) {
      // Staff are removed through /api/v1/admin/workers, which counts different
      // references (postings they *processed*, approvals they made) and archives
      // rather than anonymises.
      return NextResponse.json(
        { ok: false, error: 'Only member accounts can be erased here' },
        { status: 400 },
      );
    }
    if (!member.accountNo || member.accountNo !== confirmAccountNo.toUpperCase()) {
      return NextResponse.json(
        { ok: false, error: 'The account number does not match this member' },
        { status: 400 },
      );
    }

    // Refusals, not faults (rule 2b). Both are about somebody other than the
    // member asking: a live loan is money the foundation is owed, and an active
    // guarantee is another member's loan resting on this one's savings.
    // Anonymising either leaves an obligation attached to nobody.
    const [ownLoans, guarantees] = await prisma.$transaction([
      prisma.loan.count({ where: { borrowerId: id, status: { in: [...LIVE_LOAN_STATUSES] } } }),
      prisma.loan.count({ where: { guarantorId: id, status: { in: [...LIVE_LOAN_STATUSES] } } }),
    ]);
    if (ownLoans > 0) {
      return NextResponse.json(
        { ok: false, error: 'This member has a loan that is not settled. Settle or close it first.' },
        { status: 409 },
      );
    }
    if (guarantees > 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'This member is the guarantor of a loan that is not settled. Another member’s loan rests on their savings.',
        },
        { status: 409 },
      );
    }

    const [transactions, loans, documents] = await prisma.$transaction([
      prisma.transaction.count({ where: { userId: id } }),
      prisma.loan.count({ where: { OR: [{ borrowerId: id }, { guarantorId: id }] } }),
      prisma.document.findMany({ where: { userId: id }, select: { url: true } }),
    ]);
    const references = transactions + loans;
    const anonymise = references > 0;

    await prisma.$transaction(async (tx) => {
      // Keyed by contact rather than by user id, so no cascade reaches them.
      // A first-login link left behind would be redeemable by whoever is given
      // that phone number next.
      await tx.passwordResetToken.deleteMany({
        where: {
          OR: [
            ...(member.email ? [{ email: member.email }] : []),
            ...(member.phone ? [{ phone: member.phone }] : []),
          ],
        },
      });

      // Same reason the worker paths write it, and for the same account: a
      // member whose identity has been removed but whose token still works is a
      // live session belonging to nobody (ADR-031, ADR-033).
      await revokeAllTokens(tx, id, 'admin_revoke');

      if (!anonymise) {
        // Notifications, documents, addresses, nominee, account and SSE tickets
        // all cascade. `transactions` and `loans` do not, and there are none —
        // that is what `references === 0` means, and the database enforces it
        // independently.
        await tx.user.delete({ where: { id } });
        return;
      }

      await tx.document.deleteMany({ where: { userId: id } });
      await tx.notification.deleteMany({ where: { targetUserId: id } });
      // One predicate, not two. Both addresses are rows of one table keyed on
      // the person and the kind (ADR-044), so an erasure cannot now clear one
      // and miss the other.
      await tx.address.deleteMany({ where: { userId: id } });
      await tx.nominee.deleteMany({ where: { userId: id } });

      // The support conversation, which is free text the member typed: their
      // circumstances, their family, sometimes a photograph of a document. It
      // cascades when a member is *deleted* and was simply left behind when one
      // was anonymised — so the most narrative thing this platform holds about
      // somebody survived an erasure that cleared their name.
      //
      // Messages before threads: `senderUserId` cascades from the user and
      // `threadId` from the thread, and deleting the thread first would take a
      // staff reply with it while leaving nothing to say why.
      const threads = await tx.supportThread.findMany({
        where: { memberUserId: id },
        select: { id: true },
      });
      if (threads.length > 0) {
        const threadIds = threads.map((t) => t.id);
        await tx.supportMessage.deleteMany({ where: { threadId: { in: threadIds } } });
        await tx.supportThread.deleteMany({ where: { id: { in: threadIds } } });
      }
      // A message they sent into somebody else's thread — there is no such path
      // today, and this is here so that adding one does not quietly reopen this.
      await tx.supportMessage.deleteMany({ where: { senderUserId: id } });

      // Live stream tickets. They cascade on delete and are short-lived, but an
      // anonymised member with a valid ticket is a subscription belonging to
      // nobody for as long as it lasts.
      await tx.sseTicket.deleteMany({ where: { userId: id } });

      await tx.user.update({
        where: { id },
        data: {
          // **Every column on `users` that describes the person**, and the list
          // is deliberately exhaustive rather than "the obvious ones": the first
          // version cleared the name, the NID and the address and left gender,
          // marital status, number of children, language and office — five facts
          // about a human being, on a row whose whole purpose after this is to be
          // the owner of a number in the ledger.
          // `test/routes/identity-integrity.test.ts` enumerates the model and
          // fails on a column that is neither cleared here nor on the keep-list.
          nidNumber: null,
          avatarUrl: null,
          dateOfBirth: null,
          bloodGroup: null,
          profession: null,
          formNumber: null,
          nameBn: null,
          fatherName: '',
          motherName: '',
          // Enums with a NOT NULL default, so they go back to the default rather
          // than to null. `MALE` and `UNMARRIED` then mean "not recorded" for an
          // erased row, which is what they already mean on a row nobody filled in.
          gender: Gender.MALE,
          maritalStatus: MaritalStatus.UNMARRIED,
          childrenCount: 0,
          preferredLocale: null,
          // Which office held the account is a fact about the person, not about
          // the money: no posting carries a branch, so nothing downstream needs it.
          assignedBranchId: null,
          // A member cannot have been rejected, but the columns exist on the row
          // and an erasure that leaves any door open leaves this one.
          rejectionReasonCode: null,
          rejectionReasonNote: null,
          rejectedAt: null,
          // `nameEn` is NOT NULL and is what every past audit row and every
          // generated document refers to. It becomes the account number, which
          // is the one identifier this member ever had (ADR-023) and the only
          // one the ledger still needs.
          nameEn: `Erased member ${member.accountNo}`,
          // Tombstoned, not nulled: `phone` is NOT NULL and unique, and freeing
          // the old values means the next person given that number inherits an
          // account's history.
          email: null,
          phone: `erased-${id}`,
          status: UserStatus.INACTIVE,
          // Erasure is not an approval decision, and leaving `approvedBy` set
          // would keep pointing at the staff member who admitted them.
          approvedBy: null,
        },
      });
    });

    // After the commit, and deliberately: Cloudinary is a different system with
    // its own failure modes, and an image that will not delete must not roll
    // back an erasure that has already succeeded in the database. Every failure
    // logs — `deleteImage` is the only record that an asset was left behind.
    // **Both folders, by prefix, and then anything left over by URL.**
    //
    // Deleting only the URLs in `documents` was erasure that trusted the
    // database to be a complete inventory of the image host, and it is not: an
    // upload that succeeded before a failed row insert, a retry that wrote a
    // second asset, a file uploaded by hand — none of those have a row, all of
    // them are still served from a public URL, and a prefix delete is the only
    // thing that reaches them. `hasnahena/people/ACC-KH-33001` holds the avatar
    // and `hasnahena/applications/APP-2026-000001` the identity documents.
    //
    // The URL pass still runs afterwards for anything filed before those two
    // trees existed, and for the one case a prefix cannot cover: a document
    // whose row points somewhere else entirely.
    const folderResults = await Promise.all([
      deleteFolder(personFolder(member.accountNo, member.id)),
      deleteFolder(applicationFolder(member.formNumber, member.id)),
    ]);
    const folderFailures = folderResults.filter((r) => r === null).length;
    let assetsDeleted = folderResults.reduce<number>((sum, r) => sum + (r ?? 0), 0);

    const assets = [
      ...documents.map((d) => d.url),
      ...(member.avatarUrl ? [member.avatarUrl] : []),
    ];
    for (const url of assets) {
      const publicId = extractPublicId(url);
      // A miss here is expected and is *not* counted as a failure: the prefix
      // pass has usually already taken the file, so Cloudinary answers
      // `not found`. The folder results above are what says whether anything is
      // still online.
      const ok = publicId ? await deleteImage(publicId) : await deleteOldAvatar(url);
      if (ok) assetsDeleted += 1;
    }

    if (folderFailures > 0) {
      console.error(
        `[Admin/EraseMember] Cloudinary would not empty ${folderFailures} folder(s) for ` +
          `${member.accountNo}. Files may still be served publicly — see docs/runbook.md.`,
      );
    }

    // `audit_logs` is append-only (DATA-08), so anything named here outlives the
    // erasure. The account number, the counts and the admin's reason — never the
    // NID number, the name, the address or the parents' names, which is why this
    // does NOT follow the worker handler's `oldValue: oldUser` pattern.
    await createAuditLog({
      action: 'MEMBER_ERASED',
      entityType: 'USER',
      entityId: id,
      userId: auth.id,
      newValue: {
        accountNo: member.accountNo,
        mode: anonymise ? 'anonymised' : 'deleted',
        transactions,
        loans,
        documents: documents.length,
        assetsDeleted,
        assetsFound: assets.length,
      },
      details: reason,
      request: req,
    });

    return NextResponse.json({
      ok: true,
      data: {
        accountNo: member.accountNo,
        anonymised: anonymise,
        deleted: !anonymise,
        references: { transactions, loans, documents: documents.length },
        assets: { found: assets.length, deleted: assetsDeleted },
      },
    });
  } catch (error) {
    const status = routeErrorStatus(error);
    if (status) {
      return NextResponse.json(
        { ok: false, error: routeErrorMessage(error, 'Failed to erase member') },
        { status },
      );
    }
    console.error('[Admin/EraseMember] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to erase member' }, { status: 500 });
  }
}
