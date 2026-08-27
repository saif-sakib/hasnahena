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
import { uploadImage, deleteImage, applicationFolder } from '@/lib/cloudinary';
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

// The four documents, their form fields and the name each asset is given, are
// declared once in `lib/application-documents.ts` — because the *approval* has
// to re-derive those names when it moves the files into the member's own folder,
// and two lists that must agree and live in different layers do not stay equal.
const REQUIRED_DOCUMENT_FIELDS = APPLICATION_DOCUMENTS;

// The sentinel and the rejected-application predicate live in
// `lib/rejected-application.ts` now, because the database's partial unique
// indexes and the Go API's login lookup have to agree with them. They were
// declared here when this route was their only consumer.

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

// The POST had **no throttle at all** until 2026-08-26, while the GET beside it
// has had one since SEC-08. It is by far the more expensive of the two: each
// call writes a `users` row with three related records, uploads four images to
// Cloudinary, and takes a *global* advisory lock to allocate an account number.
// Unthrottled that is an approvals queue anybody can flood, a third-party
// storage quota anybody can spend, and — because the lock is global — a way to
// serialise every genuine registration behind a script.
//
// Five in fifteen minutes per address. A household filling in forms on one
// phone connection is nowhere near it; the same family reapplying after a
// rejection is not either. The limit is per address rather than per email
// because the email is chosen by the caller.
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
    // Before the body is read. `req.formData()` buffers four images, so a
    // throttle applied after it has already paid the cost it exists to prevent.
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

    // Sent as its own form field rather than inside `payload`, because
    // `registerApiSchema` is `.strict()` and rejects unknown keys — and it
    // should stay that way: the payload is the application, and the language
    // the applicant is reading is a fact about the request.
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

    // Age, against the foundation's own setting rather than a number compiled
    // in here. The schema checks only that the date parses and is not in the
    // future — deliberately, because the floor is policy and this route is
    // where policy is read. Until 2026-08-26 there was no floor at all and a
    // date of birth of yesterday created a pending member.
    //
    // The form checks this too. This check is the one that counts: the form is
    // a convenience and the caller need not use it.
    const publicSettings = await getPublicSettings();
    const minimumAge = minimumAgeYears(publicSettings);
    const dobProblem = dateOfBirthProblem(payload.dateOfBirth, minimumAge);
    if (dobProblem) {
      return NextResponse.json(
        {
          ok: false,
          error: dateOfBirthMessage(dobProblem, minimumAge, 'en'),
          field: 'dateOfBirth',
          // So the form can render the refusal in the applicant's language
          // rather than echoing this English string back at a Bengali reader.
          code: `DOB_${dobProblem.toUpperCase().replace('-', '_')}`,
          minimumAge,
        },
        { status: 400 },
      );
    }

    // A nominee is who receives the money if the member dies, so the member
    // cannot be their own. Nothing checked this: the same NID in both boxes was
    // accepted and produced a nomination that can never be acted on.
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

    // A rejected applicant's email and phone used to be scrambled here, before
    // this submission had been validated, so that the unique constraint would
    // let them reapply. Two things were wrong with it. It ran *first*, so a
    // submission that then failed on a missing document left somebody else's
    // record permanently renamed and returned a 400 — repeatable by anyone who
    // knew a rejected applicant's email. And it was the second half of the same
    // erasure that made a rejection impossible to communicate.
    //
    // Uniqueness is scoped to live rows now
    // (`20260826120000_live_identity_uniqueness`), so the constraint is already
    // out of the way and nothing has to be destroyed to move it.

    // Check if a LIVE user already holds these details. A rejected application
    // holding the same email is not a conflict — that is the point.
    // Check if user already exists
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
      // Name the field that actually collided. The old version compared phone
      // and called everything else "email", so an NID clash — which this now
      // also checks — would have told the applicant their email was taken.
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
      // The **application's** number, not a member's.
      //
      // This route used to allocate `ACC-KH-33001` here, to a PENDING applicant,
      // before anybody had read the application — so refusing the first one
      // consumed the foundation's first membership number for ever and handed
      // the next applicant `002`. A public form that anybody can submit was
      // punching holes in the register.
      //
      // An account number is issued at **approval** and nowhere else now
      // (`ApproveRegistration` already allocated one for a row that had none;
      // that branch is simply the only one left). The applicant still gets a
      // reference to quote, from the same gapless per-year allocator that backs
      // every receipt and loan number — and one it costs nothing to burn.
      const formNumber = await nextDocumentNumber(SERIES.application, tx);

      // **No branch is assigned here.** Which office a member belongs to is a
      // decision the foundation makes about them, not a property of the form
      // they filled in — a public applicant has no idea which office exists, and
      // this route ran before anybody had read the application. It is chosen by
      // the admin on the approvals screen, alongside the account number that is
      // issued at the same moment ([ADR-042](../../../../../docs/decisions.md));
      // the dialog pre-selects the sole active office, so the foundation's
      // situation today is still one click.

      return tx.user.create({
        data: {
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
        // `formNumber` is what the confirmation page shows the applicant, under
        // the heading it has always had — "Your application reference". Until
        // 2026-08-26 they were told nothing at all: a two-second toast and a
        // redirect to a login page they cannot use, with no reference for the
        // thing they had just spent twenty minutes filling in.
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
          // `applications/APP-2026-000001/nid-front`, one folder per
          // application, named after the reference the applicant was just given.
          // Not `people/`: nobody is a member yet, and the folder that gets
          // deleted when an application is refused should be the application's,
          // not a person's.
          //
          // The document slug is the **public id**, not another folder with a
          // random filename inside it. A registration submits exactly one of
          // each of the four, so the name is unique by construction, and the
          // asset tree stays readable rather than becoming four folders of one
          // file each.
          //
          // `preserveOriginal` stays: an NID scan must not be re-encoded, which
          // is the one rule in this file that cannot be undone after the fact.
          const uploadResult = await uploadImage(
            buffer,
            applicationFolder(created.formNumber, created.id),
            {
              preserveOriginal: true,
              publicId: requirement.slug,
              useFilename: false,
              uniqueFilename: false,
              overwrite: true,
            },
          );

          // Recorded the moment it lands, not after all four settle: if a
          // later upload throws, the ones that already succeeded still need
          // deleting, and a list assembled afterwards never gets built.
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
