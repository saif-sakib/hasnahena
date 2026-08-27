import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { authErrorStatus } from '@/lib/auth';
import { fileApplicationDocuments } from '@/lib/application-documents';
import { UserRole } from '@prisma/client';

/**
 * File a newly admitted member's registration documents under their account
 * number — `hasnahena/people/ACC-KH-33001`.
 *
 * **Why this is a separate call and not part of the approval.** The approval
 * itself is a Go endpoint: it is the transaction that flips the status, issues
 * the account number, plants the first-login marker and writes the audit row,
 * and it must not grow a dependency on a third-party image host that can be slow
 * or down. Cloudinary is configured in one place in this repository and it is
 * here (the same reason the member erasure is a Next route rather than a Go one).
 *
 * So the approvals screen calls this straight after an approval succeeds, and a
 * failure here is **not** a failure of the approval: the documents stay under
 * `applications/APP-2026-000001`, every stored URL still resolves, and nothing a
 * member or an admin can see is broken. It is safe to call again, and the
 * nightly retention sweep calls it for anybody it was never called for — which
 * is what covers the browser that was closed between the two requests.
 *
 * Admins only, and members only. This moves identity documents around; a worker
 * who can see an application is not somebody who should be able to relocate its
 * NID scans.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireActiveAuth(req);
    if (!['ADMIN', 'SUPER_ADMIN'].includes((auth.role || '').toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await ctx.params;
    const member = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, accountNo: true },
    });
    if (!member || member.role !== UserRole.MEMBER) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    }
    if (!member.accountNo) {
      // Still an application. There is no folder to file into, and saying so is
      // more useful than reporting a successful move of nothing.
      return NextResponse.json(
        { ok: false, error: 'This application has not been approved yet' },
        { status: 409 },
      );
    }

    const result = await fileApplicationDocuments(id);
    return NextResponse.json({ ok: true, data: { accountNo: member.accountNo, ...result } });
  } catch (error) {
    const status = authErrorStatus(error);
    if (status) {
      return NextResponse.json(
        { ok: false, error: status === 401 ? 'Unauthorized' : 'Server error' },
        { status },
      );
    }
    console.error('[Admin/RefileDocuments] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to file documents' }, { status: 500 });
  }
}
