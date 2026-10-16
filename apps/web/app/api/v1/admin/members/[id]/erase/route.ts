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
 * Erase a member (WO-93, FR-23, ADR-033). Which outcome is COUNTED, not chosen:
 *   - Anonymise: any posting → identity cleared, contact tombstoned, documents
 *     and their Cloudinary assets deleted; account, transactions, loans kept.
 *   - Delete: no postings → the row goes and the cascade takes the rest.
 * A Next route because it must delete the Cloudinary assets. The rejected-
 * applicant half of FR-23 is the Go retention sweep.
 */

const eraseSchema = z.object({
  /** The member's account number, typed back — the one irreversible action on the screen. */
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
        // Names the folder holding their identity documents.
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
      // Staff go through /api/v1/admin/workers (archived, not anonymised).
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

    // Refusals, not faults (rule 2b): a live loan or guarantee would be left
    // attached to nobody.
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
      // Keyed by contact, so no cascade reaches them.
      await tx.passwordResetToken.deleteMany({
        where: {
          OR: [
            ...(member.email ? [{ email: member.email }] : []),
            ...(member.phone ? [{ phone: member.phone }] : []),
          ],
        },
      });

      // Revoke sessions (ADR-031, ADR-033).
      await revokeAllTokens(tx, id, 'admin_revoke');

      if (!anonymise) {
        // Everything else cascades; there are no transactions or loans.
        await tx.user.delete({ where: { id } });
        return;
      }

      await tx.document.deleteMany({ where: { userId: id } });
      await tx.notification.deleteMany({ where: { targetUserId: id } });
      // Both addresses are one table keyed on person and kind (ADR-044).
      await tx.address.deleteMany({ where: { userId: id } });
      await tx.nominee.deleteMany({ where: { userId: id } });

      // The support conversation (free text about the member). Messages
      // before threads, so a staff reply is not taken with the thread.
      const threads = await tx.supportThread.findMany({
        where: { memberUserId: id },
        select: { id: true },
      });
      if (threads.length > 0) {
        const threadIds = threads.map((t) => t.id);
        await tx.supportMessage.deleteMany({ where: { threadId: { in: threadIds } } });
        await tx.supportThread.deleteMany({ where: { id: { in: threadIds } } });
      }
      // Messages sent into other threads (no such path today).
      await tx.supportMessage.deleteMany({ where: { senderUserId: id } });

      // Live stream tickets.
      await tx.sseTicket.deleteMany({ where: { userId: id } });

      await tx.user.update({
        where: { id },
        data: {
          // EVERY column describing the person — identity-integrity.test.ts
          // fails on one neither cleared here nor on the keep-list.
          nidNumber: null,
          avatarUrl: null,
          dateOfBirth: null,
          bloodGroup: null,
          profession: null,
          formNumber: null,
          nameBn: null,
          fatherName: '',
          motherName: '',
          // NOT NULL enums go back to their default ("not recorded").
          gender: Gender.MALE,
          maritalStatus: MaritalStatus.UNMARRIED,
          childrenCount: 0,
          preferredLocale: null,
          assignedBranchId: null,
          rejectionReasonCode: null,
          rejectionReasonNote: null,
          rejectedAt: null,
          // nameEn is NOT NULL; it becomes the account number (ADR-023).
          nameEn: `Erased member ${member.accountNo}`,
          // phone is NOT NULL and unique: tombstoned, so the next owner inherits nothing.
          email: null,
          phone: `erased-${id}`,
          status: UserStatus.INACTIVE,
          approvedBy: null,
        },
      });
    });

    // After the commit — a Cloudinary failure must not roll back the erasure.
    // Both folders by prefix (catches orphaned uploads), then any leftover URLs.
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
      // A miss is expected (the prefix pass usually took it).
      const ok = publicId ? await deleteImage(publicId) : await deleteOldAvatar(url);
      if (ok) assetsDeleted += 1;
    }

    if (folderFailures > 0) {
      console.error(
        `[Admin/EraseMember] Cloudinary would not empty ${folderFailures} folder(s) for ` +
          `${member.accountNo}. Files may still be served publicly — see docs/runbook.md.`,
      );
    }

    // The audit row names the account number, counts and reason — never
    // identity data (it outlives the erasure).
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
