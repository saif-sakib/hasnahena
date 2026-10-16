import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { revalidatePath, revalidateTag } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { corsHeaders } from '@/lib/cors';
import { authenticateRequest } from '@/lib/server-auth';
import {
  CONTENT_CONFIG_KEYS,
  MEMBER_CONFIG_KEYS,
  PUBLIC_CONFIG_KEYS,
  partitionConfigKeys,
  SYSTEM_CONFIG_TAG,
  SYSTEM_CONFIG_KEYS,
} from '@/lib/system-config';
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

// Reachable without a token (marketing pages, login, letterheads). The answer
// depends on the caller (WO-77 / SEC-12):
//   anonymous  PUBLIC_CONFIG_KEYS
//   member     + their loan policy
//   worker     + CONTENT_CONFIG_KEYS (Content & Media edits them)
//   admin      SYSTEM_CONFIG_KEYS
// Never `SELECT *` (WO-64). A bad token is treated as no token, not a 401.
export async function GET(request: NextRequest) {
  try {
    const keys = await readableKeysFor(request);
    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: keys } },
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

/** Which tier this caller may read. See the comment on GET. */
async function readableKeysFor(request: NextRequest): Promise<string[]> {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return [...PUBLIC_CONFIG_KEYS];
  if (isAdmin(auth.user.role)) {
    return [...SYSTEM_CONFIG_KEYS];
  }
  // A worker's form must receive every content key it can save back.
  if (auth.user.role === UserRole.WORKER) {
    return [...new Set([...MEMBER_CONFIG_KEYS, ...CONTENT_CONFIG_KEYS])];
  }
  return [...MEMBER_CONFIG_KEYS];
}

function isAdmin(role: string): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

/**
 * Keys a role may not write: an admin writes anything declared, a worker only
 * CONTENT_CONFIG_KEYS. All-or-nothing — a half-applied save must not report success.
 */
function unwritableKeysFor(role: string, keys: string[]): string[] {
  if (isAdmin(role)) return [];
  if (role !== UserRole.WORKER) return keys;
  const allowed = new Set<string>(CONTENT_CONFIG_KEYS);
  return keys.filter((key) => !allowed.has(key));
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.ok) {
      return errorResponse(request, 'Unauthorized', auth.error, 401);
    }

    if (!isAdmin(auth.user.role) && auth.user.role !== UserRole.WORKER) {
      return errorResponse(request, 'Forbidden', 'Insufficient permissions', 403);
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      return errorResponse(request, 'Invalid request', 'Body must be an object', 400);
    }

    // Unknown keys reject the whole request (a typo must not become a new row).
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

    const forbidden = unwritableKeysFor(auth.user.role, Object.keys(body));
    if (forbidden.length > 0) {
      return errorResponse(
        request,
        'Forbidden',
        `This role may not write: ${forbidden.join(', ')}`,
        403,
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

    // The tag reaches every public page (WO-73); revalidatePath drops rendered
    // HTML. `{ expire: 0 }` so the admin sees the save at once ('max' is SWR).
    revalidateTag(SYSTEM_CONFIG_TAG, { expire: 0 });
    revalidatePath('/');
    revalidatePath('/[locale]');
    revalidatePath('/[locale]/gallery');
    revalidatePath('/[locale]/dashboard/admin/settings');
    revalidatePath('/[locale]/dashboard/admin/content');
    revalidatePath('/[locale]/dashboard/worker/content');

    return NextResponse.json({ success: true }, { headers: corsHeaders(request) });
  } catch (error) {
    const status = routeErrorStatus(error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (status) {
      return errorResponse(request, routeErrorMessage(error, 'Failed to update settings'), msg, status);
    }
    return errorResponse(request, 'Failed to update settings', msg, 500);
  }
}
