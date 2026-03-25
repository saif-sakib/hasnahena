import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/server-auth';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle OPTIONS preflight requests
export async function OPTIONS() {
  console.log('[Settings OPTIONS] Preflight request');
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  try {
    console.log('[Settings GET] Starting...');
    console.log('[Settings GET] DATABASE_URL exists:', !!process.env.DATABASE_URL);

    const configs = await prisma.systemConfig.findMany();
    // Transform into a simple key-value object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configMap = configs.reduce((acc: any, config) => {
      acc[config.key] = config.value;
      return acc;
    }, {});

    console.log('[Settings GET] Fetched', Object.keys(configMap).length, 'settings');
    return NextResponse.json(configMap);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Settings GET] Failed:', errorMessage);
    return NextResponse.json({
      error: 'Failed to fetch settings',
      details: errorMessage,
      dbConfigured: !!process.env.DATABASE_URL,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  console.log('[Settings PUT] Starting...');
  console.log('[Settings PUT] Method:', request.method);

  try {
    // Debug auth config
    console.log('[Settings PUT] JWT_SECRET exists:', !!process.env.JWT_SECRET);
    console.log('[Settings PUT] NEXT_PUBLIC_API_URL:', process.env.NEXT_PUBLIC_API_URL || 'NOT SET');

    const auth = await authenticateRequest(request);
    console.log('[Settings PUT] Auth result:', auth.ok ? 'OK' : auth.error);

    if (!auth.ok) {
      return NextResponse.json({
        error: auth.error,
        details: 'Authentication failed',
        jwtSecretExists: !!process.env.JWT_SECRET,
        apiUrlConfigured: !!process.env.NEXT_PUBLIC_API_URL,
        timestamp: new Date().toISOString()
      }, { status: 401 });
    }

    console.log('[Settings PUT] User role:', auth.user.role);
    if (auth.user.role !== UserRole.ADMIN && auth.user.role !== UserRole.SUPER_ADMIN) {
      return NextResponse.json({
        error: 'Forbidden',
        details: `Role ${auth.user.role} is not allowed`,
        timestamp: new Date().toISOString()
      }, { status: 403 });
    }

    const body = await request.json();
    console.log('[Settings PUT] Body keys:', Object.keys(body));

    // Process all keys in the body
    const updates = Object.entries(body).map(([key, value]) => {
      // Ensure value is a string
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

      return prisma.systemConfig.upsert({
        where: { key },
        update: { value: stringValue },
        create: { key: key, value: stringValue },
      });
    });

    // Use transaction to ensure all updates succeed
    await prisma.$transaction(updates);
    console.log('[Settings PUT] Updated', updates.length, 'settings');

    revalidatePath('/');
    revalidatePath('/[locale]');
    revalidatePath('/[locale]/gallery');
    revalidatePath('/[locale]/dashboard/admin/settings');

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[Settings PUT] Failed:', errorMessage);
    console.error('[Settings PUT] Stack:', errorStack);

    if (errorMessage.toLowerCase().includes('authorization') || errorMessage.toLowerCase().includes('token')) {
      return NextResponse.json({
        error: 'Unauthorized',
        details: errorMessage,
        timestamp: new Date().toISOString()
      }, { status: 401 });
    }
    return NextResponse.json({
      error: 'Failed to update settings',
      details: errorMessage,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
