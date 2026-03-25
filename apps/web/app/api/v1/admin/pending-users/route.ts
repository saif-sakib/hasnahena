import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const isDev = process.env.NODE_ENV === 'development';

// GET - Fetch all pending registration requests
export async function GET(req: NextRequest) {
  try {
    const authUser = requireAuth(req);

    // Check if user is admin
    if (authUser.role !== 'ADMIN' && authUser.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized - Admin access required' } },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '50', 10) || 50));
    const skip = (page - 1) * limit;

    // Fetch pending users with pagination to reduce payload size/latency.
    const [pendingUsers, total] = await Promise.all([
      prisma.user.findMany({
        where: {
          status: 'PENDING',
        },
        include: {
          permanentAddress: true,
          presentAddress: true,
          nominee: true,
          accounts: {
            select: {
              accountNumber: true,
              savingsBalance: true,
            },
            take: 1,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.user.count({
        where: {
          status: 'PENDING',
        },
      }),
    ]);

    // Transform for response
    const transformed = pendingUsers.map((user) => ({
      id: user.id,
      memberId: user.memberId,
      name: user.nameEn,
      nameBn: user.nameBn,
      email: user.email,
      phone: user.phone,
      nidNumber: user.nidNumber,
      fatherName: user.fatherName,
      motherName: user.motherName,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth?.toISOString(),
      maritalStatus: user.maritalStatus,
      childrenCount: user.childrenCount,
      requestDate: user.createdAt.toISOString(),
      permanentAddress: user.permanentAddress
        ? {
            houseNo: user.permanentAddress.houseNo,
            roadNo: user.permanentAddress.roadNo,
            village: user.permanentAddress.village,
            union: user.permanentAddress.union,
            policeStation: user.permanentAddress.policeStation,
            district: user.permanentAddress.district,
          }
        : null,
      presentAddress: user.presentAddress
        ? {
            houseNo: user.presentAddress.houseNo,
            roadNo: user.presentAddress.roadNo,
            village: user.presentAddress.village,
            union: user.presentAddress.union,
            policeStation: user.presentAddress.policeStation,
            district: user.presentAddress.district,
          }
        : null,
      nominee: user.nominee
        ? {
            name: user.nominee.name,
            relationship: user.nominee.relationship,
            nidNumber: user.nominee.nidNumber,
            phone: user.nominee.phone,
          }
        : null,
      accountNumber: user.accounts[0]?.accountNumber || null,
    }));

    return NextResponse.json({
      success: true,
      data: transformed,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch pending users';
    console.error('[Admin/PendingUsers] Error:', message);
    if (message.includes('Authorization') || message.includes('token')) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { success: false, error: { message: 'Failed to fetch pending users', ...(isDev && { details: message }) } },
      { status: 500 }
    );
  }
}
