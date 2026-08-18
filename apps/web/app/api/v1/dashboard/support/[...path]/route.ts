import { NextRequest, NextResponse } from 'next/server';
import { consumeRateLimit, callerAddress } from '@/lib/rate-limit';

/**
 * The exact upstream surface this proxy is allowed to reach, path by path and
 * method by method. It mirrors the `dashboard.<Method>("/support/...")` lines in
 * `apps/api/cmd/server/main.go`; adding a support route there without adding it
 * here means the new route is simply not reachable through the proxy.
 *
 * An allow-list rather than sanitising, because sanitising this was the defect
 * (WO-64). The segments arrive already percent-decoded by Next, so `%2e%2e%2f`
 * is a literal `../` by the time any check could see it, and `fetch` normalises
 * the result away before the request leaves — which turned a proxy for
 * `/v1/dashboard/support/*` into a proxy for any path on the API base.
 *
 * That was never privilege escalation, and it is worth being accurate about
 * why: the Go API authorises every route itself and gates the `/admin` group at
 * the router, so a member's token is refused there whichever door it arrives
 * at. It was an unnecessary door, not an open safe.
 */
const UPSTREAM_ROUTES: Record<string, readonly string[]> = {
  config: ['GET', 'PUT'],
  threads: ['GET'],
  'threads/processed': ['POST'],
  messages: ['GET', 'POST'],
  stream: ['GET'],
  'stream/ticket': ['POST'],
};

/**
 * Support mutations a single member may make per minute.
 *
 * Matched to the Go API's own default so a member who behaves sees no
 * difference. Reads are not counted, exactly as `rateLimitExempt` does not
 * count them over there.
 */
const SUPPORT_MUTATION_LIMIT = 60;
const SUPPORT_MUTATION_WINDOW_SECONDS = 60;

function getApiBase() {
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/$/, '');
}

/** The upstream path for this request, or null if it is not one we serve. */
function resolveUpstreamPath(path: string[] | undefined, method: string): string | null {
  const parts = (path || []).filter(Boolean);
  // Reject before joining: a segment containing a slash or a traversal is not a
  // segment, whatever it decoded from.
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

  // Keyed on the member's address, here, because here is the only place it is
  // known. The Go limiter sees Vercel's address for anything that comes through
  // this proxy and cannot see past it: X-Forwarded-For is read from the trusted
  // end, and forwarding an extra entry from this route would land at an index
  // `TRUSTED_PROXIES` does not read. Raising that setting to compensate is not
  // an option either — it is one global number, and it would then believe a
  // spoofed entry on the traffic that reaches the API directly. So this half of
  // the limiting belongs on this side of the hop. See ADR-021.
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
        // Deliberately no X-Forwarded-For: see the comment above. The upstream
        // hop appends the address it sees, and that is the entry the Go API is
        // configured to read.
        ...(auth ? { Authorization: auth } : {}),
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      body: isMutation ? await req.text() : undefined,
      cache: 'no-store',
      // The member's disconnect has to reach the Go API. Without it an
      // abandoned SSE connection stayed open upstream for as long as the
      // process lived, and RUN-02 ends streams first at shutdown precisely
      // because open streams eat the drain window.
      signal: req.signal,
    });
  } catch (error) {
    if (req.signal.aborted) {
      // The member is gone; nothing will read this. Answering rather than
      // throwing keeps it out of the error log as a fault.
      return new NextResponse(null, { status: 499 });
    }
    console.error('[support proxy] upstream request failed:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Support service is unavailable' } },
      { status: 502 },
    );
  }

  if (isStream) {
    return new NextResponse(response.body, {
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
