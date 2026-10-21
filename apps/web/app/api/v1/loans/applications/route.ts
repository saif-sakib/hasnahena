import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';
import { serializeLoan } from '@/lib/api-utils';
import { SERIES, nextDocumentNumber } from '@/lib/document-numbers';
import { LoanStatus, UserRole } from '@prisma/client';
import { formatMoney } from '@/lib/notify';

const isDev = process.env.NODE_ENV === 'development';

// guarantorId is optional at or below loan.guarantorThresholdAmount (checked
// below). The amount is .int().finite(): 1e400 parses as Infinity (TEST-18), and
// a fraction is refused, never rounded (rule 1). Cap = Go's MaxLoanAmount (ADR-002).
const MAX_LOAN_AMOUNT = 1_00_00_000;
const MAX_INSTALLMENTS = 600;

const bodySchema = z.object({
  amount: z.number().int().finite().positive().max(MAX_LOAN_AMOUNT),
  installments: z.number().int().finite().positive().max(MAX_INSTALLMENTS),
  purpose: z.string().min(3).max(500),
  guarantorId: z.string().min(1).max(200).optional(),
});

async function getLoanPolicySettings() {
  const configs = await prisma.systemConfig.findMany({
    where: {
      key: {
        in: [
          'loan.minDepositForLoan',
          'loan.maxLoanMultiplier',
          'loan.maxInstallmentMonths',
          'loan.guarantorThresholdAmount',
        ],
      },
    },
    select: { key: true, value: true },
  });
  const map = configs.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
  // Zero is nonsense for a multiplier or instalment cap: fall back.
  const parsePositiveInt = (raw: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  // Zero is a real setting for a minimum or a threshold.
  const parseNonNegativeInt = (raw: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    // Non-negative, as the Go API reads it.
    minDepositForLoan: parseNonNegativeInt(map['loan.minDepositForLoan'], 8000),
    maxLoanMultiplier: parsePositiveInt(map['loan.maxLoanMultiplier'], 5),
    maxInstallmentMonths: parsePositiveInt(map['loan.maxInstallmentMonths'], 24),
    guarantorThresholdAmount: parseNonNegativeInt(map['loan.guarantorThresholdAmount'], 20000),
  };
}

export async function POST(req: Request) {
  try {
    const auth = await requireActiveAuth(req);

    // Authorization before validation (TEST-16).
    const borrower = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true, status: true },
    });
    if (!borrower) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (borrower.role !== UserRole.MEMBER) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    if (borrower.status !== 'ACTIVE') return NextResponse.json({ ok: false, error: 'Account is not active' }, { status: 403 });

    const payload = bodySchema.parse(await readJsonBody(req));

    const borrowerAccount = await prisma.account.findFirst({
      where: { userId: auth.id },
      select: { savingsBalance: true },
    });
    if (!borrowerAccount) return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });

    const loanPolicy = await getLoanPolicySettings();
    if (payload.installments > loanPolicy.maxInstallmentMonths) {
      return NextResponse.json(
        { ok: false, error: 'INSTALLMENT_LIMIT_EXCEEDED' },
        { status: 422 },
      );
    }

    const minDepositRequired = BigInt(loanPolicy.minDepositForLoan);
    const maxLoanMultiplier = BigInt(loanPolicy.maxLoanMultiplier);
    // Already a whole number (schema).
    const amountBig = BigInt(payload.amount);
    const maxAllowed = borrowerAccount.savingsBalance * maxLoanMultiplier;
    if (borrowerAccount.savingsBalance < minDepositRequired || amountBig > maxAllowed) {
      return NextResponse.json(
        { ok: false, error: 'LOAN_ELIGIBILITY_FAILED', details: { requested: amountBig.toString(), maxAllowed: maxAllowed.toString() } },
        { status: 422 },
      );
    }

    // A guarantor only above the threshold; below it, straight to admin review.
    const guarantorRequired = amountBig > BigInt(loanPolicy.guarantorThresholdAmount);
    if (guarantorRequired && !payload.guarantorId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'GUARANTOR_REQUIRED',
          details: { threshold: loanPolicy.guarantorThresholdAmount.toString() },
        },
        { status: 422 },
      );
    }

    let guarantor: { id: string } | null = null;
    if (payload.guarantorId) {
      const found = await prisma.user.findUnique({
        where: { id: payload.guarantorId },
        select: { id: true, role: true, status: true },
      });
      if (!found || found.role !== UserRole.MEMBER || found.status !== 'ACTIVE') {
        return NextResponse.json({ ok: false, error: 'Guarantor not found' }, { status: 404 });
      }
      if (found.id === auth.id) {
        return NextResponse.json({ ok: false, error: 'GUARANTOR_IS_SELF' }, { status: 422 });
      }

      // The guarantee is proportional (the guarantor's savings are what the
      // waterfall takes); refuse only a guarantee worth nothing.
      const guarantorAccount = await prisma.account.findFirst({
        where: { userId: found.id },
        select: { savingsBalance: true },
      });
      const guarantorDeposit = guarantorAccount ? guarantorAccount.savingsBalance : BigInt(0);
      if (guarantorDeposit <= BigInt(0)) {
        return NextResponse.json({ ok: false, error: 'GUARANTOR_HAS_NO_SAVINGS' }, { status: 422 });
      }

      guarantor = { id: found.id };
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
        guarantorId: guarantor?.id ?? null,
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
        // The loan number IS the row id (ADR-044).
        id: await nextDocumentNumber(SERIES.loan),
        principalAmount: amountBig,
        remainingAmount: amountBig,
        totalInstallments: installments,
        installmentAmount,
        paidInstallments: 0,
        purpose: payload.purpose.trim(),
        applicationFee: BigInt(0),
        // No guarantor → straight to admin review.
        status: guarantor ? LoanStatus.PENDING_GUARANTOR : LoanStatus.PENDING_APPROVAL,
        borrowerId: auth.id,
        guarantorId: guarantor?.id ?? null,
      },
      include: {
        borrower: {
          select: { nameEn: true, accountNo: true },
        },
        guarantor: {
          select: { nameEn: true, accountNo: true },
        },
      },
    });

    // Notify the guarantor, if there is one.
    if (guarantor) {
      await prisma.notification.create({
        data: {
          type: 'LOAN_REQUEST',
          title: 'Guarantor Request',
          message: `${loan.borrower.nameEn} has requested you to be their guarantor for a loan of ${formatMoney(amountBig)}`,
          targetUserId: guarantor.id,
          data: {
            loanId: loan.id,
                        borrowerId: auth.id,
            borrowerName: loan.borrower.nameEn,
            amount: Number(amountBig),
            purpose: payload.purpose.trim(),
          },
        },
      });
    }

    // Create notification for admins about the new loan application
    await prisma.notification.create({
      data: {
        type: 'LOAN_REQUEST',
        title: 'New Loan Application',
        message: `${loan.borrower.nameEn} (${loan.borrower.accountNo}) has applied for a loan of ${formatMoney(amountBig)}`,
        targetRole: UserRole.ADMIN,
        data: {
          loanId: loan.id,
                    borrowerId: auth.id,
          borrowerName: loan.borrower.nameEn,
          guarantorId: guarantor?.id ?? null,
          guarantorName: loan.guarantor?.nameEn ?? null,
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
    const status = routeErrorStatus(err);
    if (status) {
      return NextResponse.json({ ok: false, error: routeErrorMessage(err, 'Failed to create loan application') }, { status });
    }
    console.error('[Loans/Applications] Error:', msg);
    return NextResponse.json({ ok: false, error: 'Failed to create loan application', ...(isDev && { details: msg }) }, { status: 500 });
  }
}
