import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { TransactionStatus, TransactionType, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const bodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().optional(),
});

function toNumber(v: bigint | null | undefined) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function serializeTransaction(tx: any) {
  return {
    ...tx,
    amount: toNumber(tx.amount),
    savingsAfter: toNumber(tx.savingsAfter),
    loanAfter: toNumber(tx.loanAfter),
    disputeCorrectAmount: toNumber(tx.disputeCorrectAmount),
  };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authUser = requireAuth(req);
    if (authUser.role !== UserRole.ADMIN && authUser.role !== UserRole.SUPER_ADMIN) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { action, reason } = bodySchema.parse(await req.json());
    const txId = params.id;

    const tx = await prisma.transaction.findUnique({
      where: { id: txId },
      select: {
        id: true,
        userId: true,
        amount: true,
        type: true,
        status: true,
        receiptNumber: true,
      },
    });
    if (!tx) return NextResponse.json({ ok: false, error: 'Transaction not found' }, { status: 404 });
    if (tx.status !== TransactionStatus.PENDING) {
      return NextResponse.json({ ok: false, error: 'Only pending transactions can be reviewed' }, { status: 409 });
    }
    if (tx.type !== TransactionType.DEPOSIT && tx.type !== TransactionType.WITHDRAWAL) {
      return NextResponse.json({ ok: false, error: 'Unsupported transaction type' }, { status: 422 });
    }

    if (action === 'reject') {
      const rejected = await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: TransactionStatus.REJECTED,
          processedAt: new Date(),
          processedBy: authUser.id,
          description: reason ? `${tx.type} rejected: ${reason}` : `${tx.type} rejected`,
        },
      });

      await prisma.notification.create({
        data: {
          type: 'SYSTEM_ALERT',
          title: `${tx.type === TransactionType.DEPOSIT ? 'Deposit' : 'Withdrawal'} Rejected`,
          message: tx.type === TransactionType.DEPOSIT
            ? `Your deposit request for ৳${Number(tx.amount).toLocaleString()} was rejected.`
            : `Your withdrawal request for ৳${Number(tx.amount).toLocaleString()} was rejected.`,
          targetUserId: tx.userId,
          data: {
            transactionId: tx.id,
            action,
            reason: reason ?? null,
          },
        },
      });

      return NextResponse.json({ ok: true, data: serializeTransaction(rejected) });
    }

    if (tx.type === TransactionType.DEPOSIT) {
      const processed = await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: TransactionStatus.PROCESSED,
          processedAt: new Date(),
          processedBy: authUser.id,
          description: reason ? `Deposit processed: ${reason}` : undefined,
        },
      });

      await prisma.notification.create({
        data: {
          type: 'SYSTEM_ALERT',
          title: 'Deposit Ready for Confirmation',
          message: `Your deposit request for ৳${Number(tx.amount).toLocaleString()} has been processed. Please confirm it.`,
          targetUserId: tx.userId,
          data: {
            transactionId: tx.id,
            action,
            receiptNumber: tx.receiptNumber,
          },
        },
      });

      return NextResponse.json({ ok: true, data: serializeTransaction(processed) });
    }

    const updated = await prisma.$transaction(async (trx) => {
      const account = await trx.account.findFirst({
        where: { userId: tx.userId },
        select: { id: true, savingsBalance: true, loanBalance: true },
      });
      if (!account) throw new Error('Account not found');

      const newSavings = account.savingsBalance - tx.amount;
      if (newSavings < BigInt(0)) throw new Error('INSUFFICIENT_FUNDS');

      await trx.account.update({
        where: { id: account.id },
        data: { savingsBalance: newSavings, loanBalance: account.loanBalance },
      });

      return trx.transaction.update({
        where: { id: tx.id },
        data: {
          status: TransactionStatus.CONFIRMED,
          processedAt: new Date(),
          confirmedAt: new Date(),
          processedBy: authUser.id,
          savingsAfter: newSavings,
          loanAfter: account.loanBalance,
          description: reason ? `Withdrawal approved: ${reason}` : undefined,
        },
      });
    });

    await prisma.notification.create({
      data: {
        type: 'WITHDRAWAL_REQUEST',
        title: 'Withdrawal Approved',
        message: `Your withdrawal request for ৳${Number(tx.amount).toLocaleString()} has been approved.`,
        targetUserId: tx.userId,
        data: {
          transactionId: tx.id,
          action,
          receiptNumber: tx.receiptNumber,
        },
      },
    });

    return NextResponse.json({ ok: true, data: serializeTransaction(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Validation failed', details: error.flatten() }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Failed to process deposit review';
    if (message.toLowerCase().includes('authorization') || message.toLowerCase().includes('token')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (message.includes('INSUFFICIENT_FUNDS')) {
      return NextResponse.json({ ok: false, error: 'INSUFFICIENT_FUNDS' }, { status: 422 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
