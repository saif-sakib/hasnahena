import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const auth = requireAuth(req);

    // Only admins can view audit logs
    if (auth.role !== 'ADMIN' && auth.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const entityType = searchParams.get('entityType');
    const action = searchParams.get('action');
    const userId = searchParams.get('userId');

    const skip = (page - 1) * limit;

    const where = {
      ...(entityType && { entityType }),
      ...(action && { action }),
      ...(userId && { userId }),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Get user names for display
    const userIds = [...new Set(logs.map(log => log.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nameEn: true, nameBn: true, role: true },
    });

    const userMap = new Map(users.map(u => [u.id, u]));

    const formattedLogs = logs.map(log => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      user: userMap.get(log.userId) || { id: log.userId, nameEn: 'Unknown', nameBn: null, role: null },
      oldValue: log.oldValue,
      newValue: log.newValue,
      userIp: log.userIp,
      createdAt: log.createdAt.toISOString(),
    }));

    return NextResponse.json({
      ok: true,
      data: formattedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[AuditLogs GET] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.toLowerCase().includes('authorization')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}
