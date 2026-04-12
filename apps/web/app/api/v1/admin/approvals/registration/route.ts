import { NextRequest, NextResponse } from 'next/server';

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
  const response = await fetch(`${apiBase}/v1/dashboard/admin/approvals/registration`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: await req.text(),
    cache: 'no-store',
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
