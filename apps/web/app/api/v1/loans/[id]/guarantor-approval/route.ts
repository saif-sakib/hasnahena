import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { LoanStatus, UserRole } from '@prisma/client';

const bodySchema = z.object({
  accepted: z.boolean(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = requireAuth(req);
    const payload = bodySchema.parse(await req.json());

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(params.id)) {
      return NextResponse.json({ ok: false, error: 'Invalid loan ID format' }, { status: 400 });
    }

    const member = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, role: true },
    });
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (member.role !== UserRole.MEMBER) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const loan = await prisma.loan.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, guarantorId: true },
    });
    if (!loan) return NextResponse.json({ ok: false, error: 'Loan not found' }, { status: 404 });
    if (loan.guarantorId !== auth.id) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    if (loan.status !== LoanStatus.PENDING_GUARANTOR) return NextResponse.json({ ok: false, error: 'Invalid state' }, { status: 409 });

    const updated = await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status: payload.accepted ? LoanStatus.PENDING_APPROVAL : LoanStatus.REJECTED,
      },
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

