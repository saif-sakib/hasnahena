import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserRole, UserStatus } from '@prisma/client';
import { bdPhoneRegex, registerApiSchema } from '@/lib/validation/registration';

function normalizeOptionalString(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function parseOptionalDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email')?.trim().toLowerCase() || '';
    const phone = searchParams.get('phone')?.trim() || '';

    if (!email && !phone) {
      return NextResponse.json(
        { ok: false, error: 'email or phone query parameter is required' },
        { status: 400 },
      );
    }

    if (email && !z.string().email().safeParse(email).success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid email format' },
        { status: 400 },
      );
    }

    if (phone && !bdPhoneRegex.test(phone)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid phone format' },
        { status: 400 },
      );
    }

    const clauses = [] as Array<{ phone?: string; email?: string }>;
    if (email) {
      clauses.push({ email });
    }
    if (phone) {
      clauses.push({ phone });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: clauses,
      },
      select: {
        email: true,
        phone: true,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        emailExists: Boolean(email) && existingUser?.email === email,
        phoneExists: Boolean(phone) && existingUser?.phone === phone,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Registration availability check failed:', err);
    return NextResponse.json(
      { ok: false, error: 'Availability check failed' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = registerApiSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    const normalizedEmail = payload.email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: payload.phone },
          { email: normalizedEmail },
        ],
      },
      select: { phone: true, email: true },
    });

    if (existingUser) {
      const field = existingUser.phone === payload.phone ? 'phone number' : 'email';
      return NextResponse.json(
        { ok: false, error: `A user with this ${field} already exists` },
        { status: 409 },
      );
    }

    // Generate unique IDs
    const timestamp = Date.now();
    const phoneDigits = payload.phone.replace(/\D/g, '');
    const memberId = `MBR-${phoneDigits}-${timestamp.toString(36)}`;
    const accountNumber = `ACC-${phoneDigits}-${timestamp.toString(36)}`;

    const sameAsPermanent = payload.sameAsPermanent ?? true;
    const presentFallback = sameAsPermanent;

    const permanentAddress = {
      houseNo: payload.permanentHouseNo,
      roadNo: payload.permanentRoadNo?.trim() ? payload.permanentRoadNo : undefined,
      village: payload.permanentVillage,
      union: payload.permanentUnion,
      policeStation: payload.permanentPoliceStation,
      district: payload.permanentDistrict,
    };

    const presentAddress = {
      houseNo: presentFallback ? permanentAddress.houseNo : payload.presentHouseNo!,
      roadNo: presentFallback ? permanentAddress.roadNo : payload.presentRoadNo?.trim() ? payload.presentRoadNo : undefined,
      village: presentFallback ? permanentAddress.village : payload.presentVillage!,
      union: presentFallback ? permanentAddress.union : payload.presentUnion!,
      policeStation: presentFallback ? permanentAddress.policeStation : payload.presentPoliceStation!,
      district: presentFallback ? permanentAddress.district : payload.presentDistrict!,
    };

    const provisionalPasswordHash = '__PENDING_APPROVAL_NO_LOGIN__';

    const created = await prisma.user.create({
      data: {
        email: normalizedEmail,
        phone: payload.phone,
        passwordHash: provisionalPasswordHash,
        role: UserRole.MEMBER,
        status: UserStatus.PENDING,

        memberId,
        formNumber: `FORM-${memberId}`,

        nameEn: payload.nameEn,
        nameBn: normalizeOptionalString(payload.nameBn),
        fatherName: payload.fatherName,
        motherName: payload.motherName,

        gender: payload.gender,
        bloodGroup: payload.bloodGroup,
        profession: payload.profession,
        dateOfBirth: parseOptionalDate(payload.dateOfBirth),
        maritalStatus: payload.maritalStatus,
        childrenCount: payload.childrenCount ?? 0,

        nidNumber: normalizeOptionalString(payload.nidNumber) ?? payload.nidNumber,

        permanentAddress: {
          create: {
            houseNo: permanentAddress.houseNo,
            roadNo: permanentAddress.roadNo,
            village: permanentAddress.village,
            union: permanentAddress.union,
            policeStation: permanentAddress.policeStation,
            district: permanentAddress.district,
          },
        },

        presentAddress: {
          create: {
            houseNo: presentAddress.houseNo,
            roadNo: presentAddress.roadNo,
            village: presentAddress.village,
            union: presentAddress.union,
            policeStation: presentAddress.policeStation,
            district: presentAddress.district,
          },
        },

        nominee: {
          create: {
            name: payload.nomineeName,
            relationship: payload.nomineeRelationship,
            nidNumber: payload.nomineeNid,
            phone: normalizeOptionalString(payload.nomineePhone) ?? undefined,
          },
        },

        accounts: {
          create: {
            accountNumber,
            isLoanEligible: false,
            maxLoanAmount: BigInt(0),
            savingsBalance: BigInt(0),
            loanBalance: BigInt(0),
          },
        },
      },
      select: {
        id: true,
        memberId: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        nameEn: true,
      },
    });

    // Create notification for admins (non-blocking)
    prisma.notification.create({
      data: {
        type: 'NEW_REGISTRATION',
        title: 'New Member Registration',
        message: `${created.nameEn} (${created.phone}) has submitted a registration request and is awaiting approval.`,
        targetRole: UserRole.ADMIN,
        data: {
          userId: created.id,
          memberId: created.memberId,
          name: created.nameEn,
          phone: created.phone,
        },
      },
    }).catch((notifErr) => {
      console.error('Failed to create notification:', notifErr);
    });

    return NextResponse.json({ ok: true, user: created }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'Invalid request', details: err.flatten() },
        { status: 400 },
      );
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error('Prisma error:', err.code, err.message);

      if (err.code === 'P2002') {
        const target = (err.meta?.target as string[])?.join(', ') || 'field';
        return NextResponse.json(
          { ok: false, error: `A user with this ${target} already exists` },
          { status: 409 },
        );
      }

      if (err.code === 'P2003') {
        return NextResponse.json(
          { ok: false, error: 'Database constraint violation' },
          { status: 400 },
        );
      }
    }

    console.error('Registration failed:', err);
    return NextResponse.json(
      { ok: false, error: 'Registration failed. Please try again.' },
      { status: 500 },
    );
  }
}
