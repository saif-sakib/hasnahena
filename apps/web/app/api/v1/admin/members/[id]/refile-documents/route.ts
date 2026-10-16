import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { authErrorStatus } from '@/lib/auth';
import { fileApplicationDocuments } from '@/lib/application-documents';
import { UserRole } from '@prisma/client';

/**
 * File an admitted member's documents under people/<accountNo> (ADR-040).
 * Separate from the Go approval so an image-host failure cannot fail it; safe
 * to retry, and the nightly sweep covers missed calls. Admins only.
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
