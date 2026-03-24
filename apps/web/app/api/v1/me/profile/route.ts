import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const auth = requireAuth(req);
    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: {
        id: true,
        memberId: true,
        formNumber: true,
        nameEn: true,
        nameBn: true,
        fatherName: true,
        motherName: true,
        phone: true,
        email: true,
        nidNumber: true,
        dateOfBirth: true,
        maritalStatus: true,
        gender: true,
        status: true,
        createdAt: true,
        avatarUrl: true,
        permanentAddress: {
          select: { houseNo: true, village: true, union: true, policeStation: true, district: true },
        },
        presentAddress: {
          select: { houseNo: true, village: true, union: true, policeStation: true, district: true },
        },
        nominee: {
          select: { name: true, relationship: true, nidNumber: true, phone: true },
        },
        accounts: {
          take: 1,
          select: { accountNumber: true, savingsBalance: true },
        },
      },
    });

    if (!user) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    if (!user.accounts.length) {
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }

    // This UI expects "accountNumber" as a stable identifier.
    const account = user.accounts[0];

    return NextResponse.json({
      ok: true,
      data: {
        profile: {
          memberId: user.memberId ?? '',
          accountNumber: account.accountNumber,
          nameEn: user.nameEn,
          nameBn: user.nameBn ?? '',
          fatherName: user.fatherName,
          motherName: user.motherName,
          phone: user.phone,
          email: user.email ?? undefined,
          nidNumber: user.nidNumber ?? '',
          dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : '',
          maritalStatus: user.maritalStatus,
          gender: user.gender,
          permanentAddress: user.permanentAddress ?? null,
          presentAddress: user.presentAddress ?? null,
          memberSince: user.createdAt ? user.createdAt.toISOString().slice(0, 10) : '',
          status: user.status,
          avatarUrl: user.avatarUrl || null,
        },
        nominee: user.nominee
          ? {
              name: user.nominee.name,
              relationship: user.nominee.relationship,
              nidNumber: user.nominee.nidNumber,
              phone: user.nominee.phone ?? undefined,
            }
          : null,
      },
    });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Unauthorized';
    if (msg.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: msg }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

