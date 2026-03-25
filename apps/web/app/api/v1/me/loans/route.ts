import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { LoanStatus, UserRole, UserStatus } from '@prisma/client';

const isDev = process.env.NODE_ENV === 'development';

type LoanUi = {
  id: string;
  loanNumber: string;
  principalAmount: number;
  remainingAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  installmentAmount: number;
  disbursementDate?: string;
  nextDueDate?: string;
  purpose: string;
  status:
    | 'PENDING_GUARANTOR'
    | 'PENDING_APPROVAL'
    | 'APPROVED'
    | 'ACTIVE'
    | 'COMPLETED'
    | 'DEFAULTED'
    | 'REJECTED';
  guarantor?: string;
};

type GuarantorRequestUi = {
  id: string;
  borrowerName: string;
  loanAmount: number;
  requestDate: string;
};

type AvailableGuarantorUi = {
  id: string;
  name: string;
  deposit: number;
};

function bigIntToNumber(v: bigint | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : 0;
}

function toUiLoanStatus(status: LoanStatus): LoanUi['status'] {
  // UI doesn’t know about some legacy/system states.
  switch (status) {
    case LoanStatus.PENDING:
      return 'PENDING_GUARANTOR';
    case LoanStatus.PENDING_GUARANTOR:
      return 'PENDING_GUARANTOR';
    case LoanStatus.PENDING_APPROVAL:
      return 'PENDING_APPROVAL';
    case LoanStatus.APPROVED:
      return 'APPROVED';
    case LoanStatus.ACTIVE:
      return 'ACTIVE';
    case LoanStatus.COMPLETED:
    case LoanStatus.SETTLED:
      return 'COMPLETED';
    case LoanStatus.DEFAULTED:
      return 'DEFAULTED';
    case LoanStatus.REJECTED:
      return 'REJECTED';
    default:
      return 'REJECTED';
  }
}

export async function GET(req: Request) {
  try {
    const auth = requireAuth(req);

    const account = await prisma.account.findFirst({
      where: { userId: auth.id },
      select: { savingsBalance: true },
    });

    const currentDeposit = account ? bigIntToNumber(account.savingsBalance) : 0;

    const borrowerLoans = await prisma.loan.findMany({
      where: { borrowerId: auth.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        loanNumber: true,
        principalAmount: true,
        remainingAmount: true,
        totalInstallments: true,
        installmentAmount: true,
        paidInstallments: true,
        disbursementDate: true,
        purpose: true,
        status: true,
        guarantor: { select: { nameEn: true, nameBn: true } },
        createdAt: true,
      },
    });

    // The UI shows a single "current loan" card; include the whole workflow so
    // borrowers can see pending applications too.
    const allowedActiveLoanStatuses: LoanStatus[] = [
      LoanStatus.PENDING,
      LoanStatus.PENDING_GUARANTOR,
      LoanStatus.PENDING_APPROVAL,
      LoanStatus.APPROVED,
      LoanStatus.ACTIVE,
    ];
    const activeLoanRow =
      borrowerLoans.find((l) => allowedActiveLoanStatuses.includes(l.status)) ?? null;
    const activeLoan: LoanUi | null = activeLoanRow
      ? {
          id: activeLoanRow.id,
          loanNumber: activeLoanRow.loanNumber,
          principalAmount: bigIntToNumber(activeLoanRow.principalAmount),
          remainingAmount: bigIntToNumber(activeLoanRow.remainingAmount),
          totalInstallments: activeLoanRow.totalInstallments,
          paidInstallments: activeLoanRow.paidInstallments,
          installmentAmount: bigIntToNumber(activeLoanRow.installmentAmount),
          disbursementDate: activeLoanRow.disbursementDate ? activeLoanRow.disbursementDate.toISOString() : undefined,
          nextDueDate: undefined,
          purpose: activeLoanRow.purpose ?? '',
          status: toUiLoanStatus(activeLoanRow.status),
          guarantor: activeLoanRow.guarantor ? activeLoanRow.guarantor.nameBn ?? activeLoanRow.guarantor.nameEn : undefined,
        }
      : null;

    const loanHistoryRows = borrowerLoans.filter((l) =>
      [LoanStatus.COMPLETED, LoanStatus.SETTLED, LoanStatus.DEFAULTED, LoanStatus.REJECTED].includes(l.status as any),
    );

    const loanHistory: LoanUi[] = loanHistoryRows.map((row) => ({
      id: row.id,
      loanNumber: row.loanNumber,
      principalAmount: bigIntToNumber(row.principalAmount),
      remainingAmount: bigIntToNumber(row.remainingAmount),
      totalInstallments: row.totalInstallments,
      paidInstallments: row.paidInstallments,
      installmentAmount: bigIntToNumber(row.installmentAmount),
      disbursementDate: row.disbursementDate ? row.disbursementDate.toISOString() : undefined,
      nextDueDate: undefined,
      purpose: row.purpose ?? '',
      status: toUiLoanStatus(row.status),
      guarantor: row.guarantor ? row.guarantor.nameBn ?? row.guarantor.nameEn : undefined,
    }));

    const guarantorRequestsRows = await prisma.loan.findMany({
      where: { guarantorId: auth.id, status: LoanStatus.PENDING_GUARANTOR },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        principalAmount: true,
        createdAt: true,
        borrower: { select: { nameEn: true, nameBn: true } },
      },
    });

    const guarantorRequests: GuarantorRequestUi[] = guarantorRequestsRows.map((row) => ({
      id: row.id,
      borrowerName: row.borrower?.nameBn ?? row.borrower?.nameEn ?? '',
      loanAmount: bigIntToNumber(row.principalAmount),
      requestDate: row.createdAt.toISOString(),
    }));

    const availableGuarantorsRows = await prisma.user.findMany({
      where: { role: UserRole.MEMBER, status: UserStatus.ACTIVE, id: { not: auth.id } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        nameEn: true,
        nameBn: true,
        accounts: {
          take: 1,
          select: { savingsBalance: true },
        },
      },
    });

    const availableGuarantors: AvailableGuarantorUi[] = availableGuarantorsRows.map((u) => ({
      id: u.id,
      name: u.nameBn ?? u.nameEn,
      deposit: bigIntToNumber(u.accounts[0]?.savingsBalance ?? BigInt(0)),
    }));

    return NextResponse.json({
      ok: true,
      data: {
        currentDeposit,
        activeLoan,
        loanHistory,
        guarantorRequests,
        availableGuarantors,
      },
    });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Unauthorized';
    console.error('[Me/Loans] Error:', msg);
    if (msg.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to fetch loans', ...(isDev && { details: msg }) }, { status: 500 });
  }
}

