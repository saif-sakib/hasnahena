/**
 * CORS for the Next route handlers.
 *
 * These endpoints used to answer `Access-Control-Allow-Origin: *`, which let any
 * page on the internet read and (before the auth checks were added) write them —
 * SEC-03/SEC-04. Origins now come from `CORS_ORIGINS`, the same comma-separated
 * list the Go API reads, so both backends agree on who may call them.
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

/**
 * Headers for a cross-origin response. An unrecognised (or absent) Origin gets
 * no `Access-Control-Allow-Origin` at all, which is what makes the browser
 * refuse the response — never a wildcard.
 */
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
