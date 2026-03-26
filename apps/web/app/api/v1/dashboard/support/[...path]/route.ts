import { NextRequest, NextResponse } from 'next/server';

function getApiBase() {
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/$/, '');
}

function buildTargetUrl(req: NextRequest, path: string[] | undefined): string {
  const parts = (path || []).filter(Boolean).join('/');
  const query = req.nextUrl.search || '';
  return `${getApiBase()}/v1/dashboard/support/${parts}${query}`;
}

async function forward(req: NextRequest, path: string[] | undefined) {
  const targetUrl = buildTargetUrl(req, path);
  const isStream = (path || []).join('/') === 'stream';
  const auth = req.headers.get('authorization');
  const contentType = req.headers.get('content-type');

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: {
      ...(auth ? { Authorization: auth } : {}),
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
    cache: 'no-store',
  });

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
  context: { params: { path?: string[] } }
) {
  return forward(req, context.params.path);
}

export async function POST(
  req: NextRequest,
  context: { params: { path?: string[] } }
) {
  return forward(req, context.params.path);
}

export async function PUT(
  req: NextRequest,
  context: { params: { path?: string[] } }
) {
  return forward(req, context.params.path);
}
