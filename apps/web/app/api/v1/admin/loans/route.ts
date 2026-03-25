import { NextRequest, NextResponse } from 'next/server';
import { LoanStatus, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const isDev = process.env.NODE_ENV === 'development';

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

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '100', 10) || 100));
    const skip = (page - 1) * limit;

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
      skip,
      take: limit,
    });

    const approverIds = [...new Set(loans.map((loan) => loan.approvedBy).filter((v): v is string => Boolean(v)))];
    const approvers =
      approverIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: approverIds } },
            select: { id: true, nameEn: true, nameBn: true },
          })
        : [];
    const approverMap = new Map(approvers.map((user) => [user.id, user.nameBn ?? user.nameEn]));

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
      approvedBy: loan.approvedBy ? (approverMap.get(loan.approvedBy) ?? loan.approvedBy) : null,
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
    console.error('[Admin/Loans] Error:', message);
    if (message.toLowerCase().includes('authorization') || message.toLowerCase().includes('token')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to fetch loans', ...(isDev && { details: message }) }, { status: 500 });
  }
}
