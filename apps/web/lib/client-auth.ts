import { parseJwtPayload } from './utils';

const TOKEN_KEY = 'hn_access_token';
const FORCE_PASSWORD_CHANGE_KEY = 'hn_force_password_change';

type JwtPayload = {
  exp?: number;
  role?: string;
};

/** Secure context (HTTPS or localhost)? */
function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' || 
         window.location.hostname === 'localhost' ||
         window.location.hostname === '127.0.0.1';
}

/** Clear all client-side auth state. */
export function clearClientAuthState(options?: { dispatchEvent?: boolean }) {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(FORCE_PASSWORD_CHANGE_KEY);
  // Clear cookie with proper security attributes
  const secure = isSecureContext() && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `hn_access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict${secure}`;
  if (options?.dispatchEvent !== false) {
    window.dispatchEvent(new Event('auth-change'));
  }
}

/** Store the token in localStorage (client reads) and a cookie (proxy.ts gate). */
export function setClientAuthToken(token: string, expiresInSeconds?: number) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
  const maxAge =
    typeof expiresInSeconds === 'number' && Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? `; Max-Age=${Math.floor(expiresInSeconds)}`
      : '';
  // Use Secure flag in production, SameSite=Strict for CSRF protection
  const secure = isSecureContext() && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `hn_access_token=${token}; path=/; SameSite=Strict${secure}${maxAge}`;
  window.dispatchEvent(new Event('auth-change'));
}

/** The stored token, or null if missing, invalid or expired. */
export function getValidatedClientToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  const payload = parseJwtPayload<JwtPayload>(token);
  if (!payload || typeof payload.exp !== 'number') {
    clearClientAuthState();
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    clearClientAuthState();
    return null;
  }

  return token;
}

/** The role from the stored token. */
export function getClientRoleFromToken(): string {
  const token = getValidatedClientToken();
  if (!token) return 'member';
  const payload = parseJwtPayload<JwtPayload>(token);
  return payload?.role?.toLowerCase() || 'member';
}
