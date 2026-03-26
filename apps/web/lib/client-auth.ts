const TOKEN_KEY = 'hn_access_token';
const FORCE_PASSWORD_CHANGE_KEY = 'hn_force_password_change';

type JwtPayload = {
  exp?: number;
  role?: string;
};

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(`${normalized}${padding}`);
}

function parseTokenPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const payloadRaw = decodeBase64Url(parts[1]);
    return JSON.parse(payloadRaw) as JwtPayload;
  } catch {
    return null;
  }
}

export function clearClientAuthState(options?: { dispatchEvent?: boolean }) {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(FORCE_PASSWORD_CHANGE_KEY);
  document.cookie = 'hn_access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  if (options?.dispatchEvent !== false) {
    window.dispatchEvent(new Event('auth-change'));
  }
}

export function setClientAuthToken(token: string, expiresInSeconds?: number) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
  const maxAge =
    typeof expiresInSeconds === 'number' && Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? `; Max-Age=${Math.floor(expiresInSeconds)}`
      : '';
  document.cookie = `hn_access_token=${token}; path=/; SameSite=Lax${maxAge}`;
  window.dispatchEvent(new Event('auth-change'));
}

export function getValidatedClientToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  const payload = parseTokenPayload(token);
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

export function getClientRoleFromToken(): string {
  const token = getValidatedClientToken();
  if (!token) return 'member';
  const payload = parseTokenPayload(token);
  return payload?.role?.toLowerCase() || 'member';
}

export function isForcePasswordChangeRequired(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(FORCE_PASSWORD_CHANGE_KEY) === '1';
}
