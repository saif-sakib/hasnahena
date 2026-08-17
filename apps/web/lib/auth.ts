import { verifyHs256Jwt } from './jwt';

type AuthUser = {
  id: string;
  role: string;
  email?: string;
  phone?: string;
};

/**
 * Why this class exists
 * ---------------------
 * Route handlers used to decide the status code by searching the error message:
 *
 *     if (msg.toLowerCase().includes('authorization')) return 401;
 *     return 500;
 *
 * Only two of the eight failures this module can produce contain that word, so
 * six of them — **including an expired token** — answered 500. A member whose
 * session ran out was told "Failed to create loan application" instead of being
 * sent to log in, and the client had no way to know it should re-authenticate,
 * because the server had claimed the fault was its own.
 *
 * The status now travels with the error instead of being re-derived from prose.
 * A message can be reworded without silently changing an HTTP contract.
 */
export type AuthFailure =
  | 'missing_header'
  | 'malformed_header'
  | 'invalid_token'
  | 'expired_token'
  | 'invalid_claims'
  | 'server_misconfigured';

export class AuthError extends Error {
  readonly name = 'AuthError';
  readonly failure: AuthFailure;
  /** 401 for anything the caller can fix; 500 only when the server is at fault. */
  readonly status: 401 | 500;

  constructor(failure: AuthFailure, message: string) {
    super(message);
    this.failure = failure;
    this.status = failure === 'server_misconfigured' ? 500 : 401;
  }
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}

/**
 * Maps a thrown value to the status a route should answer with.
 *
 * Returns `null` when the error is not an authentication failure, so a caller
 * can fall through to its own handling rather than guessing.
 */
export function authErrorStatus(err: unknown): 401 | 500 | null {
  return isAuthError(err) ? err.status : null;
}

/** Classify what `verifyHs256Jwt` threw, without reading it back as prose. */
function classifyJwtError(err: unknown): AuthError {
  const message = err instanceof Error ? err.message : 'Invalid token';
  if (message === 'Token expired') {
    return new AuthError('expired_token', 'Token expired');
  }
  return new AuthError('invalid_token', message);
}

/**
 * Verified identity plus the two things a revocation check needs: the raw token
 * (to hash against `token_blacklist`) and `iat` (to compare against a
 * revoke-all marker). Kept separate from `requireAuth` so the common path never
 * carries the raw token around where it could be logged.
 */
export type VerifiedToken = {
  user: AuthUser;
  token: string;
  issuedAt?: number;
};

export function requireAuthDetailed(req: Request): VerifiedToken {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!auth) throw new AuthError('missing_header', 'Missing Authorization header');

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AuthError('malformed_header', 'Invalid Authorization header');

  const token = match[1].trim();
  if (!token) throw new AuthError('malformed_header', 'Invalid Authorization header');

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AuthError('server_misconfigured', 'Server missing JWT_SECRET');

  let claims;
  try {
    claims = verifyHs256Jwt(token, secret);
  } catch (err) {
    throw classifyJwtError(err);
  }

  if (!claims.sub) throw new AuthError('invalid_claims', 'Invalid token claims');

  return {
    user: {
      id: claims.sub,
      role: claims.role ?? '',
      email: claims.email,
      phone: claims.phone,
    },
    token,
    issuedAt: typeof claims.iat === 'number' ? claims.iat : undefined,
  };
}

/**
 * Signature and expiry only. **This does not check revocation** — see
 * `requireActiveAuth` in `lib/auth-revocation.ts` for that. Use this only where
 * a revoked token would be harmless.
 */
export function requireAuth(req: Request): AuthUser {
  return requireAuthDetailed(req).user;
}
