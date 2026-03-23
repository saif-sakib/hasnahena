import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { LoanStatus, UserRole } from '@prisma/client';

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
    });

    return NextResponse.json({ ok: true, data: loan }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Validation failed', details: err.flatten() }, { status: 400 });
    }
    const msg = typeof (err as any)?.message === 'string' ? (err as any).message : 'Server error';
    if (msg.toLowerCase().includes('authorization')) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    console.error('Loan application failed:', err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

