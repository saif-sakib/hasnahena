import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { serializeTransaction } from '@/lib/api-utils';
import { TransactionStatus, TransactionType, UserRole } from '@prisma/client';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = requireAuth(req);

    const member = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true, nameEn: true },
    });
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (member.role !== UserRole.MEMBER) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const tx = await prisma.transaction.findUnique({
      where: { id },
      select: { id: true, type: true, amount: true, status: true, userId: true, accountId: true, receiptNumber: true },
    });
    if (!tx) return NextResponse.json({ ok: false, error: 'Transaction not found' }, { status: 404 });
    if (tx.userId !== auth.id) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    if (tx.status !== TransactionStatus.PROCESSED) return NextResponse.json({ ok: false, error: 'Invalid state' }, { status: 409 });
    if (tx.type !== TransactionType.WITHDRAWAL) {
      return NextResponse.json({ ok: false, error: 'Only withdrawals require member confirmation' }, { status: 422 });
    }

    const updated = await prisma.$transaction(async (prismaTx) => {
      const account = await prismaTx.account.findUnique({
        where: { id: tx.accountId },
        select: { id: true, savingsBalance: true },
      });
      if (!account) throw new Error('Account not found');

      const newSavings = account.savingsBalance - tx.amount;
      if (newSavings < BigInt(0)) throw new Error('INSUFFICIENT_FUNDS');

      await prismaTx.account.update({
        where: { id: account.id },
        data: { savingsBalance: newSavings },
      });

      const confirmedTx = await prismaTx.transaction.update({
        where: { id: tx.id },
        data: {
          status: TransactionStatus.CONFIRMED,
          confirmedAt: new Date(),
          savingsAfter: newSavings,
        },
      });

      return { newSavings, confirmedTx };
    });

    // Notify user about confirmed withdrawal handover
    prisma.notification.create({
      data: {
        type: 'WITHDRAWAL_REQUEST',
        title: 'Withdrawal Confirmed',
        message: `Your withdrawal of ৳${Number(tx.amount).toLocaleString()} has been confirmed.`,
        targetUserId: auth.id,
        data: {
          transactionId: tx.id,
          amount: Number(tx.amount),
          receiptNumber: tx.receiptNumber,
          newBalance: Number(updated.newSavings),
        },
      },
    }).catch((err) => console.error('Failed to create deposit confirmation notification:', err));

    return NextResponse.json({ ok: true, data: serializeTransaction(updated.confirmedTx) });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Server error';
    if (msg.toLowerCase().includes('authorization')) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    if (msg === 'Account not found') return NextResponse.json({ ok: false, error: msg }, { status: 404 });
    if (msg.includes('INSUFFICIENT_FUNDS')) return NextResponse.json({ ok: false, error: 'INSUFFICIENT_FUNDS' }, { status: 422 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
