import { NextRequest, NextResponse } from 'next/server';
import { consumeRateLimit, callerAddress } from '@/lib/rate-limit';
import { endStreamOnUpstreamFailure } from '@/lib/sse-stream';

/**
 * The upstream routes this proxy may reach, mirroring the /support lines in
 * main.go (support-proxy-allowlist.test.ts). An allow-list, because segments
 * arrive percent-decoded and fetch normalises `../` away (WO-64).
 */
const UPSTREAM_ROUTES: Record<string, readonly string[]> = {
  config: ['GET', 'PUT'],
  threads: ['GET'],
  'threads/processed': ['POST'],
  messages: ['GET', 'POST'],
  stream: ['GET'],
  'stream/ticket': ['POST'],
};

/** Support mutations per member per minute, matching the Go default. Reads are not counted. */
const SUPPORT_MUTATION_LIMIT = 60;
const SUPPORT_MUTATION_WINDOW_SECONDS = 60;

function getApiBase() {
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/$/, '');
}

/** The upstream path for this request, or null if it is not one we serve. */
function resolveUpstreamPath(path: string[] | undefined, method: string): string | null {
  const parts = (path || []).filter(Boolean);
  // A segment with a slash or traversal is not a segment.
  if (parts.some((segment) => segment.includes('/') || segment === '.' || segment === '..')) {
    return null;
  }
  const joined = parts.join('/');
  const methods = Object.prototype.hasOwnProperty.call(UPSTREAM_ROUTES, joined)
    ? UPSTREAM_ROUTES[joined]
    : undefined;
  if (!methods || !methods.includes(method)) return null;
  return joined;
}

function notFound() {
  return NextResponse.json({ success: false, error: { message: 'Not found' } }, { status: 404 });
}

async function forward(req: NextRequest, path: string[] | undefined) {
  const upstreamPath = resolveUpstreamPath(path, req.method);
  if (upstreamPath === null) return notFound();

  const isStream = upstreamPath === 'stream';
  const isMutation = req.method !== 'GET' && req.method !== 'HEAD';

  // Limited here, by the member's address: through this proxy the Go limiter
  // only sees Vercel's address (ADR-021).
  if (isMutation) {
    const outcome = await consumeRateLimit('support', callerAddress(req), {
      limit: SUPPORT_MUTATION_LIMIT,
      windowSeconds: SUPPORT_MUTATION_WINDOW_SECONDS,
    });
    if (!outcome.allowed) {
      return NextResponse.json(
        { success: false, error: { message: 'Too many requests' } },
        { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSeconds) } },
      );
    }
  }

  const query = req.nextUrl.search || '';
  const targetUrl = `${getApiBase()}/v1/dashboard/support/${upstreamPath}${query}`;
  const auth = req.headers.get('authorization');
  const contentType = req.headers.get('content-type');

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        // No X-Forwarded-For (ADR-021).
        ...(auth ? { Authorization: auth } : {}),
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      body: isMutation ? await req.text() : undefined,
      cache: 'no-store',
      // Forward the disconnect so the upstream SSE stream closes.
      signal: req.signal,
    });
  } catch (error) {
    if (req.signal.aborted) {
      // The member is gone; 499, not an error.
      return new NextResponse(null, { status: 499 });
    }
    console.error('[support proxy] upstream request failed:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Support service is unavailable' } },
      { status: 502 },
    );
  }

  if (isStream) {
    // Wrapped so an upstream drop ends the stream cleanly (lib/sse-stream.ts).
    return new NextResponse(endStreamOnUpstreamFailure(response.body), {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      },
    });
  }

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await context.params;
  return forward(req, path);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await context.params;
  return forward(req, path);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await context.params;
  return forward(req, path);
}
