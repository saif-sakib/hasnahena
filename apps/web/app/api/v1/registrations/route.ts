import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserRole, UserStatus } from '@prisma/client';

const registerSchema = z
  .object({
    // Personal Info
    nameEn: z.string().min(3),
    nameBn: z.string().optional(),
    fatherName: z.string().min(3),
    motherName: z.string().min(3),
    phone: z.string().regex(/^01\d{9}$/),
    email: z.string().optional().or(z.literal('')),
    nidNumber: z.string().min(10),
    maritalStatus: z.enum(['UNMARRIED', 'MARRIED']),
    childrenCount: z.number().min(0).optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
    dateOfBirth: z.string().optional(),
    password: z.string().min(6),

    // Permanent Address
    permanentHouseNo: z.string().min(1),
    permanentRoadNo: z.string().optional(),
    permanentVillage: z.string().min(1),
    permanentUnion: z.string().min(1),
    permanentPoliceStation: z.string().min(1),
    permanentDistrict: z.string().min(1),

    // Present Address
    sameAsPermanent: z.boolean().optional(),
    presentHouseNo: z.string().optional(),
    presentRoadNo: z.string().optional(),
    presentVillage: z.string().optional(),
    presentUnion: z.string().optional(),
    presentPoliceStation: z.string().optional(),
    presentDistrict: z.string().optional(),

    // Nominee
    nomineeName: z.string().min(3),
    nomineeRelationship: z.string().min(1),
    nomineeNid: z.string().min(10),
    nomineePhone: z.string().optional(),
  })
  .strict();

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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const payload = registerSchema.parse(body);

    const phoneDigits = payload.phone.replace(/\D/g, '');
    const memberId = `MBR-${phoneDigits}`;
    const accountNumber = `ACC-${phoneDigits}`;

    const sameAsPermanent = payload.sameAsPermanent ?? false;
    const hasAllPresentFields =
      !!payload.presentHouseNo &&
      !!payload.presentVillage &&
      !!payload.presentUnion &&
      !!payload.presentPoliceStation &&
      !!payload.presentDistrict;

    const presentFallback = sameAsPermanent || !hasAllPresentFields;

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

    const passwordHash = await bcrypt.hash(payload.password, 10);

    const created = await prisma.user.create({
      data: {
        email: normalizeOptionalString(payload.email),
        phone: payload.phone,
        passwordHash,
        role: UserRole.MEMBER,
        status: UserStatus.PENDING,

        memberId,
        formNumber: `FORM-${memberId}`,

        nameEn: payload.nameEn,
        nameBn: normalizeOptionalString(payload.nameBn),
        fatherName: payload.fatherName,
        motherName: payload.motherName,

        gender: payload.gender,
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
      },
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
      // Common case: duplicate email/phone.
      if (err.code === 'P2002') {
        return NextResponse.json(
          { ok: false, error: 'User already exists (email/phone taken)' },
          { status: 409 },
        );
      }
    }

    console.error('Registration failed:', err);
    return NextResponse.json(
      { ok: false, error: 'Registration failed' },
      { status: 500 },
    );
  }
}

