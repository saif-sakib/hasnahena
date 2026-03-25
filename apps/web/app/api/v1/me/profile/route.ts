import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { z } from 'zod';

const isDev = process.env.NODE_ENV === 'development';

// Validation schema for profile updates
const updateProfileSchema = z.object({
  nameEn: z.string().min(1).optional(),
  nameBn: z.string().optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(11).max(14).optional(),
  address: z.string().optional(),
});

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
        role: true,
        createdAt: true,
        updatedAt: true,
        avatarUrl: true,
        permanentAddress: {
          select: { id: true, houseNo: true, village: true, union: true, policeStation: true, district: true },
        },
        presentAddress: {
          select: { id: true, houseNo: true, village: true, union: true, policeStation: true, district: true },
        },
        nominee: {
          select: { id: true, name: true, relationship: true, nidNumber: true, phone: true },
        },
        accounts: {
          take: 1,
          select: { accountNumber: true, savingsBalance: true },
        },
      },
    });

    if (!user) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });

    // For admins/workers who may not have accounts, handle gracefully
    const account = user.accounts[0] ?? null;

    // Format address for display
    const formatAddress = (addr: { houseNo: string; village: string; union: string; policeStation: string; district: string } | null) => {
      if (!addr) return '';
      return [addr.houseNo, addr.village, addr.union, addr.policeStation, addr.district]
        .filter(Boolean)
        .join(', ');
    };

    return NextResponse.json({
      ok: true,
      data: {
        profile: {
          id: user.id,
          memberId: user.memberId ?? '',
          accountNumber: account?.accountNumber ?? '',
          nameEn: user.nameEn,
          nameBn: user.nameBn ?? '',
          fatherName: user.fatherName,
          motherName: user.motherName,
          phone: user.phone,
          email: user.email ?? '',
          nidNumber: user.nidNumber ?? '',
          dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : '',
          maritalStatus: user.maritalStatus,
          gender: user.gender,
          role: user.role,
          permanentAddress: user.permanentAddress ?? null,
          presentAddress: user.presentAddress ?? null,
          address: formatAddress(user.permanentAddress),
          memberSince: user.createdAt ? user.createdAt.toISOString().slice(0, 10) : '',
          lastUpdated: user.updatedAt ? user.updatedAt.toISOString() : '',
          status: user.status,
          avatarUrl: user.avatarUrl || null,
          savingsBalance: account?.savingsBalance ? Number(account.savingsBalance) : 0,
        },
        nominee: user.nominee
          ? {
              id: user.nominee.id,
              name: user.nominee.name,
              relationship: user.nominee.relationship,
              nidNumber: user.nominee.nidNumber,
              phone: user.nominee.phone ?? '',
            }
          : null,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    console.error('[Me/Profile GET] Error:', msg);
    if (msg.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to fetch profile', ...(isDev && { details: msg }) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = requireAuth(req);
    const body = await req.json();

    // Validate input
    const validation = updateProfileSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({
        ok: false,
        error: 'Invalid input',
        details: validation.error.flatten()
      }, { status: 400 });
    }

    const { nameEn, nameBn, email, phone } = validation.data;

    // Check if phone/email already exists for another user
    if (phone || email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          AND: [
            { id: { not: auth.id } },
            {
              OR: [
                ...(phone ? [{ phone }] : []),
                ...(email ? [{ email }] : []),
              ],
            },
          ],
        },
      });

      if (existingUser) {
        return NextResponse.json({
          ok: false,
          error: 'Phone or email already in use'
        }, { status: 409 });
      }
    }

    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: auth.id },
      data: {
        ...(nameEn && { nameEn }),
        ...(nameBn !== undefined && { nameBn }),
        ...(email !== undefined && { email }),
        ...(phone && { phone }),
      },
      select: {
        id: true,
        nameEn: true,
        nameBn: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        avatarUrl: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'Profile updated successfully',
      data: {
        profile: {
          id: updatedUser.id,
          nameEn: updatedUser.nameEn,
          nameBn: updatedUser.nameBn ?? '',
          email: updatedUser.email ?? '',
          phone: updatedUser.phone,
          role: updatedUser.role,
          status: updatedUser.status,
          avatarUrl: updatedUser.avatarUrl || null,
          lastUpdated: updatedUser.updatedAt.toISOString(),
        },
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    console.error('[Me/Profile PUT] Error:', msg);
    if (msg.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to update profile', ...(isDev && { details: msg }) }, { status: 500 });
  }
}

