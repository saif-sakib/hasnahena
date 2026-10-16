/**
 * What a rejected registration looks like — which decides who owns an email,
 * phone and NID. A rejected applicant owns nothing, so they may re-apply with
 * the same details; uniqueness is scoped to live rows (partial *_live_key
 * indexes). Three copies must agree, checked by rejected-application.test.ts:
 * the migration's index predicates, this module, and RejectedApplicationSQL in
 * auth_repository.go.
 */

import { Prisma, UserRole, UserStatus } from '@prisma/client';

/**
 * Written at registration until approval; bcrypt never produces it, so no
 * applicant can log in. Also tells a rejected application (this hash) from a
 * deactivated member (real hash, approvedAt).
 */
export const PENDING_APPROVAL_PASSWORD_HASH = '__PENDING_APPROVAL_NO_LOGIN__';

/** The predicate as raw SQL, byte-identical to the migration and the Go constant. */
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
 * Restrict a user query to rows that still own their identifiers. EVERY lookup
 * by email, phone or NID must carry this.
 */
export const liveIdentityFilter: Prisma.UserWhereInput = {
  NOT: rejectedApplicationFilter,
};
