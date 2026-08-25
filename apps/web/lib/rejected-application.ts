/**
 * What a *rejected* registration looks like, in one place.
 *
 * This predicate decides who owns an email address, a phone number and an NID.
 * A live member owns theirs exclusively; a **rejected applicant owns nothing**,
 * which is what lets them apply again with the same details — the owner's
 * ruling on 2026-08-26.
 *
 * ---
 *
 * **Why this exists at all.** Until 2026-08-26 rejection *overwrote* the
 * applicant's contact details on the spot:
 *
 *     email = CONCAT('rejected+', id, '@hasnahena.local')
 *     phone = CONCAT('rejected-', id)
 *
 * The stated reason was to free the unique constraint so the applicant could
 * reapply, and it worked — but it destroyed the only means of telling them they
 * had been rejected, in the same statement that decided it. The foundation had
 * an application it had turned down and no way to say so. That is the defect
 * this replaces: uniqueness is now scoped to live rows, so the constraint is
 * free without anything being erased, and the rejection email has an address to
 * go to.
 *
 * The same scramble also ran, lazily, at the top of `POST /registrations`,
 * *before* the new application had been validated — so a deliberately invalid
 * submission using a rejected applicant's email permanently scrambled their
 * record and returned a 400. Both copies are gone.
 *
 * ---
 *
 * **Three consumers must agree**, and nothing at runtime would notice if they
 * drifted:
 *
 *   1. the partial unique indexes in the migration (`users_email_live_key`,
 *      `users_phone_live_key`, `users_nid_live_key`),
 *   2. this module, for Prisma queries in the Next app,
 *   3. `RejectedApplicationSQL` in the Go API's `auth_repository.go`.
 *
 * `apps/web/test/unit/rejected-application.test.ts` reads all three and fails
 * when one changes without the others. An index whose predicate is narrower
 * than the query's is a duplicate row nobody refused; wider, and it is a
 * genuine applicant told their own email is taken.
 */

import { Prisma, UserRole, UserStatus } from '@prisma/client';

/**
 * The password hash written at registration and left in place until approval.
 *
 * bcrypt can never produce this string, so it can never match a password — a
 * pending or rejected applicant cannot log in whatever they type. It is also
 * the flag that distinguishes a **rejected application** from a **deactivated
 * member**, both of which are `INACTIVE`: the member has a real hash and an
 * `approvedAt`, and keeps their identifiers reserved.
 */
export const PENDING_APPROVAL_PASSWORD_HASH = '__PENDING_APPROVAL_NO_LOGIN__';

/**
 * The rejected-application predicate as raw SQL, in the exact spelling the
 * migration's index predicates use.
 *
 * Exported as a string rather than assembled per call site so the census can
 * compare it byte for byte against the migration and against the Go constant.
 */
export const REJECTED_APPLICATION_SQL =
  `role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL ` +
  `AND "passwordHash" = '${PENDING_APPROVAL_PASSWORD_HASH}'`;

/** The same predicate as a Prisma filter. */
export const rejectedApplicationFilter: Prisma.UserWhereInput = {
  role: UserRole.MEMBER,
  status: UserStatus.INACTIVE,
  approvedAt: null,
  passwordHash: PENDING_APPROVAL_PASSWORD_HASH,
};

/**
 * Restrict a user query to rows that still own their identifiers.
 *
 * Every lookup by email or phone must carry this. Two rows may now share an
 * address — one rejected, one live — and a lookup that does not exclude the
 * rejected one can return it: `FindByIdentifier` would have authenticated
 * against a row whose password can never match, and the availability check
 * would have told a genuine applicant their own email was taken.
 */
export const liveIdentityFilter: Prisma.UserWhereInput = {
  NOT: rejectedApplicationFilter,
};
