export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authErrorStatus } from '@/lib/auth';
import { requireActiveAuth } from '@/lib/auth-revocation';

export async function GET(req: Request) {
  try {
    const auth = await requireActiveAuth(req);

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
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          oldValue: true,
          newValue: true,
          userIp: true,
          createdAt: true,
          userId: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Get user names for display
    const userIds = [...new Set(logs.map(log => log.userId).filter((id): id is string => id !== null))];
    const users = userIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nameEn: true, nameBn: true, role: true },
    }) : [];

    const userMap = new Map(users.map(u => [u.id, u]));

    const formattedLogs = logs.map(log => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      user: log.userId ? userMap.get(log.userId) || { id: log.userId, nameEn: 'Unknown', nameBn: null, role: null } : null,
      oldValue: log.oldValue,
      newValue: log.newValue,
      userIp: log.userIp,
      createdAt: log.createdAt.toISOString(),
      actorName: log.userId ? (userMap.get(log.userId)?.nameBn || userMap.get(log.userId)?.nameEn || log.userId) : 'System',
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
    const authStatus = authErrorStatus(error);
    if (authStatus) {
      return NextResponse.json(
        { ok: false, error: authStatus === 401 ? 'Unauthorized' : 'Server error' },
        { status: authStatus },
      );
    }
    return NextResponse.json({ ok: false, error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}
