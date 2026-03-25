import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const debug = {
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL ? `${process.env.DATABASE_URL.substring(0, 30)}...` : 'NOT SET',
      JWT_SECRET: process.env.JWT_SECRET ? 'SET (hidden)' : 'NOT SET',
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'NOT SET (will use localhost:8080)',
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || 'NOT SET',
      CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ? 'SET (hidden)' : 'NOT SET',
      CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ? 'SET (hidden)' : 'NOT SET',
    },
    database: {
      connected: false,
      error: null as string | null,
      tables: {} as Record<string, number>,
    },
  };

  // Test database connection
  try {
    // Simple connection test
    await prisma.$queryRaw`SELECT 1`;
    debug.database.connected = true;

    // Count records in key tables
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
    debug.database.error = error instanceof Error ? error.message : 'Unknown database error';
  }

  return NextResponse.json(debug, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
