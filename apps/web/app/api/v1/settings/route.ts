import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/server-auth';

const isDev = process.env.NODE_ENV === 'development';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Safe error response
function errorResponse(message: string, details: string, status: number) {
  console.error(`[Settings] ${message}:`, details);
  return NextResponse.json(
    { error: message, ...(isDev && { details }) },
    { status, headers: corsHeaders }
  );
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  try {
    const configs = await prisma.systemConfig.findMany();
    const configMap = configs.reduce((acc: Record<string, string>, config) => {
      acc[config.key] = config.value;
      return acc;
    }, {});
    return NextResponse.json(configMap, { headers: corsHeaders });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse('Failed to fetch settings', msg, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.ok) {
      return errorResponse('Unauthorized', auth.error, 401);
    }

    if (auth.user.role !== UserRole.ADMIN && auth.user.role !== UserRole.SUPER_ADMIN) {
      return errorResponse('Forbidden', 'Insufficient permissions', 403);
    }

    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return errorResponse('Invalid request', 'Body must be an object', 400);
    }

    const updates = Object.entries(body).map(([key, value]) => {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return prisma.systemConfig.upsert({
        where: { key },
        update: { value: stringValue },
        create: { key, value: stringValue },
      });
    });

    await prisma.$transaction(updates);

    revalidatePath('/');
    revalidatePath('/[locale]');
    revalidatePath('/[locale]/gallery');
    revalidatePath('/[locale]/dashboard/admin/settings');

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse('Failed to update settings', msg, 500);
  }
}
