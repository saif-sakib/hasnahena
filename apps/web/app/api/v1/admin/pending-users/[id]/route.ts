import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { UserStatus } from '@prisma/client';

// POST - Approve or reject a user registration
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authUser = requireAuth(req);

    // Check if user is admin
    if (authUser.role !== 'ADMIN' && authUser.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized - Admin access required' } },
        { status: 403 }
      );
    }

    const userId = params.id;
    const body = await req.json();
    const { action, reason } = body as { action: 'approve' | 'reject'; reason?: string };

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { success: false, error: { message: 'Invalid action. Must be "approve" or "reject"' } },
        { status: 400 }
      );
    }

    // Get the user to approve/reject
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, nameEn: true, phone: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'User not found' } },
        { status: 404 }
      );
    }

    if (user.status !== 'PENDING') {
      return NextResponse.json(
        { success: false, error: { message: `User is already ${user.status.toLowerCase()}` } },
        { status: 400 }
      );
    }

    // Update user status
    const newStatus = action === 'approve' ? UserStatus.ACTIVE : UserStatus.INACTIVE;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: newStatus,
        approvedAt: action === 'approve' ? new Date() : null,
        approvedBy: action === 'approve' ? authUser.id : null,
      },
      select: {
        id: true,
        memberId: true,
        nameEn: true,
        phone: true,
        status: true,
      },
    });

    // Create notification for the user about the decision
    const notificationType = action === 'approve' ? 'ACCOUNT_ACTIVATED' : 'SYSTEM_ALERT';
    const notificationTitle = action === 'approve'
      ? 'Account Approved!'
      : 'Registration Rejected';
    const notificationMessage = action === 'approve'
      ? 'Your account has been approved. You can now login and start using Hasnahena.'
      : `Your registration has been rejected. ${reason ? `Reason: ${reason}` : 'Please contact support for more information.'}`;

    await prisma.notification.create({
      data: {
        type: notificationType,
        title: notificationTitle,
        message: notificationMessage,
        targetUserId: userId,
        data: {
          action,
          reason: reason || null,
          approvedBy: authUser.id,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        user: updatedUser,
        action,
        message: action === 'approve'
          ? 'User approved successfully'
          : 'User registration rejected',
      },
    });
  } catch (error) {
    console.error('Approve/Reject user error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process request';
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
