import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserRole, UserStatus } from '@prisma/client';

const bdPhoneRegex = /^01\d{9}$/;
const bdNidRegex = /^(?:\d{10}|\d{13}|\d{17})$/;

const normalizeOptionalNumber = (value: unknown) => {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
};

const registerSchema = z
  .object({
    // Personal Info
    nameEn: z.string().trim().min(3, 'Name must be at least 3 characters').max(80, 'Name must be at most 80 characters'),
    nameBn: z.string().trim().max(80, 'Name must be at most 80 characters').optional().or(z.literal('')),
    fatherName: z.string().trim().min(3, 'Father name is required').max(80, 'Father name must be at most 80 characters'),
    motherName: z.string().trim().min(3, 'Mother name is required').max(80, 'Mother name must be at most 80 characters'),
    phone: z.string().trim().regex(bdPhoneRegex, 'Enter a valid 11-digit Bangladeshi mobile number'),
    email: z.string().trim().email('Enter a valid email address'),
    nidNumber: z.string().trim().regex(bdNidRegex, 'NID must be 10, 13, or 17 digits'),
    maritalStatus: z.enum(['UNMARRIED', 'MARRIED']),
    childrenCount: z.preprocess(
      normalizeOptionalNumber,
      z.number({ invalid_type_error: 'Children count must be a number' })
        .int('Children count must be a whole number')
        .min(0, 'Children count cannot be negative')
        .max(20, 'Children count seems too high')
        .optional(),
    ),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
    profession: z.string().trim().min(2, 'Profession is required').max(80, 'Profession must be at most 80 characters'),
    dateOfBirth: z.string().trim().min(1, 'Date of birth is required'),

    // Permanent Address
    permanentHouseNo: z.string().trim().min(1, 'Permanent house no is required').max(50, 'House no must be at most 50 characters'),
    permanentRoadNo: z.string().trim().max(50, 'Road no must be at most 50 characters').optional(),
    permanentVillage: z.string().trim().min(1, 'Permanent village is required').max(80, 'Village must be at most 80 characters'),
    permanentUnion: z.string().trim().min(1, 'Permanent union is required').max(80, 'Union must be at most 80 characters'),
    permanentPoliceStation: z.string().trim().min(1, 'Permanent police station is required').max(80, 'Police station must be at most 80 characters'),
    permanentDistrict: z.string().trim().min(1, 'Permanent district is required').max(80, 'District must be at most 80 characters'),

    // Present Address
    sameAsPermanent: z.boolean().optional(),
    presentHouseNo: z.string().trim().max(50, 'House no must be at most 50 characters').optional(),
    presentRoadNo: z.string().trim().max(50, 'Road no must be at most 50 characters').optional(),
    presentVillage: z.string().trim().max(80, 'Village must be at most 80 characters').optional(),
    presentUnion: z.string().trim().max(80, 'Union must be at most 80 characters').optional(),
    presentPoliceStation: z.string().trim().max(80, 'Police station must be at most 80 characters').optional(),
    presentDistrict: z.string().trim().max(80, 'District must be at most 80 characters').optional(),

    // Nominee
    nomineeName: z.string().trim().min(3, 'Nominee name is required').max(80, 'Nominee name must be at most 80 characters'),
    nomineeRelationship: z.string().trim().min(2, 'Relationship is required').max(40, 'Relationship must be at most 40 characters'),
    nomineeNid: z.string().trim().regex(bdNidRegex, 'Nominee NID must be 10, 13, or 17 digits'),
    nomineePhone: z
      .string()
      .trim()
      .optional()
      .or(z.literal(''))
      .refine((value) => typeof value !== 'string' || value === '' || bdPhoneRegex.test(value), {
        message: 'Nominee phone must be a valid 11-digit Bangladeshi mobile number',
      }),
  })
  .strict()
  .superRefine((data, ctx) => {
    const dob = data.dateOfBirth.trim();
    const birthDate = new Date(dob);
    if (Number.isNaN(birthDate.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateOfBirth'],
        message: 'Date of birth is invalid',
      });
    } else {
      const today = new Date();
      if (birthDate > today) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dateOfBirth'],
          message: 'Date of birth cannot be in the future',
        });
      } else {
        let age = today.getFullYear() - birthDate.getFullYear();
        const hasHadBirthday =
          today.getMonth() > birthDate.getMonth() ||
          (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
        if (!hasHadBirthday) {
          age -= 1;
        }
        if (age < 18) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['dateOfBirth'],
            message: 'You must be at least 18 years old to register',
          });
        }
      }
    }

    if (data.maritalStatus === 'UNMARRIED' && (data.childrenCount ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['childrenCount'],
        message: 'Children count must be 0 for unmarried applicants',
      });
    }

    if (!data.sameAsPermanent) {
      const requiredPresentFields: Array<{ key: string; message: string }> = [
        { key: 'presentHouseNo', message: 'Present house no is required' },
        { key: 'presentVillage', message: 'Present village is required' },
        { key: 'presentUnion', message: 'Present union is required' },
        { key: 'presentPoliceStation', message: 'Present police station is required' },
        { key: 'presentDistrict', message: 'Present district is required' },
      ];

      for (const field of requiredPresentFields) {
        const value = (data as Record<string, unknown>)[field.key];
        if (typeof value !== 'string' || value.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field.key],
            message: field.message,
          });
        }
      }
    }
  });

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
    const parsed = registerSchema.safeParse(body);

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
