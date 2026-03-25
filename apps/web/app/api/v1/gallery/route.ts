import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const isDev = process.env.NODE_ENV === 'development';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Safe error response (hides details in production)
function errorResponse(message: string, details: string, status: number) {
  console.error(`[Gallery] ${message}:`, details);
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
    const items = await prisma.galleryItem.findMany({
      orderBy: { date: 'desc' },
    });
    return NextResponse.json(items, { headers: corsHeaders });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse('Failed to fetch gallery', msg, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.imageUrl) {
      return errorResponse('Image URL required', 'Missing imageUrl field', 400);
    }

    const item = await prisma.galleryItem.create({
      data: {
        imageUrl: body.imageUrl,
        captionEn: body.captionEn || null,
        captionBn: body.captionBn || null,
        date: body.date ? new Date(body.date) : new Date(),
      },
    });
    return NextResponse.json(item, { headers: corsHeaders });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse('Failed to create gallery item', msg, 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...data } = body;

    if (!id) {
      return errorResponse('ID required', 'Missing id field', 400);
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
    return NextResponse.json(item, { headers: corsHeaders });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse('Failed to update gallery item', msg, 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return errorResponse('ID required', 'Missing id parameter', 400);
    }

    await prisma.galleryItem.delete({ where: { id } });
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse('Failed to delete gallery item', msg, 500);
  }
}
