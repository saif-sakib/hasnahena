import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authErrorStatus } from '@/lib/auth';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';
import { serializeLoan } from '@/lib/api-utils';
import { LoanStatus, UserRole } from '@prisma/client';
import { formatMoney } from '@/lib/notify';

const bodySchema = z.object({
  accepted: z.boolean(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = await requireActiveAuth(req);

    // Authorization before validation (TEST-16).
    const member = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true, nameEn: true },
    });
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (member.role !== UserRole.MEMBER) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const payload = bodySchema.parse(await readJsonBody(req));

    // No id-shape check: the lookup's 404 is the honest answer and cannot drift
    // from the schema's id strategy (a UUID regex once broke FR-11 entirely).

    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        borrower: { select: { nameEn: true, accountNo: true } },
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

    // Awaited (WO-59) but caught — the decision is recorded either way.
    await prisma.notification.create({
      data: {
        type: payload.accepted ? 'LOAN_REQUEST' : 'LOAN_REJECTED',
        title: payload.accepted ? 'Guarantor Approved' : 'Guarantor Declined',
        message: payload.accepted
          ? `${member.nameEn} has agreed to be your guarantor. Your loan is now pending admin approval.`
          : `${member.nameEn} has declined to be your guarantor for the loan.`,
        targetUserId: loan.borrowerId,
        data: {
          loanId: loan.id,
          guarantorId: auth.id,
          guarantorName: member.nameEn,
          accepted: payload.accepted,
        },
      },
    }).catch((err) => console.error('Failed to create borrower notification:', err));

    // If accepted, notify admins that loan is ready for approval
    if (payload.accepted) {
      await prisma.notification.create({
        data: {
          type: 'LOAN_REQUEST',
          title: 'Loan Ready for Approval',
          message: `Loan ${loan.id} for ${loan.borrower.nameEn} (${formatMoney(loan.principalAmount)}) is ready for admin approval.`,
          targetRole: UserRole.ADMIN,
          data: {
            loanId: loan.id,
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
    // Covers a malformed body and Prisma's "record not found" alongside auth,
    // all of which used to reach the 500 below (TEST-18).
    const status = routeErrorStatus(err);
    if (status) {
      return NextResponse.json({ ok: false, error: routeErrorMessage(err, 'Failed to record the guarantor decision') }, { status });
    }
    // Never the raw message: it carries table and column names.
    console.error('[guarantor-approval] Error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to record the guarantor decision' }, { status: 500 });
  }
}
