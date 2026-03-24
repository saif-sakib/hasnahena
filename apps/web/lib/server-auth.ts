import { getApiBaseUrl } from './api';
import { verifyHs256Jwt } from './jwt';

type AuthenticatedUser = {
  id: string;
  role: string;
};

function normalizeRole(role: unknown): string {
  return String(role ?? '').trim().toUpperCase();
}

async function fetchUserFromApi(token: string): Promise<AuthenticatedUser | null> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/v1/dashboard/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success || !payload?.data?.id) {
      return null;
    }

    return {
      id: String(payload.data.id),
      role: normalizeRole(payload.data.role),
    };
  } catch {
    return null;
  }
}

export async function authenticateServerActionToken(
  token: string | null | undefined
): Promise<{ ok: true; user: AuthenticatedUser } | { ok: false; error: string }> {
  const trimmed = token?.trim();
  if (!trimmed) {
    return { ok: false, error: 'Not authenticated' };
  }

  const secret = process.env.JWT_SECRET;
  if (secret) {
    try {
      const claims = verifyHs256Jwt(trimmed, secret);
      if (claims.sub) {
        return {
          ok: true,
          user: {
            id: claims.sub,
            role: normalizeRole(claims.role),
          },
        };
      }
    } catch {
      // Fallback to API verification for production env mismatches.
    }
  }

  const apiUser = await fetchUserFromApi(trimmed);
  if (!apiUser) {
    return { ok: false, error: 'Invalid authentication token' };
  }

  return { ok: true, user: apiUser };
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!auth) {
    return null;
  }

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return match[1]?.trim() || null;
}

export async function authenticateRequest(
  request: Request
): Promise<{ ok: true; user: AuthenticatedUser } | { ok: false; error: string }> {
  const token = extractBearerToken(request);
  return authenticateServerActionToken(token);
}

export async function authorizeServerActionRoles(
  token: string | null | undefined,
  allowedRoles: string[],
  unauthorizedMessage: string
): Promise<{ ok: true; user: AuthenticatedUser } | { ok: false; error: string }> {
  const auth = await authenticateServerActionToken(token);
  if (!auth.ok) {
    return auth;
  }

  const allowed = new Set(allowedRoles.map((role) => normalizeRole(role)));
  if (!allowed.has(auth.user.role)) {
    return { ok: false, error: unauthorizedMessage };
  }

  return auth;
}
