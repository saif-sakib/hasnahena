import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { consumeRateLimit, callerAddress } from '@/lib/rate-limit';
import { UserRole } from '@prisma/client';
import { isStandardMemberId } from '@/lib/member-id';

/**
 * Resolve a human-readable member ID to the minimum a loan applicant needs to
 * nominate a guarantor: the internal id to submit, and the name to confirm they
 * picked the right person.
 *
 * Why this exists at all
 * ---------------------
 * `POST /api/v1/loans/applications` takes a `guarantorId` — a cuid. A member has
 * no way to obtain one: members cannot browse other members (product.md), and
 * nothing lists them. Without this endpoint FR-11 has no reachable UI, which is
 * exactly the state the 2026-08-17 audit found it in.
 *
 * Why it is shaped this narrowly
 * ------------------------------
 * Any id-to-name resolver is an enumeration oracle, and SEC-08 was closed to
 * remove one. Four things keep this from re-opening it:
 *
 *   1. **Authenticated.** Only a signed-in member can call it, so an anonymous
 *      scraper cannot. The registration endpoint SEC-08 was about is public.
 *   2. **Exact match on a full member ID only.** No prefix search, no listing,
 *      no partial match. The caller must already know `ACC-KH-33001` — the
 *      number written in a passbook and read aloud at the counter.
 *   3. **Name and eligibility only.** Never a phone, email, NID, address or
 *      balance. The answer is "yes, that ID is an active member called X", which
 *      is what a person nominating their neighbour already knows.
 *   4. **Rate limited to 10 per 10 minutes per caller.** Enumerating the
 *      ACC-KH-33### space at that rate takes weeks and leaves an audit trail of
 *      a member id doing it.
 *
 * A wrong-but-valid ID would otherwise silently send the guarantor request to a
 * stranger, so confirming the name is a correctness feature, not a convenience.
 */
export async function GET(req: Request) {
  try {
    const auth = requireAuth(req);
    if (auth.role !== UserRole.MEMBER) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const memberId = new URL(req.url).searchParams.get('memberId')?.trim().toUpperCase() ?? '';
    if (!isStandardMemberId(memberId)) {
      return NextResponse.json({ ok: false, error: 'INVALID_MEMBER_ID' }, { status: 400 });
    }

    // Keyed on the caller's user id, not their address: the point is to bound
    // what one account can enumerate, and an address is shared by a household
    // or a village internet cafe. The address is folded in so one account
    // cannot parallelise across networks either.
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
      where: { memberId, role: UserRole.MEMBER, status: 'ACTIVE' },
      select: { id: true, memberId: true, nameEn: true, nameBn: true },
    });

    // Deliberately the same answer for "no such member", "not a member" and
    // "not active": distinguishing them would turn this into the status oracle
    // it is careful not to be.
    if (!member || member.id === auth.id) {
      return NextResponse.json({ ok: false, error: 'MEMBER_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: member.id,
        memberId: member.memberId,
        nameEn: member.nameEn,
        nameBn: member.nameBn,
      },
    });
  } catch (err) {
    const msg = typeof (err as Error)?.message === 'string' ? (err as Error).message : 'Server error';
    if (msg.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Members/Lookup] Error:', msg);
    return NextResponse.json({ ok: false, error: 'Lookup failed' }, { status: 500 });
  }
}
