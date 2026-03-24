import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  try {
    const configs = await prisma.systemConfig.findMany();
    // Transform into a simple key-value object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configMap = configs.reduce((acc: any, config) => {
      acc[config.key] = config.value;
      return acc;
    }, {});

    return NextResponse.json(configMap);
  } catch (error) {
    console.error('Failed to fetch system config:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const authUser = requireAuth(request);
    if (authUser.role !== UserRole.ADMIN && authUser.role !== UserRole.SUPER_ADMIN) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    
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

    revalidatePath('/');
    revalidatePath('/[locale]');
    revalidatePath('/[locale]/gallery');
    revalidatePath('/[locale]/dashboard/admin/settings');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update system config:', error);
    const message = error instanceof Error ? error.message : 'Failed to update settings';
    if (message.toLowerCase().includes('authorization') || message.toLowerCase().includes('token')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
