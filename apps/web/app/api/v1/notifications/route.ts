import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

// GET - Fetch notifications for the current user
export async function GET(req: NextRequest) {
  try {
    const authUser = requireAuth(req);

    // Fetch user to get their role
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { id: true, role: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'User not found' } },
        { status: 404 }
      );
    }

    // Fetch notifications for this user (by role or by specific user ID)
    const notifications = await prisma.notification.findMany({
      where: {
        OR: [
          { targetRole: user.role },
          { targetUserId: user.id },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to last 50 notifications
    });

    // Transform to match expected format
    const transformed = notifications.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      title: n.title,
      time: n.createdAt.toISOString(),
      read: n.isRead,
      data: n.data,
    }));

    return NextResponse.json({
      success: true,
      data: transformed,
    });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch notifications';
    if (message.includes('Authorization') || message.includes('token')) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { success: false, error: { message } },
      { status: 500 }
    );
  }
}

// PATCH - Mark notification(s) as read
export async function PATCH(req: NextRequest) {
  try {
    const authUser = requireAuth(req);

    const body = await req.json();
    const { notificationId, markAll } = body;

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { id: true, role: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'User not found' } },
        { status: 404 }
      );
    }

    if (markAll) {
      // Mark all notifications as read
      await prisma.notification.updateMany({
        where: {
          OR: [
            { targetRole: user.role },
            { targetUserId: user.id },
          ],
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });
    } else if (notificationId) {
      // Mark specific notification as read
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });
    }

    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    console.error('Mark notification read error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update notification';
    if (message.includes('Authorization') || message.includes('token')) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { success: false, error: { message } },
      { status: 500 }
    );
  }
}
