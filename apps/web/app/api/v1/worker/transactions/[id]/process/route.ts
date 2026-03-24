import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { TransactionStatus, TransactionType, UserRole } from '@prisma/client';

function nowIso() {
  return new Date();
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = requireAuth(req);

    const worker = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true, nameBn: true, nameEn: true },
    });
    if (!worker) return NextResponse.json({ ok: false, error: 'Worker not found' }, { status: 404 });
    if (worker.role !== UserRole.WORKER && worker.role !== UserRole.ADMIN) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const tx = await prisma.transaction.findUnique({
      where: { id: params.id },
      select: { id: true, type: true, amount: true, status: true, accountId: true, userId: true },
    });
    if (!tx) return NextResponse.json({ ok: false, error: 'Transaction not found' }, { status: 404 });
    if (tx.status !== TransactionStatus.PENDING) {
      return NextResponse.json({ ok: false, error: 'Invalid transaction state' }, { status: 409 });
    }

    const workerName = worker.nameBn ?? worker.nameEn ?? 'Worker';
    const t = nowIso();

    const { nextStatus, accountDeltaSavings, accountDeltaLoan } =
      tx.type === TransactionType.DEPOSIT
        ? { nextStatus: TransactionStatus.CONFIRMED, accountDeltaSavings: tx.amount, accountDeltaLoan: BigInt(0) }
        : tx.type === TransactionType.WITHDRAWAL
          ? { nextStatus: TransactionStatus.PROCESSED, accountDeltaSavings: BigInt(0), accountDeltaLoan: BigInt(0) }
          : tx.type === TransactionType.LOAN_DISBURSEMENT
            ? { nextStatus: TransactionStatus.CONFIRMED, accountDeltaSavings: BigInt(0), accountDeltaLoan: tx.amount }
            : tx.type === TransactionType.LOAN_REPAYMENT
              ? { nextStatus: TransactionStatus.CONFIRMED, accountDeltaSavings: tx.amount, accountDeltaLoan: -tx.amount }
              : { nextStatus: TransactionStatus.CONFIRMED, accountDeltaSavings: BigInt(0), accountDeltaLoan: BigInt(0) };

    const updated = await prisma.$transaction(async (prismaTx) => {
      if (accountDeltaSavings !== BigInt(0) || accountDeltaLoan !== BigInt(0)) {
        const account = await prismaTx.account.findUnique({
          where: { id: tx.accountId },
          select: { id: true, savingsBalance: true, loanBalance: true },
        });
        if (!account) throw new Error('Account not found');

        const newSavings = account.savingsBalance + accountDeltaSavings;
        const newLoan = account.loanBalance + accountDeltaLoan;
        if (newSavings < BigInt(0)) throw new Error('INSUFFICIENT_FUNDS');

        await prismaTx.account.update({
          where: { id: account.id },
          data: { savingsBalance: newSavings, loanBalance: newLoan },
        });

        await prismaTx.transaction.update({
          where: { id: tx.id },
          data: {
            status: nextStatus,
            processedAt: t,
            processedBy: workerName,
            savingsAfter: newSavings,
            loanAfter: newLoan,
          },
        });

        return { newSavings, newLoan };
      }

      await prismaTx.transaction.update({
        where: { id: tx.id },
        data: {
          status: nextStatus,
          processedAt: t,
          processedBy: workerName,
        },
      });

      return { newSavings: null, newLoan: null };
    });

    return NextResponse.json({ ok: true, data: { processed: true, txId: tx.id, ...updated } });
  } catch (err: any) {
    if (err?.message?.includes('INSUFFICIENT_FUNDS')) {
      return NextResponse.json({ ok: false, error: 'INSUFFICIENT_FUNDS' }, { status: 422 });
    }
    console.error('Worker process failed:', err);
    const msg = typeof err?.message === 'string' ? err.message : 'Server error';
    if (msg.toLowerCase().includes('authorization')) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
