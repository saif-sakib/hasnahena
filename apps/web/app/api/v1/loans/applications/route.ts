import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { LoanStatus, UserRole } from '@prisma/client';

const isDev = process.env.NODE_ENV === 'development';

const bodySchema = z.object({
  amount: z.number().positive(),
  installments: z.number().int().positive(),
  purpose: z.string().min(3),
  guarantorId: z.string().min(1),
});

function makeLoanNumber() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `LN-${date}-${suffix}`;
}

// Convert BigInt fields to numbers for JSON serialization
function serializeLoan(loan: any) {
  return {
    ...loan,
    principalAmount: loan.principalAmount ? Number(loan.principalAmount) : null,
    remainingAmount: loan.remainingAmount ? Number(loan.remainingAmount) : null,
    installmentAmount: loan.installmentAmount ? Number(loan.installmentAmount) : null,
    applicationFee: loan.applicationFee ? Number(loan.applicationFee) : null,
    totalPaid: loan.totalPaid ? Number(loan.totalPaid) : null,
  };
}

export async function POST(req: Request) {
  try {
    const auth = requireAuth(req);
    const payload = bodySchema.parse(await req.json());

    const borrower = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true, status: true },
    });
    if (!borrower) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (borrower.role !== UserRole.MEMBER) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    if (borrower.status !== 'ACTIVE') return NextResponse.json({ ok: false, error: 'Account is not active' }, { status: 403 });

    const borrowerAccount = await prisma.account.findFirst({
      where: { userId: auth.id },
      select: { id: true, savingsBalance: true },
    });
    if (!borrowerAccount) return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });

    const minDepositRequired = BigInt(8000);
    const maxLoanMultiplier = BigInt(5);
    const amountBig = BigInt(Math.floor(payload.amount));
    const maxAllowed = borrowerAccount.savingsBalance * maxLoanMultiplier;
    if (borrowerAccount.savingsBalance < minDepositRequired || amountBig > maxAllowed) {
      return NextResponse.json(
        { ok: false, error: 'LOAN_ELIGIBILITY_FAILED', details: { requested: amountBig.toString(), maxAllowed: maxAllowed.toString() } },
        { status: 422 },
      );
    }

    const guarantor = await prisma.user.findUnique({
      where: { id: payload.guarantorId },
      select: { id: true, role: true, status: true },
    });
    if (!guarantor || guarantor.role !== UserRole.MEMBER) {
      return NextResponse.json({ ok: false, error: 'Guarantor not found' }, { status: 404 });
    }

    const guarantorAccount = await prisma.account.findFirst({
      where: { userId: guarantor.id },
      select: { savingsBalance: true },
    });
    const guarantorDeposit = guarantorAccount ? guarantorAccount.savingsBalance : BigInt(0);
    if (guarantorDeposit < amountBig) {
      return NextResponse.json({ ok: false, error: 'GUARANTOR_DECLINED' }, { status: 422 });
    }

    const installments = payload.installments;
    const installmentAmount = amountBig / BigInt(installments);
    if (installmentAmount <= BigInt(0)) {
      return NextResponse.json({ ok: false, error: 'Invalid installments' }, { status: 422 });
    }

    const duplicateWindowStart = new Date(Date.now() - 2 * 60 * 1000);
    const existingPendingLoan = await prisma.loan.findFirst({
      where: {
        borrowerId: auth.id,
        guarantorId: guarantor.id,
        principalAmount: amountBig,
        totalInstallments: installments,
        purpose: payload.purpose.trim(),
        status: { in: [LoanStatus.PENDING_GUARANTOR, LoanStatus.PENDING_APPROVAL] },
        createdAt: { gte: duplicateWindowStart },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (existingPendingLoan) {
      return NextResponse.json(
        { ok: false, error: 'DUPLICATE_LOAN_APPLICATION', details: { loanId: existingPendingLoan.id } },
        { status: 409 },
      );
    }

    const loan = await prisma.loan.create({
      data: {
        loanNumber: makeLoanNumber(),
        principalAmount: amountBig,
        remainingAmount: amountBig,
        totalInstallments: installments,
        installmentAmount,
        paidInstallments: 0,
        purpose: payload.purpose.trim(),
        applicationFee: BigInt(0),
        status: LoanStatus.PENDING_GUARANTOR,
        borrowerId: auth.id,
        accountId: borrowerAccount.id,
        guarantorId: guarantor.id,
      },
      include: {
        borrower: {
          select: { nameEn: true, memberId: true },
        },
        guarantor: {
          select: { nameEn: true, memberId: true },
        },
      },
    });

    // Create notification for guarantor to approve the loan
    await prisma.notification.create({
      data: {
        type: 'LOAN_REQUEST',
        title: 'Guarantor Request',
        message: `${loan.borrower.nameEn} has requested you to be their guarantor for a loan of ৳${Number(amountBig).toLocaleString()}`,
        targetUserId: guarantor.id,
        data: {
          loanId: loan.id,
          loanNumber: loan.loanNumber,
          borrowerId: auth.id,
          borrowerName: loan.borrower.nameEn,
          amount: Number(amountBig),
          purpose: payload.purpose.trim(),
        },
      },
    });

    // Create notification for admins about the new loan application
    await prisma.notification.create({
      data: {
        type: 'LOAN_REQUEST',
        title: 'New Loan Application',
        message: `${loan.borrower.nameEn} (${loan.borrower.memberId}) has applied for a loan of ৳${Number(amountBig).toLocaleString()}`,
        targetRole: UserRole.ADMIN,
        data: {
          loanId: loan.id,
          loanNumber: loan.loanNumber,
          borrowerId: auth.id,
          borrowerName: loan.borrower.nameEn,
          guarantorId: guarantor.id,
          guarantorName: loan.guarantor?.nameEn ?? 'Guarantor',
          amount: Number(amountBig),
          installments,
          purpose: payload.purpose.trim(),
        },
      },
    });

    return NextResponse.json({ ok: true, data: serializeLoan(loan) }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Validation failed', ...(isDev && { details: err.flatten() }) }, { status: 400 });
    }
    const msg = typeof (err as any)?.message === 'string' ? (err as any).message : 'Server error';
    console.error('[Loans/Applications] Error:', msg);
    if (msg.toLowerCase().includes('authorization')) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ ok: false, error: 'Failed to create loan application', ...(isDev && { details: msg }) }, { status: 500 });
  }
}
