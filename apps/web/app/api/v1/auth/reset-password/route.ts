import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Token is required' }, { status: 400 });
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:8080/api';
    const response = await fetch(`${apiUrl}/v1/auth/reset-password?token=${encodeURIComponent(token)}`);
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        error: data.message || 'Invalid or expired token',
      }, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[ResetPassword GET] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to validate token' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:8080/api';

    const response = await fetch(`${apiUrl}/v1/auth/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body), // passing token and password directly
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        error: data.message || 'Failed to reset password',
      }, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[ResetPassword POST] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to reset password' }, { status: 500 });
  }
}
