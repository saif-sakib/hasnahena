import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { serializeLoan } from '@/lib/api-utils';
import { LoanStatus, UserRole } from '@prisma/client';

const bodySchema = z.object({
  accepted: z.boolean(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = requireAuth(req);
    const payload = bodySchema.parse(await req.json());

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json({ ok: false, error: 'Invalid loan ID format' }, { status: 400 });
    }

    const member = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true, nameEn: true },
    });
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (member.role !== UserRole.MEMBER) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        borrower: { select: { nameEn: true, memberId: true } },
      },
    });
    if (!loan) return NextResponse.json({ ok: false, error: 'Loan not found' }, { status: 404 });
    if (loan.guarantorId !== auth.id) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    if (loan.status !== LoanStatus.PENDING_GUARANTOR) return NextResponse.json({ ok: false, error: 'Invalid state' }, { status: 409 });

    const updated = await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status: payload.accepted ? LoanStatus.PENDING_APPROVAL : LoanStatus.REJECTED,
      },
    });

    // Notify the borrower about guarantor's decision
    prisma.notification.create({
      data: {
        type: payload.accepted ? 'LOAN_REQUEST' : 'LOAN_REJECTED',
        title: payload.accepted ? 'Guarantor Approved' : 'Guarantor Declined',
        message: payload.accepted
          ? `${member.nameEn} has agreed to be your guarantor. Your loan is now pending admin approval.`
          : `${member.nameEn} has declined to be your guarantor for the loan.`,
        targetUserId: loan.borrowerId,
        data: {
          loanId: loan.id,
          loanNumber: loan.loanNumber,
          guarantorId: auth.id,
          guarantorName: member.nameEn,
          accepted: payload.accepted,
        },
      },
    }).catch((err) => console.error('Failed to create borrower notification:', err));

    // If accepted, notify admins that loan is ready for approval
    if (payload.accepted) {
      prisma.notification.create({
        data: {
          type: 'LOAN_REQUEST',
          title: 'Loan Ready for Approval',
          message: `Loan ${loan.loanNumber} for ${loan.borrower.nameEn} (৳${Number(loan.principalAmount).toLocaleString()}) is ready for admin approval.`,
          targetRole: UserRole.ADMIN,
          data: {
            loanId: loan.id,
            loanNumber: loan.loanNumber,
            borrowerId: loan.borrowerId,
            borrowerName: loan.borrower.nameEn,
            amount: Number(loan.principalAmount),
          },
        },
      }).catch((err) => console.error('Failed to create admin notification:', err));
    }

    return NextResponse.json({ ok: true, data: serializeLoan(updated) }, { status: 200 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Validation failed', details: err.flatten() }, { status: 400 });
    }
    const msg = typeof err?.message === 'string' ? err.message : 'Server error';
    if (msg.toLowerCase().includes('authorization')) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
