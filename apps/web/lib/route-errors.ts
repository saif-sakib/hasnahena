import { z } from 'zod';
import { authErrorStatus } from './auth';

/**
 * Reading a JSON body, and turning whatever went wrong into the right status.
 *
 * Every Next route did `await req.json()` inside a try, and every catch ended
 * `return 500`. So a malformed body — a truncated request from a phone that
 * lost signal mid-POST, a client sending form encoding by mistake — produced
 * "Failed to create staff account" and a 500. The caller was told the server
 * had broken when in fact their request had, and a monitoring alert fired for
 * something no operator could act on (TEST-18).
 *
 * The same catch blocks also swallowed `AuthError`, so an expired session on
 * `/api/v1/admin/workers` answered 500 rather than 401 on all four methods —
 * the Phase 1 defect, in the one file Phase 1 did not reach.
 */

/** A fault in the request, not the server. Carries the status to answer with. */
export class BadRequestError extends Error {
  readonly name = 'BadRequestError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Parse a JSON body, raising `BadRequestError` rather than a bare `SyntaxError`
 * when it is not JSON.
 *
 * Every route that calls this expects an object, so a body that is absent,
 * `null`, or a bare array or string is rejected here rather than a few lines
 * later as `Cannot read properties of null (reading 'imageUrl')` — which is
 * what `POST /api/v1/gallery` answered 500 with (TEST-18). Handlers that want
 * to accept a body-less request read their query string instead.
 */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.trim() === '') {
    throw new BadRequestError('Request body is required');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BadRequestError(
      err instanceof Error ? `Malformed JSON body: ${err.message}` : 'Malformed JSON body',
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * The status a caught error should become, or `null` when it is a genuine
 * server fault and 500 is correct.
 *
 * Ordered deliberately: an auth failure outranks a body failure, because a
 * caller who may not be here at all should not learn which fields the endpoint
 * wants.
 */
export function routeErrorStatus(err: unknown): number | null {
  const authStatus = authErrorStatus(err);
  if (authStatus) return authStatus;
  if (err instanceof z.ZodError) return 400;
  if (err instanceof BadRequestError) return 400;

  // Prisma's request errors are the other family that is routinely the
  // caller's fault. Matched on `code` rather than on the error class, because
  // importing `Prisma` from the generated client into every route pulls the
  // whole runtime in for the sake of an instanceof.
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string') {
    // P2025: "an operation failed because it depends on one or more records
    // that were required but not found" — deleting or updating a row that is
    // not there. That is a 404, and it used to be a 500.
    if (code === 'P2025') return 404;
    // P2002: unique constraint violation — the caller sent a phone or email
    // somebody else already has.
    if (code === 'P2002') return 409;
    // P2003: foreign key violation — a reference to something that is gone.
    if (code === 'P2003') return 409;
  }
  return null;
}

/**
 * Human labels for the columns a caller can actually collide on.
 *
 * Only fields a caller *submits* are listed. `accountNo` is generated, so a
 * collision on it is our bug and naming it in a 409 would tell the caller to fix
 * something they never sent.
 */
const UNIQUE_FIELD_LABELS: Record<string, string> = {
  email: 'email address',
  phone: 'phone number',
  nidNumber: 'NID number',
};

/**
 * Which field a P2002 was raised on, as a phrase for a message — or `null` when
 * it cannot be told.
 *
 * Prisma reports the conflict in `meta.target`, and in two shapes. Usually it is
 * the list of model fields (`['email']`). For an index Prisma does not model —
 * `users_email_lower_key`, WO-90's functional unique index on `lower(email)` —
 * it can only report the constraint name, so the name is parsed too. Both are
 * handled because the *case-insensitive* collision is exactly the one this
 * endpoint now catches, and answering it with "That value is already in use"
 * would be the same unhelpful 409 the work order set out to fix.
 */
export function uniqueConflictLabel(err: unknown): string | null {
  const target = (err as { meta?: { target?: unknown } })?.meta?.target;
  const candidates: string[] = Array.isArray(target)
    ? target.filter((t): t is string => typeof t === 'string')
    : typeof target === 'string'
      ? [target]
      : [];

  for (const candidate of candidates) {
    if (UNIQUE_FIELD_LABELS[candidate]) return UNIQUE_FIELD_LABELS[candidate];
    // `users_email_lower_key`, `users_phone_key` — the constraint-name shape.
    for (const [field, label] of Object.entries(UNIQUE_FIELD_LABELS)) {
      if (candidate.includes(`_${field}_`)) return label;
    }
  }
  return null;
}

/**
 * The message to send with that status. Never the raw error for a 500: those
 * carry table names, column names and connection strings.
 */
export function routeErrorMessage(err: unknown, fallback: string): string {
  const status = routeErrorStatus(err);
  if (status === 401) return 'Unauthorized';
  if (status === 404) return 'Not found';
  if (status === 409) {
    // WO-90. "email/phone" told an admin that *one of two* values was taken and
    // left them to work out which. The caller cannot fix what they are not told.
    const label = uniqueConflictLabel(err);
    return label ? `That ${label} is already in use` : 'That value is already in use';
  }
  if (status === 400) {
    if (err instanceof z.ZodError) return 'Validation failed';
    return err instanceof Error ? err.message : 'Invalid request';
  }
  return fallback;
}
