import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsHeaders } from '@/lib/cors';
import { authenticateRequest } from '@/lib/server-auth';
import { revalidateTag } from 'next/cache';
import { readJsonBody, routeErrorStatus, routeErrorMessage } from '@/lib/route-errors';
import { GALLERY_TAG } from '@/lib/public-content';

const isDev = process.env.NODE_ENV === 'development';

// Safe error response (hides details in production)
function errorResponse(request: Request | null, message: string, details: string, status: number) {
  console.error(`[Gallery] ${message}:`, details);
  return NextResponse.json(
    { error: message, ...(isDev && { details }) },
    { status, headers: corsHeaders(request) }
  );
}

/**
 * Writing to the gallery is an admin action. Without this the public gallery of
 * a charity's site was rewritable by anyone who could reach the URL (SEC-03).
 */
async function requireAdmin(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return errorResponse(request, 'Unauthorized', auth.error, 401);
  }
  if (auth.user.role !== UserRole.ADMIN && auth.user.role !== UserRole.SUPER_ADMIN) {
    return errorResponse(request, 'Forbidden', 'Insufficient permissions', 403);
  }
  return null;
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

// The gallery is public content — GET stays unauthenticated.
export async function GET(request: NextRequest) {
  try {
    // WO-75. Named columns, not the row: `createdAt` and `updatedAt` are on
    // every gallery item and are read by nothing — not this route's admin
    // caller, not the public pages, not the documents.
    const items = await prisma.galleryItem.findMany({
      orderBy: { date: 'desc' },
      select: {
        id: true,
        imageUrl: true,
        captionEn: true,
        captionBn: true,
        date: true,
        likes: true,
      },
    });
    return NextResponse.json(items, { headers: corsHeaders(request) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(request, 'Failed to fetch gallery', msg, 500);
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const body = (await readJsonBody(request)) as any;

    if (!body.imageUrl) {
      return errorResponse(request, 'Image URL required', 'Missing imageUrl field', 400);
    }

    const item = await prisma.galleryItem.create({
      data: {
        imageUrl: body.imageUrl,
        captionEn: body.captionEn || null,
        captionBn: body.captionBn || null,
        date: body.date ? new Date(body.date) : new Date(),
      },
    });
    // WO-73: the public gallery and the homepage render from a cached read.
    revalidateTag(GALLERY_TAG, { expire: 0 });
    return NextResponse.json(item, { headers: corsHeaders(request) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    // A malformed body, or an id that no longer exists, is the caller's
    // fault; both used to be reported as a 500 (TEST-18).
    const status = routeErrorStatus(error);
    if (status) {
      return errorResponse(request, routeErrorMessage(error, 'Failed to create gallery item'), msg, status);
    }
    return errorResponse(request, 'Failed to create gallery item', msg, 500);
  }
}

export async function PUT(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const body = (await readJsonBody(request)) as any;
    const { id, ...data } = body;

    if (!id) {
      return errorResponse(request, 'ID required', 'Missing id field', 400);
    }

    const item = await prisma.galleryItem.update({
      where: { id },
      data: {
        imageUrl: data.imageUrl,
        captionEn: data.captionEn,
        captionBn: data.captionBn,
        date: data.date ? new Date(data.date) : undefined,
      },
    });
    // WO-73: the public gallery and the homepage render from a cached read.
    revalidateTag(GALLERY_TAG, { expire: 0 });
    return NextResponse.json(item, { headers: corsHeaders(request) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    // A malformed body, or an id that no longer exists, is the caller's
    // fault; both used to be reported as a 500 (TEST-18).
    const status = routeErrorStatus(error);
    if (status) {
      return errorResponse(request, routeErrorMessage(error, 'Failed to update gallery item'), msg, status);
    }
    return errorResponse(request, 'Failed to update gallery item', msg, 500);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return errorResponse(request, 'ID required', 'Missing id parameter', 400);
    }

    await prisma.galleryItem.delete({ where: { id } });
    revalidateTag(GALLERY_TAG, { expire: 0 });
    return NextResponse.json({ success: true }, { headers: corsHeaders(request) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    // A malformed body, or an id that no longer exists, is the caller's
    // fault; both used to be reported as a 500 (TEST-18).
    const status = routeErrorStatus(error);
    if (status) {
      return errorResponse(request, routeErrorMessage(error, 'Failed to delete gallery item'), msg, status);
    }
    return errorResponse(request, 'Failed to delete gallery item', msg, 500);
  }
}
