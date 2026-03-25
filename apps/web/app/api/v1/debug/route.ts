import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/server-auth';

const isDev = process.env.NODE_ENV === 'development';

export async function GET(request: Request) {
  // In production, require SUPER_ADMIN authentication
  if (!isDev) {
    const auth = await authenticateRequest(request);
    if (!auth.ok || auth.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      );
    }
  }

  const debug = {
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: isDev
        ? (process.env.DATABASE_URL ? `${process.env.DATABASE_URL.substring(0, 30)}...` : 'NOT SET')
        : (process.env.DATABASE_URL ? 'CONFIGURED' : 'NOT SET'),
      JWT_SECRET: process.env.JWT_SECRET ? 'CONFIGURED' : 'NOT SET',
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ? 'CONFIGURED' : 'NOT SET',
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ? 'CONFIGURED' : 'NOT SET',
      CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ? 'CONFIGURED' : 'NOT SET',
      CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ? 'CONFIGURED' : 'NOT SET',
    },
    database: {
      connected: false,
      error: null as string | null,
      tables: {} as Record<string, number>,
    },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    debug.database.connected = true;

    const [userCount, galleryCount, configCount] = await Promise.all([
      prisma.user.count(),
      prisma.galleryItem.count(),
      prisma.systemConfig.count(),
    ]);

    debug.database.tables = {
      users: userCount,
      galleryItems: galleryCount,
      systemConfig: configCount,
    };
  } catch (error) {
    debug.database.connected = false;
    debug.database.error = isDev
      ? (error instanceof Error ? error.message : 'Unknown error')
      : 'Connection failed';
  }

  return NextResponse.json(debug, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
