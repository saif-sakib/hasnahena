import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle OPTIONS preflight requests
export async function OPTIONS() {
  console.log('[Gallery OPTIONS] Preflight request');
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  try {
    // Debug: Check if DATABASE_URL is set
    const dbUrlExists = !!process.env.DATABASE_URL;
    console.log('[Gallery GET] DATABASE_URL exists:', dbUrlExists);

    const items = await prisma.galleryItem.findMany({
      orderBy: { date: 'desc' },
    });
    console.log('[Gallery GET] Successfully fetched', items.length, 'items');
    return NextResponse.json(items);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[Gallery GET] Failed:', errorMessage);
    console.error('[Gallery GET] Stack:', errorStack);

    // Return verbose error in development/debug
    return NextResponse.json({
      error: 'Failed to fetch items',
      details: errorMessage,
      dbConfigured: !!process.env.DATABASE_URL,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[Gallery POST] Starting...');
    const body = await request.json();
    console.log('[Gallery POST] Body:', JSON.stringify(body));

    const item = await prisma.galleryItem.create({
      data: {
        imageUrl: body.imageUrl,
        captionEn: body.captionEn,
        captionBn: body.captionBn,
        date: body.date ? new Date(body.date) : new Date(),
      },
    });
    console.log('[Gallery POST] Created item:', item.id);
    return NextResponse.json(item);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gallery POST] Failed:', errorMessage);
    return NextResponse.json({
      error: 'Failed to create item',
      details: errorMessage,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    console.log('[Gallery PUT] Starting...');
    const body = await request.json();
    const { id, ...data } = body;
    console.log('[Gallery PUT] Updating id:', id);

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
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
    console.log('[Gallery PUT] Updated item:', item.id);
    return NextResponse.json(item);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gallery PUT] Failed:', errorMessage);
    return NextResponse.json({
      error: 'Failed to update item',
      details: errorMessage,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    console.log('[Gallery DELETE] Deleting id:', id);

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    await prisma.galleryItem.delete({
      where: { id },
    });
    console.log('[Gallery DELETE] Deleted successfully');
    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gallery DELETE] Failed:', errorMessage);
    return NextResponse.json({
      error: 'Failed to delete item',
      details: errorMessage,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
