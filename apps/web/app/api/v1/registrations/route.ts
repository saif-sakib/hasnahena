import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AddressType, UserRole, UserStatus } from '@prisma/client';
import {
  bdPhoneRegex,
  registerApiSchema,
  REGISTRATION_UPLOAD_LIMITS,
} from '@/lib/validation/registration';
import {
  uploadImage,
  deleteImage,
  deleteEmptyFolder,
  applicationFolder,
} from '@/lib/cloudinary';
import { APPLICATION_DOCUMENTS } from '@/lib/application-documents';
import { validateImageFile, UPLOAD_TYPES } from '@/lib/image-utils';
import { nextDocumentNumber, SERIES } from '@/lib/document-numbers';
import { consumeRateLimit, callerAddress } from '@/lib/rate-limit';
import { liveIdentityFilter, PENDING_APPROVAL_PASSWORD_HASH } from '@/lib/rejected-application';
import { getPublicSettings } from '@/lib/system-config';
import {
  dateOfBirthMessage,
  dateOfBirthProblem,
  minimumAgeYears,
} from '@/lib/membership-eligibility';

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

// One list, shared with the approval's document move (lib/application-documents.ts).
const REQUIRED_DOCUMENT_FIELDS = APPLICATION_DOCUMENTS;

function isFileEntry(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === 'string') return false;
  return (
    typeof (value as File).arrayBuffer === 'function'
    && typeof (value as File).size === 'number'
    && typeof (value as File).name === 'string'
    && typeof (value as File).type === 'string'
  );
}

// SEC-08: availability answers "is this a member?" — membership itself is the
// sensitive fact here. 20 per 10 min fits a form and makes enumeration take centuries.
const AVAILABILITY_RATE_LIMIT = { limit: 20, windowSeconds: 600 };

// Submission throttle, per address (the email is caller-chosen): each call
// writes rows and uploads four images.
const SUBMISSION_RATE_LIMIT = { limit: 5, windowSeconds: 900 };

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
        ...liveIdentityFilter,
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
  // The upload folder, so it can be removed on rollback.
  let uploadFolder: string | null = null;
  const cleanupUploadedAssets = async () => {
    if (uploadedPublicIds.length === 0) return;
    await Promise.all(
      uploadedPublicIds.map((publicId) =>
        deleteImage(publicId).catch((deleteErr) => {
          console.error('Failed to cleanup uploaded registration document:', deleteErr);
        })
      ),
    );
    // And the now-empty folder, or failed submissions litter the asset tree.
    if (uploadFolder) await deleteEmptyFolder(uploadFolder);
  };

  try {
    // Before reading the body — formData() buffers four images.
    const submissionLimit = await consumeRateLimit(
      'registration-submit',
      callerAddress(req),
      SUBMISSION_RATE_LIMIT,
    );
    if (!submissionLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Too many registration attempts from this connection. Please try again shortly.',
        },
        { status: 429, headers: { 'Retry-After': String(submissionLimit.retryAfterSeconds) } },
      );
    }

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

    // Outside `payload`, which is strict and holds only the application.
    const localeRaw = formData.get('locale');
    const applicantLocale = localeRaw === 'bn' ? 'bn' : 'en';

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

    // The age floor from settings. This server check is the one that counts.
    const publicSettings = await getPublicSettings();
    const minimumAge = minimumAgeYears(publicSettings);
    const dobProblem = dateOfBirthProblem(payload.dateOfBirth, minimumAge);
    if (dobProblem) {
      return NextResponse.json(
        {
          ok: false,
          error: dateOfBirthMessage(dobProblem, minimumAge, 'en'),
          field: 'dateOfBirth',
          // So the form can render the refusal in the applicant's language.
          code: `DOB_${dobProblem.toUpperCase().replace('-', '_')}`,
          minimumAge,
        },
        { status: 400 },
      );
    }

    // A member cannot be their own nominee.
    if (payload.nomineeNid.trim() === payload.nidNumber.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: 'The nominee cannot be the applicant. Enter the NID of the person who should receive the account if you die.',
          field: 'nomineeNid',
          code: 'NOMINEE_IS_APPLICANT',
        },
        { status: 400 },
      );
    }

    // A LIVE user holding these details is a conflict; a rejected application
    // is not (rejected-application.ts).
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: payload.phone },
          { email: normalizedEmail },
          { nidNumber: payload.nidNumber },
        ],
        ...liveIdentityFilter,
      },
      select: { phone: true, email: true, nidNumber: true },
    });

    if (existingUser) {
      // Name the field that actually collided.
      const field = existingUser.phone === payload.phone
        ? 'phone number'
        : existingUser.email === normalizedEmail
          ? 'email'
          : 'NID number';
      return NextResponse.json(
        { ok: false, error: `A member with this ${field} already exists`, field },
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

      // Checked before buffering the file.
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
      // The APPLICATION number. An account number is issued only at approval,
      // so a refusal burns nothing (ADR-039).
      const formNumber = await nextDocumentNumber(SERIES.application, tx);

      // No branch here — the admin picks it at approval (ADR-042).

      return tx.user.create({
        data: {
          // The id IS the application number until approval moves it (ADR-043).
          id: formNumber,
          email: normalizedEmail,
          phone: payload.phone,
          passwordHash: PENDING_APPROVAL_PASSWORD_HASH,
          preferredLocale: applicantLocale,
          role: UserRole.MEMBER,
          status: UserStatus.PENDING,

          // `accountNo` is deliberately absent: null until approval.
          formNumber,

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

          // One relation, distinguished by `type` (ADR-044).
          addresses: {
            create: [
              {
                type: AddressType.PERMANENT,
                houseNo: permanentAddress.houseNo,
                roadNo: permanentAddress.roadNo,
                village: permanentAddress.village,
                union: permanentAddress.union,
                policeStation: permanentAddress.policeStation,
                district: permanentAddress.district,
              },
              {
                type: AddressType.PRESENT,
                houseNo: presentAddress.houseNo,
                roadNo: presentAddress.roadNo,
                village: presentAddress.village,
                union: presentAddress.union,
                policeStation: presentAddress.policeStation,
                district: presentAddress.district,
              },
            ],
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
              savingsBalance: BigInt(0),
              loanBalance: BigInt(0),
            },
          },
        },
        select: {
          id: true,
          formNumber: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          nameEn: true,
        },
      });
    });

    // From here every failure must undo the user row, or the applicant's
    // email and phone stay taken.
    try {
      const uploadResults = await Promise.all(
        validatedFiles.map(async ({ requirement, fileEntry, buffer }) => {
          // applications/<APP-…>/<slug>: the application's folder, deleted on
          // refusal. preserveOriginal — an NID scan must never be re-encoded.
          uploadFolder = applicationFolder(created.formNumber, created.id);
          const uploadResult = await uploadImage(
            buffer,
            uploadFolder,
            {
              preserveOriginal: true,
              publicId: requirement.slug,
              useFilename: false,
              uniqueFilename: false,
              overwrite: true,
            },
          );

          // Recorded as each lands, so a later failure can delete it.
          uploadedPublicIds.push(uploadResult.publicId);

          return {
            userId: created.id,
            type: requirement.type,
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

    // Awaited (Vercel may freeze the function after responding, WO-59), but
    // caught: a failed notification must not roll back the account.
    await prisma.notification.create({
      data: {
        type: 'NEW_REGISTRATION',
        title: 'New Member Registration',
        message: `${created.nameEn} (${created.phone}) has submitted a registration request and is awaiting approval.`,
        targetRole: UserRole.ADMIN,
        data: {
          userId: created.id,
          formNumber: created.formNumber,
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
