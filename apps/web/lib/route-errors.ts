import { z } from 'zod';
import { authErrorStatus } from './auth';

/**
 * Reading a JSON body, and mapping caught errors to the right status: a bad
 * body or expired session is the caller's fault, not a 500 (TEST-18).
 */

/** A fault in the request, not the server. Carries the status to answer with. */
export class BadRequestError extends Error {
  readonly name = 'BadRequestError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Parse a JSON body; anything that is not a JSON object raises BadRequestError.
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
 * The status a caught error should become, or null for a genuine 500. Auth
 * outranks body errors.
 */
export function routeErrorStatus(err: unknown): number | null {
  const authStatus = authErrorStatus(err);
  if (authStatus) return authStatus;
  if (err instanceof z.ZodError) return 400;
  if (err instanceof BadRequestError) return 400;

  // Prisma request errors, matched on `code` to avoid importing the runtime.
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string') {
    // P2025: record not found.
    if (code === 'P2025') return 404;
    // P2002: unique constraint violation.
    if (code === 'P2002') return 409;
    // P2003: foreign key violation — a reference to something that is gone.
    if (code === 'P2003') return 409;
  }
  return null;
}

/** Labels for fields a caller submits (generated ones like accountNo are our bug). */
const UNIQUE_FIELD_LABELS: Record<string, string> = {
  email: 'email address',
  phone: 'phone number',
  nidNumber: 'NID number',
};

/**
 * Which field a P2002 hit, from `meta.target` — field names, or a constraint
 * name for unmodelled indexes like users_email_lower_key (WO-90).
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

/** The message for that status — never the raw error for a 500. */
export function routeErrorMessage(err: unknown, fallback: string): string {
  const status = routeErrorStatus(err);
  if (status === 401) return 'Unauthorized';
  if (status === 404) return 'Not found';
  if (status === 409) {
    // Name the field that collided (WO-90).
    const label = uniqueConflictLabel(err);
    return label ? `That ${label} is already in use` : 'That value is already in use';
  }
  if (status === 400) {
    if (err instanceof z.ZodError) return 'Validation failed';
    return err instanceof Error ? err.message : 'Invalid request';
  }
  return fallback;
}
