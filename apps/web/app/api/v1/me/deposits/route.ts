import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { TransactionType } from '@prisma/client';

const isDev = process.env.NODE_ENV === 'development';

type Deposit = {
  id: string;
  amount: number;
  date: string;
  receiptNumber: string;
  status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';
  processedBy?: string | null;
  balanceAfter?: number | null;
};

function bigIntToNumber(v: bigint | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

export async function GET(req: Request) {
  try {
    const auth = requireAuth(req);

    const txs = await prisma.transaction.findMany({
      where: {
        userId: auth.id,
        type: TransactionType.DEPOSIT,
        status: { in: ['PENDING', 'CONFIRMED', 'DISPUTED', 'REJECTED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        receiptNumber: true,
        status: true,
        description: true,
        processedBy: true,
        savingsAfter: true,
        loanAfter: true,
        createdAt: true,
      },
    });

    const data: Deposit[] = txs.map((tx) => ({
      id: tx.id,
      amount: bigIntToNumber(tx.amount) ?? 0,
      date: tx.createdAt.toISOString(),
      receiptNumber: tx.receiptNumber ?? tx.id,
      status: tx.status as Deposit['status'],
      processedBy: tx.processedBy,
      balanceAfter: bigIntToNumber(tx.savingsAfter ?? tx.loanAfter ?? null),
    }));

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Unauthorized';
    console.error('[Me/Deposits] Error:', msg);
    if (msg.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to fetch deposits', ...(isDev && { details: msg }) }, { status: 500 });
  }
}
