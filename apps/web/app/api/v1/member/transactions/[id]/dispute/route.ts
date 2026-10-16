import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authErrorStatus } from '@/lib/auth';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';
import { createAuditLog } from '@/lib/audit';
import { serializeTransaction } from '@/lib/api-utils';
import { TransactionStatus, UserRole } from '@prisma/client';

const bodySchema = z.object({
  reason: z.string().min(3),
  // Positive: the sign is the transaction type.
  correctAmount: z.number().positive().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = await requireActiveAuth(req);

    // Authorization before validation (TEST-16).
    const member = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true },
    });
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (member.role !== UserRole.MEMBER) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const payload = bodySchema.parse(await readJsonBody(req));

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

    // A dispute is the first step of a correction; audit who objected and why.
    await createAuditLog({
      action: 'TRANSACTION_DISPUTED',
      entityType: 'TRANSACTION',
      entityId: tx.id,
      userId: auth.id,
      request: req,
      details: payload.correctAmount != null
        ? `Disputed: ${payload.reason.trim()} (member states the correct amount is ${payload.correctAmount})`
        : `Disputed: ${payload.reason.trim()}`,
    });

    // Serialised — raw BigInt columns would throw after the dispute was recorded (WO-57).
    return NextResponse.json({ ok: true, data: serializeTransaction(updated) }, { status: 200 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Validation failed', details: err.flatten() }, { status: 400 });
    }
    // Covers a malformed body and Prisma's "record not found" alongside auth,
    // all of which used to reach the 500 below (TEST-18).
    const status = routeErrorStatus(err);
    if (status) {
      return NextResponse.json({ ok: false, error: routeErrorMessage(err, 'Failed to record the dispute') }, { status });
    }
    // Never the raw message: it carries table and column names.
    console.error('[dispute] Error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to record the dispute' }, { status: 500 });
  }
}

