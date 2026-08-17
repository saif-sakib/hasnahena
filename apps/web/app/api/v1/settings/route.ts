import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { corsHeaders } from '@/lib/cors';
import { authenticateRequest } from '@/lib/server-auth';
import { partitionConfigKeys, SYSTEM_CONFIG_KEYS } from '@/lib/system-config';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';

const isDev = process.env.NODE_ENV === 'development';

// Safe error response
function errorResponse(request: Request | null, message: string, details: string, status: number) {
  console.error(`[Settings] ${message}:`, details);
  return NextResponse.json(
    { error: message, ...(isDev && { details }) },
    { status, headers: corsHeaders(request) }
  );
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

// Deliberately unauthenticated: the marketing pages and the login screen read
// the organisation's name, address and contact details from here before anyone
// has signed in.
//
// It returns only the declared keys, not `SELECT *`. Before that it handed the
// entire `system_config` table to anonymous callers, so the day someone adds a
// key holding an internal threshold, an integration id or a partner's contact
// details, it becomes public with no code change and nothing to notice
// (TEST-17). The allowlist is the same one PUT validates against, so a key
// cannot be writable-but-not-readable or the reverse.
export async function GET(request: NextRequest) {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: [...SYSTEM_CONFIG_KEYS] } },
      select: { key: true, value: true },
    });
    const configMap = configs.reduce((acc: Record<string, string>, config) => {
      acc[config.key] = config.value;
      return acc;
    }, {});
    return NextResponse.json(configMap, { headers: corsHeaders(request) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(request, 'Failed to fetch settings', msg, 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.ok) {
      return errorResponse(request, 'Unauthorized', auth.error, 401);
    }

    if (auth.user.role !== UserRole.ADMIN && auth.user.role !== UserRole.SUPER_ADMIN) {
      return errorResponse(request, 'Forbidden', 'Insufficient permissions', 403);
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      return errorResponse(request, 'Invalid request', 'Body must be an object', 400);
    }

    // This route used to upsert whatever key it was handed, so a typo created a
    // brand-new row that looked like a real setting everywhere it was displayed
    // while the code carried on reading the correctly-spelled key and its
    // default. The admin saw "saved" and the behaviour never changed — silent in
    // both directions, and permanent.
    //
    // Rejecting the whole request rather than filtering the bad keys out is
    // deliberate: a partial save that reports success is the same class of lie.
    const { unknown } = partitionConfigKeys(Object.keys(body));
    if (unknown.length > 0) {
      return errorResponse(
        request,
        'Invalid request',
        `Unknown settings key${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. `
          + 'A key must be declared in apps/web/lib/system-config.ts before it can be saved.',
        400,
      );
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

    return NextResponse.json({ success: true }, { headers: corsHeaders(request) });
  } catch (error) {
    // A malformed body is the caller's fault, not the server's. This used to
    // answer 500 "Failed to update settings" for a truncated request (TEST-18).
    const status = routeErrorStatus(error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (status) {
      return errorResponse(request, routeErrorMessage(error, 'Failed to update settings'), msg, status);
    }
    return errorResponse(request, 'Failed to update settings', msg, 500);
  }
}
