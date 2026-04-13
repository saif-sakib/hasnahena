import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:8080/api';
    
    // Identify identifier as either email or phone depending on payload
    const identifier = body.email || body.phone;
    const locale = body.locale || 'en';

    const response = await fetch(`${apiUrl}/v1/auth/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identifier, locale }),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        error: data.message || 'Failed to send reset email',
      }, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[ForgotPassword] Error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Failed to process request'
    }, { status: 500 });
  }
}
