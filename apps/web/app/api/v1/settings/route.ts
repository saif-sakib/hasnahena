import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { revalidatePath, revalidateTag } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { corsHeaders } from '@/lib/cors';
import { authenticateRequest } from '@/lib/server-auth';
import {
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

// Deliberately reachable without a token: the marketing pages, the login screen
// and every generated document's letterhead read the organisation's name,
// address and contact details from here before anyone has signed in.
//
// What a caller gets depends on who they are (WO-77 / SEC-12):
//
//   anonymous       PUBLIC_CONFIG_KEYS  — branding, org details, landing copy
//   signed in       + the loan policy governing their own money
//   admin           SYSTEM_CONFIG_KEYS  — everything, because they edit it
//
// It has not returned `SELECT *` since WO-64: before that it handed the entire
// `system_config` table to anonymous callers, so the day someone added a key
// holding an internal threshold, an integration id or a partner's contact
// details it became public with no code change and nothing to notice (TEST-17).
// Narrowing it to the declared keys fixed the wholesale leak; this fixes the
// retail one, where a declared key is nonetheless nobody's business but staff's.
//
// A bad token is treated as no token rather than as a 401. This endpoint's whole
// job is to answer a caller who has not signed in, and an expired session must
// still render a login page with the right logo on it.
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
  if (auth.user.role === UserRole.ADMIN || auth.user.role === UserRole.SUPER_ADMIN) {
    return [...SYSTEM_CONFIG_KEYS];
  }
  return [...MEMBER_CONFIG_KEYS];
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

    // The tag is what the public pages actually read through (WO-73): every one
    // of them shares a single `getPublicSettings()` cache entry, so one bust
    // reaches all ten rather than the four paths named below. The
    // `revalidatePath` calls stay because they also drop each route's rendered
    // HTML, which the tag alone would not for a page that read no settings.
    // `{ expire: 0 }`, not `'max'`: an admin who saves and reloads must see what
    // they saved. The `'max'` profile is stale-while-revalidate, which shows
    // them the old value once and looks exactly like a save that did not work.
    // The one-argument form does the same thing but is deprecated in Next 16.
    revalidateTag(SYSTEM_CONFIG_TAG, { expire: 0 });
    revalidatePath('/');
    revalidatePath('/[locale]');
    revalidatePath('/[locale]/gallery');
    revalidatePath('/[locale]/dashboard/admin/settings');
    revalidatePath('/[locale]/dashboard/admin/content');

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
