import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { TransactionType } from '@prisma/client';

const isDev = process.env.NODE_ENV === 'development';

type UiTransaction = {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_DISBURSEMENT' | 'LOAN_REPAYMENT';
  amount: number;
  date: string;
  receiptNumber: string;
  description?: string | null;
  status: 'PENDING' | 'PROCESSED' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';
  balanceAfter?: number | null;
  processedBy?: string | null;
};

function bigIntToNumber(v: bigint | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) return undefined;
  return n;
}

export async function GET(req: Request) {
  try {
    const auth = requireAuth(req);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: auth.id,
        type: { in: [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL, TransactionType.LOAN_DISBURSEMENT, TransactionType.LOAN_REPAYMENT] },
        status: { in: ['PENDING', 'PROCESSED', 'CONFIRMED', 'DISPUTED', 'REJECTED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        amount: true,
        receiptNumber: true,
        description: true,
        status: true,
        savingsAfter: true,
        loanAfter: true,
        processedBy: true,
        createdAt: true,
      },
    });

    const data: UiTransaction[] = transactions.map((tx) => ({
      id: tx.id,
      type: tx.type as UiTransaction['type'],
      amount: bigIntToNumber(tx.amount) ?? 0,
      date: tx.createdAt.toISOString(),
      receiptNumber: tx.receiptNumber ?? tx.id,
      description: tx.description,
      status: tx.status as UiTransaction['status'],
      balanceAfter: bigIntToNumber(tx.savingsAfter ?? tx.loanAfter ?? null) ?? undefined,
      processedBy: tx.processedBy,
    }));

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Unauthorized';
    console.error('[Me/Transactions] Error:', msg);
    if (msg.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to fetch transactions', ...(isDev && { details: msg }) }, { status: 500 });
  }
}

