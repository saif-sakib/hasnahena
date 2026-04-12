import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const APPROVAL_PROXY_TIMEOUT_MS = 55000;

function getApiBase() {
  return (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
}

export async function POST(req: NextRequest) {
  const apiBase = getApiBase();
  if (!apiBase) {
    return NextResponse.json(
      {
        success: false,
        error: { message: 'Approval service is temporarily unavailable. Please try again.' },
      },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APPROVAL_PROXY_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${apiBase}/v1/dashboard/admin/approvals/registration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: await req.text(),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json(
        {
          success: false,
          error: { message: 'Approval is taking too long. Please refresh and verify the member status.' },
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: { message: 'Approval request failed. Please try again.' },
      },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
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
