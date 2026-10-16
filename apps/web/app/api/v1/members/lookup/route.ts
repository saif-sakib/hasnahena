import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authErrorStatus } from '@/lib/auth';
import { requireActiveAuth } from '@/lib/auth-revocation';
import { consumeRateLimit, callerAddress } from '@/lib/rate-limit';
import { UserRole } from '@prisma/client';
import { isStandardAccountNo } from '@/lib/account-no';

/**
 * Resolve a full account number to a name, so a loan applicant can nominate a
 * guarantor (FR-11). Narrow on purpose (an id-to-name resolver is an oracle):
 * authenticated, exact match only, name and eligibility only, 10 per 10 min.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireActiveAuth(req);
    if (auth.role !== UserRole.MEMBER) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const accountNo = new URL(req.url).searchParams.get('accountNo')?.trim().toUpperCase() ?? '';
    if (!isStandardAccountNo(accountNo)) {
      return NextResponse.json({ ok: false, error: 'INVALID_MEMBER_ID' }, { status: 400 });
    }

    // Keyed on the caller's id plus address.
    const limit = await consumeRateLimit(
      'member-lookup',
      `${auth.id}:${callerAddress(req)}`,
      { limit: 10, windowSeconds: 600 },
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const member = await prisma.user.findFirst({
      where: { accountNo, role: UserRole.MEMBER, status: 'ACTIVE' },
      select: { id: true, accountNo: true, nameEn: true, nameBn: true },
    });

    // One answer for missing, non-member and inactive.
    if (!member || member.id === auth.id) {
      return NextResponse.json({ ok: false, error: 'MEMBER_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: member.id,
        accountNo: member.accountNo,
        nameEn: member.nameEn,
        nameBn: member.nameBn,
      },
    });
  } catch (err) {
    const msg = typeof (err as Error)?.message === 'string' ? (err as Error).message : 'Server error';
    const authStatus = authErrorStatus(err);
    if (authStatus) {
      return NextResponse.json(
        { ok: false, error: authStatus === 401 ? 'Unauthorized' : 'Server error' },
        { status: authStatus },
      );
    }
    console.error('[Members/Lookup] Error:', msg);
    return NextResponse.json({ ok: false, error: 'Lookup failed' }, { status: 500 });
  }
}
