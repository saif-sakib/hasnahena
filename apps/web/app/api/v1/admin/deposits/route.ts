import { NextRequest, NextResponse } from 'next/server';
import { TransactionStatus, TransactionType, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

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

    const txs = await prisma.transaction.findMany({
      where: {
        type: { in: [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL] },
        status: { in: [TransactionStatus.PENDING, TransactionStatus.PROCESSED, TransactionStatus.CONFIRMED, TransactionStatus.DISPUTED, TransactionStatus.REJECTED] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            nameEn: true,
            nameBn: true,
            memberId: true,
          },
        },
      },
      take: 300,
    });

    const data = txs.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: toNumber(tx.amount) ?? 0,
      status: tx.status,
      receiptNumber: tx.receiptNumber ?? tx.id,
      notes: tx.description,
      processedBy: tx.processedBy,
      processedDate: tx.processedAt?.toISOString() ?? tx.createdAt.toISOString(),
      confirmedDate: tx.confirmedAt?.toISOString() ?? null,
      balanceAfter: toNumber(tx.savingsAfter ?? tx.loanAfter) ?? null,
      member: {
        id: tx.user.id,
        memberId: tx.user.memberId,
        name: tx.user.nameBn ?? tx.user.nameEn,
      },
      createdAt: tx.createdAt.toISOString(),
    }));

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch deposits';
    if (message.toLowerCase().includes('authorization') || message.toLowerCase().includes('token')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

