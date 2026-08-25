import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireActiveAuth, revokeAllTokens } from '@/lib/auth-revocation';
import { createAuditLog } from '@/lib/audit';
import { deleteOldAvatar, deleteImage, extractPublicId } from '@/lib/cloudinary';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';
import { LoanStatus, UserRole, UserStatus } from '@prisma/client';

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
      select: { id: true, role: true, accountNo: true, avatarUrl: true, email: true, phone: true },
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
      await tx.address.deleteMany({
        where: { OR: [{ userPermanentId: id }, { userPresentId: id }] },
      });
      await tx.nominee.deleteMany({ where: { userId: id } });

      await tx.user.update({
        where: { id },
        data: {
          // The person.
          nidNumber: null,
          avatarUrl: null,
          dateOfBirth: null,
          bloodGroup: null,
          profession: null,
          formNumber: null,
          nameBn: null,
          fatherName: '',
          motherName: '',
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
    const assets = [
      ...documents.map((d) => d.url),
      ...(member.avatarUrl ? [member.avatarUrl] : []),
    ];
    let assetsDeleted = 0;
    for (const url of assets) {
      const publicId = extractPublicId(url);
      const ok = publicId ? await deleteImage(publicId) : await deleteOldAvatar(url);
      if (ok) assetsDeleted += 1;
    }
    if (assetsDeleted < assets.length) {
      console.error(
        `[Admin/EraseMember] ${assets.length - assetsDeleted} Cloudinary asset(s) for ` +
          `${member.accountNo} were not deleted and are still served publicly. See docs/runbook.md.`,
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
