/**
 * CORS for the Next route handlers, from CORS_ORIGINS — the same list the Go
 * API reads (SEC-03/04).
 */

const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:3001'];

function allowedOrigins(): string[] {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return appUrl ? [appUrl.replace(/\/$/, '')] : DEFAULT_ORIGINS;
}

/** CORS headers; an unknown Origin gets no Allow-Origin at all, never a wildcard. */
export function corsHeaders(request?: Request | null): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  const origin = request?.headers.get('origin')?.trim();
  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}
