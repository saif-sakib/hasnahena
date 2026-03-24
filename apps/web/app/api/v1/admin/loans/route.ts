import { NextRequest, NextResponse } from 'next/server';
import { LoanStatus, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

function toNumber(v: bigint | null | undefined) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const authUser = requireAuth(req);
    if (authUser.role !== UserRole.ADMIN && authUser.role !== UserRole.SUPER_ADMIN) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const loans = await prisma.loan.findMany({
      where: {
        status: {
          in: [
            LoanStatus.PENDING_GUARANTOR,
            LoanStatus.PENDING_APPROVAL,
            LoanStatus.APPROVED,
            LoanStatus.ACTIVE,
            LoanStatus.COMPLETED,
            LoanStatus.SETTLED,
            LoanStatus.DEFAULTED,
            LoanStatus.REJECTED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        borrower: {
          select: { id: true, memberId: true, nameEn: true, nameBn: true },
        },
        guarantor: {
          select: { id: true, nameEn: true, nameBn: true },
        },
        account: {
          select: { savingsBalance: true },
        },
      },
      take: 300,
    });

    const data = loans.map((loan) => ({
      id: loan.id,
      loanNumber: loan.loanNumber,
      status: loan.status,
      amount: toNumber(loan.principalAmount) ?? 0,
      paidAmount: (toNumber(loan.principalAmount) ?? 0) - (toNumber(loan.remainingAmount) ?? 0),
      remainingAmount: toNumber(loan.remainingAmount) ?? 0,
      installmentsPaid: loan.paidInstallments,
      totalInstallments: loan.totalInstallments,
      monthlyInstallment: toNumber(loan.installmentAmount) ?? 0,
      purpose: loan.purpose ?? '',
      approvedDate: loan.approvedAt?.toISOString() ?? null,
      disbursedDate: loan.disbursementDate?.toISOString() ?? null,
      dueDate: loan.expectedEndDate?.toISOString() ?? null,
      member: {
        id: loan.borrower.id,
        memberId: loan.borrower.memberId,
        name: loan.borrower.nameBn ?? loan.borrower.nameEn,
      },
      guarantor: loan.guarantor
        ? {
            id: loan.guarantor.id,
            name: loan.guarantor.nameBn ?? loan.guarantor.nameEn,
          }
        : null,
      memberDeposit: toNumber(loan.account.savingsBalance) ?? 0,
      missedPayments: 0,
      createdAt: loan.createdAt.toISOString(),
    }));

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch loans';
    if (message.toLowerCase().includes('authorization') || message.toLowerCase().includes('token')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

