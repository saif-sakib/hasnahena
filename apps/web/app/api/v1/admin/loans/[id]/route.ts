import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LoanStatus, TransactionStatus, TransactionType, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const bodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().optional(),
});

function nextExpectedEndDate(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.max(1, months));
  return d;
}

function toNumber(v: bigint | null | undefined) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function serializeLoan(loan: any) {
  return {
    ...loan,
    principalAmount: toNumber(loan.principalAmount),
    remainingAmount: toNumber(loan.remainingAmount),
    installmentAmount: toNumber(loan.installmentAmount),
    applicationFee: toNumber(loan.applicationFee),
  };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authUser = requireAuth(req);
    if (authUser.role !== UserRole.ADMIN && authUser.role !== UserRole.SUPER_ADMIN) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { action, reason } = bodySchema.parse(await req.json());
    const loanId = params.id;

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: {
        id: true,
        loanNumber: true,
        borrowerId: true,
        accountId: true,
        principalAmount: true,
        totalInstallments: true,
        status: true,
      },
    });
    if (!loan) return NextResponse.json({ ok: false, error: 'Loan not found' }, { status: 404 });
    if (loan.status !== LoanStatus.PENDING_APPROVAL) {
      return NextResponse.json({ ok: false, error: 'Only pending-approval loans can be reviewed' }, { status: 409 });
    }

    if (action === 'reject') {
      const updated = await prisma.loan.update({
        where: { id: loan.id },
        data: {
          status: LoanStatus.REJECTED,
          approvedBy: authUser.id,
          approvedAt: new Date(),
        },
      });

      await prisma.notification.create({
        data: {
          type: 'LOAN_REJECTED',
          title: 'Loan Rejected',
          message: `Your loan application ${loan.loanNumber} was rejected.`,
          targetUserId: loan.borrowerId,
          data: {
            loanId: loan.id,
            loanNumber: loan.loanNumber,
            action,
            reason: reason ?? null,
          },
        },
      });

      return NextResponse.json({ ok: true, data: serializeLoan(updated) });
    }

    const now = new Date();
    const expectedEndDate = nextExpectedEndDate(loan.totalInstallments);

    const updated = await prisma.$transaction(async (trx) => {
      const account = await trx.account.findUnique({
        where: { id: loan.accountId },
        select: { id: true, savingsBalance: true, loanBalance: true },
      });
      if (!account) throw new Error('Account not found');

      const newLoanBalance = account.loanBalance + loan.principalAmount;

      await trx.account.update({
        where: { id: account.id },
        data: { loanBalance: newLoanBalance },
      });

      await trx.transaction.create({
        data: {
          type: TransactionType.LOAN_DISBURSEMENT,
          amount: loan.principalAmount,
          status: TransactionStatus.CONFIRMED,
          processedAt: now,
          confirmedAt: now,
          processedBy: authUser.id,
          accountId: account.id,
          userId: loan.borrowerId,
          loanId: loan.id,
          loanAfter: newLoanBalance,
          savingsAfter: account.savingsBalance,
          description: reason ? `Loan approved: ${reason}` : 'Loan approved by admin',
        },
      });

      return trx.loan.update({
        where: { id: loan.id },
        data: {
          status: LoanStatus.ACTIVE,
          approvedBy: authUser.id,
          approvedAt: now,
          disbursementDate: now,
          installmentStartDate: now,
          expectedEndDate,
        },
      });
    });

    await prisma.notification.create({
      data: {
        type: 'LOAN_APPROVED',
        title: 'Loan Approved',
        message: `Your loan application ${loan.loanNumber} has been approved.`,
        targetUserId: loan.borrowerId,
        data: {
          loanId: loan.id,
          loanNumber: loan.loanNumber,
          action,
        },
      },
    });

    return NextResponse.json({ ok: true, data: serializeLoan(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Validation failed', details: error.flatten() }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Failed to process loan review';
    if (message.toLowerCase().includes('authorization') || message.toLowerCase().includes('token')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
