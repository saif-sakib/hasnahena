import { NextRequest, NextResponse } from 'next/server';
import { TransactionStatus, TransactionType, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const isDev = process.env.NODE_ENV === 'development';

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

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '100', 10) || 100));
    const skip = (page - 1) * limit;

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
      skip,
      take: limit,
    });

    const processorIds = [...new Set(txs.map((tx) => tx.processedBy).filter((v): v is string => Boolean(v)))];
    const processors =
      processorIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: processorIds } },
            select: { id: true, nameEn: true, nameBn: true },
          })
        : [];
    const processorMap = new Map(processors.map((user) => [user.id, user.nameBn ?? user.nameEn]));

    const data = txs.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: toNumber(tx.amount) ?? 0,
      status: tx.status,
      receiptNumber: tx.receiptNumber ?? tx.id,
      notes: tx.description,
      processedBy: tx.processedBy ? (processorMap.get(tx.processedBy) ?? tx.processedBy) : null,
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
    console.error('[Admin/Deposits] Error:', message);
    if (message.toLowerCase().includes('authorization') || message.toLowerCase().includes('token')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to fetch deposits', ...(isDev && { details: message }) }, { status: 500 });
  }
}
