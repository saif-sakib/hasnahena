import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserRole, UserStatus } from '@prisma/client';
import {
  bdPhoneRegex,
  registerApiSchema,
  REGISTRATION_UPLOAD_LIMITS,
} from '@/lib/validation/registration';
import { uploadImage, deleteImage } from '@/lib/cloudinary';
import { validateImageFile, UPLOAD_TYPES } from '@/lib/image-utils';
import {
  formatMemberId,
  MEMBER_ID_ADVISORY_LOCK_SQL,
  NEXT_MEMBER_ID_SQL,
} from '@/lib/member-id';
import { consumeRateLimit, callerAddress } from '@/lib/rate-limit';

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

const REQUIRED_DOCUMENT_FIELDS = [
  {
    formKey: 'nidFrontImage',
    documentType: 'nid_front',
    folderSlug: 'nid-front',
    label: 'NID front image',
  },
  {
    formKey: 'nidBackImage',
    documentType: 'nid_back',
    folderSlug: 'nid-back',
    label: 'NID back image',
  },
  {
    formKey: 'memberPhotoImage',
    documentType: 'member_photo',
    folderSlug: 'member-photo',
    label: 'Member photo',
  },
  {
    formKey: 'signatureImage',
    documentType: 'member_signature',
    folderSlug: 'signature',
    label: 'Member signature',
  },
] as const;

const REJECTED_REGISTRATION_PASSWORD_HASH = '__PENDING_APPROVAL_NO_LOGIN__';
const rejectedRegistrationFilter: Prisma.UserWhereInput = {
  role: UserRole.MEMBER,
  status: UserStatus.INACTIVE,
  approvedAt: null,
  passwordHash: REJECTED_REGISTRATION_PASSWORD_HASH,
};

function isFileEntry(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === 'string') return false;
  return (
    typeof (value as File).arrayBuffer === 'function'
    && typeof (value as File).size === 'number'
    && typeof (value as File).name === 'string'
    && typeof (value as File).type === 'string'
  );
}

// SEC-08. This endpoint answers "is this address a member?" to anyone who asks.
// It exists for the signup form's live validation and cannot simply be closed —
// but unthrottled it is a bulk membership-disclosure oracle, and for a
// religious-finance cooperative in one town, *membership itself* is the
// sensitive fact. A list of who banks here is worth more to the wrong person
// than any single balance.
//
// 20 checks per 10 minutes per address is generous for someone filling in a form
// once (two fields, plus retries and typos) and useless for walking a phone-number
// range: Bangladeshi mobile numbers are an 8-digit space behind a known prefix,
// which at this rate takes centuries instead of an afternoon.
const AVAILABILITY_RATE_LIMIT = { limit: 20, windowSeconds: 600 };

export async function GET(req: Request) {
  try {
    const limit = await consumeRateLimit(
      'registration-availability',
      callerAddress(req),
      AVAILABILITY_RATE_LIMIT,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Too many availability checks. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

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
        NOT: rejectedRegistrationFilter,
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
  const uploadedPublicIds: string[] = [];
  const cleanupUploadedAssets = async () => {
    if (uploadedPublicIds.length === 0) return;
    await Promise.all(
      uploadedPublicIds.map((publicId) =>
        deleteImage(publicId).catch((deleteErr) => {
          console.error('Failed to cleanup uploaded registration document:', deleteErr);
        })
      ),
    );
  };

  try {
    const contentType = req.headers.get('content-type')?.toLowerCase() || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { ok: false, error: 'Registration documents are required. Submit as multipart/form-data.' },
        { status: 400 },
      );
    }

    const formData = await req.formData();
    const payloadRaw = formData.get('payload');
    if (typeof payloadRaw !== 'string' || payloadRaw.trim() === '') {
      return NextResponse.json(
        { ok: false, error: 'Missing registration payload' },
        { status: 400 },
      );
    }

    let payloadInput: unknown;
    try {
      payloadInput = JSON.parse(payloadRaw);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid registration payload format' },
        { status: 400 },
      );
    }

    const parsed = registerApiSchema.safeParse(payloadInput);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    const normalizedEmail = payload.email.trim().toLowerCase();

    await prisma.$executeRaw`
      UPDATE users
      SET
        email = CASE
          WHEN email IS NULL OR btrim(email) = '' THEN NULL
          ELSE CONCAT('rejected+', id, '@hasnahena.local')
        END,
        phone = CONCAT('rejected-', id),
        "updatedAt" = NOW()
      WHERE role = 'MEMBER'
        AND status = 'INACTIVE'
        AND "approvedAt" IS NULL
        AND "passwordHash" = ${REJECTED_REGISTRATION_PASSWORD_HASH}
        AND (email = ${normalizedEmail} OR phone = ${payload.phone})
    `;

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: payload.phone },
          { email: normalizedEmail },
        ],
        NOT: rejectedRegistrationFilter,
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

    const validatedFiles: Array<{
      requirement: typeof REQUIRED_DOCUMENT_FIELDS[number];
      fileEntry: File;
      buffer: Buffer;
    }> = [];
    let totalUploadBytes = 0;

    for (const requirement of REQUIRED_DOCUMENT_FIELDS) {
      const fileEntry = formData.get(requirement.formKey);
      if (!isFileEntry(fileEntry) || fileEntry.size <= 0) {
        return NextResponse.json(
          { ok: false, error: `${requirement.label} is required` },
          { status: 400 },
        );
      }

      const validation = validateImageFile(fileEntry, {
        acceptedTypes: UPLOAD_TYPES.avatar,
        maxSizeMB: REGISTRATION_UPLOAD_LIMITS.PER_FILE_MB,
      });
      if (!validation.valid) {
        return NextResponse.json(
          { ok: false, error: `${requirement.label}: ${validation.error}` },
          { status: 400 },
        );
      }

      // Checked against the running total *before* reading the body into
      // memory. Buffering all four first and rejecting afterwards meant an
      // oversized submission was fully resident before we declined it.
      totalUploadBytes += fileEntry.size;
      if (totalUploadBytes > REGISTRATION_UPLOAD_LIMITS.TOTAL_BYTES) {
        return NextResponse.json(
          {
            ok: false,
            error: `Combined document size exceeds the ${REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL} limit`,
          },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(await fileEntry.arrayBuffer());
      validatedFiles.push({ requirement, fileEntry, buffer });
    }

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

    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(MEMBER_ID_ADVISORY_LOCK_SQL);
      const [{ next_seq: nextSeq }] = await tx.$queryRawUnsafe<Array<{ next_seq: bigint }>>(NEXT_MEMBER_ID_SQL);
      const memberId = formatMemberId(Number(nextSeq));

      return tx.user.create({
        data: {
          email: normalizedEmail,
          phone: payload.phone,
          passwordHash: REJECTED_REGISTRATION_PASSWORD_HASH,
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

          account: {
            create: {
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
    });

    // Everything past this point runs against a user row that already exists,
    // so every failure here has to undo it. Leaving the row behind is worse
    // than failing: the member's email and phone are then taken, and their
    // second attempt is refused with "already exists" — a dead end only an
    // admin can clear, caused by an image host being briefly unavailable.
    try {
      const uploadResults = await Promise.all(
        validatedFiles.map(async ({ requirement, fileEntry, buffer }) => {
          const uploadResult = await uploadImage(
            buffer,
            `registrations/members/${created.memberId}/${requirement.folderSlug}`,
            {
              preserveOriginal: true,
              useFilename: true,
              uniqueFilename: true,
            },
          );

          // Recorded the moment it lands, not after all four settle: if a
          // later upload throws, the ones that already succeeded still need
          // deleting, and a list assembled afterwards never gets built.
          uploadedPublicIds.push(uploadResult.publicId);

          return {
            userId: created.id,
            type: requirement.documentType,
            url: uploadResult.url,
            fileName: fileEntry.name,
            mimeType: fileEntry.type,
            size: fileEntry.size,
          };
        }),
      );

      await prisma.document.createMany({ data: uploadResults });
    } catch (uploadError) {
      await cleanupUploadedAssets();
      await prisma.user.delete({ where: { id: created.id } }).catch((deleteErr) => {
        console.error('Failed to roll back registration after document failure:', deleteErr);
      });
      console.error('Registration document upload failed:', uploadError);
      return NextResponse.json(
        {
          ok: false,
          error: 'Could not store your documents. Please try again in a moment.',
        },
        { status: 503 },
      );
    }

    // Awaited, not fire-and-forget. On Vercel the function can be frozen the
    // moment the response is returned, and a promise that has not settled is
    // simply not finished — so the admin was never told a registration was
    // waiting, while the member sat waiting for an approval nobody knew to
    // give (WO-59).
    //
    // Caught and logged rather than thrown: the member's account exists by
    // now, and must not be rolled back because a notification failed. The
    // point is to know it failed, not to fail because of it.
    await prisma.notification.create({
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
    await cleanupUploadedAssets();

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
