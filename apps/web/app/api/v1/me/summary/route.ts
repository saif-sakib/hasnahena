import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { LoanStatus } from '@prisma/client';

const isDev = process.env.NODE_ENV === 'development';

export async function GET(req: Request) {
  try {
    const auth = requireAuth(req);

    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });

    const account = await prisma.account.findFirst({
      where: { userId: auth.id },
      select: { id: true, savingsBalance: true, loanBalance: true },
    });
    if (!account) return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });

    const hasActiveLoan = await prisma.loan.findFirst({
      where: {
        borrowerId: auth.id,
        status: { in: [LoanStatus.ACTIVE] },
      },
      select: { id: true },
    });

    // "isGuarantor" for the UI is whether this member has any outstanding guarantee requests.
    const guarantorActive = await prisma.loan.findFirst({
      where: {
        guarantorId: auth.id,
        status: { in: [LoanStatus.PENDING_GUARANTOR, LoanStatus.PENDING_APPROVAL, LoanStatus.APPROVED, LoanStatus.ACTIVE] },
      },
      select: { id: true },
    });

    return NextResponse.json({
      ok: true,
      data: {
        currentBalance: Number(account.savingsBalance),
        hasActiveLoan: Boolean(hasActiveLoan),
        isGuarantor: Boolean(guarantorActive),
        // for convenience in some pages
        loanBalance: Number(account.loanBalance),
      },
    });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Unauthorized';
    console.error('[Me/Summary] Error:', msg);
    if (msg.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to fetch summary', ...(isDev && { details: msg }) }, { status: 500 });
  }
}

