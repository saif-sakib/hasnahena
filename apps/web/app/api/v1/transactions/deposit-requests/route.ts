import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { makeReceipt, serializeTransaction } from '@/lib/api-utils';
import { TransactionStatus, TransactionType, UserRole } from '@prisma/client';

const bodySchema = z.object({
  amount: z.number().positive(),
  receiptNumber: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const auth = requireAuth(req);
    const payload = bodySchema.parse(await req.json());

    // Ensure only members can create deposit requests.
    const member = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true, status: true },
    });
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (member.role !== UserRole.MEMBER) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const account = await prisma.account.findFirst({
      where: { userId: auth.id },
      select: { id: true },
    });
    if (!account) return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });

    const receiptNumber = payload.receiptNumber?.trim() || makeReceipt('RCP');
    const amountBig = BigInt(Math.floor(payload.amount));
    if (amountBig <= BigInt(0)) {
      return NextResponse.json({ ok: false, error: 'Invalid amount' }, { status: 400 });
    }

    const duplicateWindowStart = new Date(Date.now() - 2 * 60 * 1000);
    const existingPending = await prisma.transaction.findFirst({
      where: {
        userId: auth.id,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.PENDING,
        amount: amountBig,
        createdAt: { gte: duplicateWindowStart },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        receiptNumber: true,
        status: true,
        createdAt: true,
      },
    });
    if (existingPending) {
      return NextResponse.json(
        {
          ok: false,
          error: 'DUPLICATE_DEPOSIT_REQUEST',
          data: serializeTransaction(existingPending),
        },
        { status: 409 },
      );
    }

    const tx = await prisma.transaction.create({
      data: {
        type: TransactionType.DEPOSIT,
        amount: amountBig,
        receiptNumber,
        description: payload.notes?.trim() || undefined,
        status: TransactionStatus.PENDING,
        accountId: account.id,
        userId: auth.id,
      },
      include: {
        user: {
          select: { nameEn: true, memberId: true },
        },
      },
    });

    // Create notification for admins about the new deposit request
    await prisma.notification.create({
      data: {
        type: 'SYSTEM_ALERT',
        title: 'New Deposit Request',
        message: `${tx.user.nameEn} (${tx.user.memberId}) has requested a deposit of ৳${Number(amountBig).toLocaleString()}`,
        targetRole: UserRole.ADMIN,
        data: {
          transactionId: tx.id,
          userId: auth.id,
          amount: Number(amountBig),
          receiptNumber,
          type: 'DEPOSIT',
        },
      },
    });

    return NextResponse.json({ ok: true, data: serializeTransaction(tx) }, { status: 201 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Validation failed', details: err.flatten() }, { status: 400 });
    }
    if (err?.message?.toLowerCase()?.includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Deposit request failed:', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
