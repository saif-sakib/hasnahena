import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { TransactionStatus, UserRole } from '@prisma/client';

const bodySchema = z.object({
  reason: z.string().min(3),
  correctAmount: z.number().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = requireAuth(req);
    const payload = bodySchema.parse(await req.json());

    const member = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true },
    });
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (member.role !== UserRole.MEMBER) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const tx = await prisma.transaction.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!tx) return NextResponse.json({ ok: false, error: 'Transaction not found' }, { status: 404 });
    if (tx.userId !== auth.id) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    if (tx.status === TransactionStatus.DISPUTED) {
      return NextResponse.json({ ok: false, error: 'DISPUTE_ALREADY_RAISED' }, { status: 409 });
    }

    const correctAmountBig =
      typeof payload.correctAmount === 'number' ? BigInt(Math.floor(payload.correctAmount)) : null;

    const updated = await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: TransactionStatus.DISPUTED,
        disputeReason: payload.reason.trim(),
        disputeCorrectAmount: correctAmountBig ?? null,
      },
    });

    // A dispute is the first step of a correction, and a correction has to be
    // traceable end to end. Without this the trail jumps from the wrong posting
    // straight to the reversal, with nothing recording who objected or why.
    await createAuditLog({
      action: 'TRANSACTION_DISPUTED',
      entityType: 'TRANSACTION',
      entityId: tx.id,
      userId: auth.id,
      details: payload.correctAmount != null
        ? `Disputed: ${payload.reason.trim()} (member states the correct amount is ${payload.correctAmount})`
        : `Disputed: ${payload.reason.trim()}`,
    });

    return NextResponse.json({ ok: true, data: updated }, { status: 200 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Validation failed', details: err.flatten() }, { status: 400 });
    }
    const msg = typeof err?.message === 'string' ? err.message : 'Server error';
    if (msg.toLowerCase().includes('authorization')) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

