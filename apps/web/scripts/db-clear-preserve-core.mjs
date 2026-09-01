#!/usr/bin/env node

import { PrismaClient, UserRole } from '@prisma/client';
import { loadDatabaseEnv } from './lib/env.mjs';

async function getCounts(prisma) {
  const [
    users,
    addresses,
    nominees,
    documents,
    accounts,
    transactions,
    loans,
    branches,
    systemConfig,
    galleryItems,
    auditLogs,
    supportThreads,
    supportMessages,
    notifications,
    passwordResetTokens,
    tokenBlacklist,
    rateLimits,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.address.count(),
    prisma.nominee.count(),
    prisma.document.count(),
    prisma.account.count(),
    prisma.transaction.count(),
    prisma.loan.count(),
    prisma.branch.count(),
    prisma.systemConfig.count(),
    prisma.galleryItem.count(),
    prisma.auditLog.count(),
    prisma.supportThread.count(),
    prisma.supportMessage.count(),
    prisma.notification.count(),
    prisma.passwordResetToken.count(),
    prisma.tokenBlacklist.count(),
    prisma.rateLimit.count(),
  ]);

  return {
    users,
    addresses,
    nominees,
    documents,
    accounts,
    transactions,
    loans,
    branches,
    systemConfig,
    galleryItems,
    auditLogs,
    supportThreads,
    supportMessages,
    notifications,
    passwordResetTokens,
    tokenBlacklist,
    rateLimits,
  };
}

async function resolveAdmin(prisma) {
  const preferredAdminEmail = (process.env.KEEP_ADMIN_EMAIL || 'admin@hasnahena.local').trim();

  const preferred = await prisma.user.findFirst({
    where: {
      email: preferredAdminEmail,
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  if (preferred) {
    return preferred;
  }

  return prisma.user.findFirst({
    where: {
      role: {
        in: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });
}

// Kept in step with scripts/seed.mjs, which creates them.
// Identified by its owner — there is no account number any more (ADR-023).
const DONATION_OWNER_ID = 'system_donation_fund';

async function main() {
  loadDatabaseEnv();

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Set it in the shell or in .env/.env.local.');
  }

  const prisma = new PrismaClient();

  try {
    const admin = await resolveAdmin(prisma);
    if (!admin) {
      throw new Error(
        'No admin user found. Expected admin@hasnahena.local or a user with ADMIN/SUPER_ADMIN role.',
      );
    }

    const before = await getCounts(prisma);

    await prisma.$transaction(async (tx) => {
      // DATA-08: audit_logs carries a trigger that rejects UPDATE always and
      // DELETE unless a transaction opts in. This script is the one legitimate
      // caller — it resets a test environment. SET LOCAL scopes the permission
      // to this transaction and this connection, so it cannot leak to the
      // application's own queries running on a neighbouring pooled connection.
      await tx.$executeRawUnsafe("SET LOCAL hasnahena.allow_audit_purge = 'on'");

      await tx.user.update({
        where: { id: admin.id },
        data: {
          // Nothing to detach for the addresses: both are rows of one table
          // keyed on the person and the kind (ADR-044), so deleting them below
          // covers both. `approvedBy` is still a self-reference on `users` and
          // still has to be cleared first.
          approvedBy: null,
        },
      });

      await tx.supportMessage.deleteMany({});
      await tx.supportThread.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.transaction.deleteMany({});
      await tx.loan.deleteMany({});
      // The donation pool account survives, at a zero balance. It is
      // infrastructure rather than data: RecordDonation locks this exact row,
      // so a cleared environment without it cannot record a donation at all,
      // and the failure is an opaque 500 rather than anything that points at
      // the missing row. `pnpm db:seed` recreates it, but this script is meant
      // to leave a *working* environment behind, not one that needs a second
      // command to be usable.
      await tx.account.deleteMany({
        where: { userId: { not: DONATION_OWNER_ID } },
      });
      await tx.account.updateMany({
        where: { userId: DONATION_OWNER_ID },
        data: { savingsBalance: BigInt(0), loanBalance: BigInt(0) },
      });
      await tx.document.deleteMany({});
      await tx.nominee.deleteMany({});
      await tx.address.deleteMany({});
      await tx.auditLog.deleteMany({});
      await tx.passwordResetToken.deleteMany({});
      await tx.tokenBlacklist.deleteMany({});
      await tx.rateLimit.deleteMany({});
      // NOT branches. An office is configuration, not test data: Vekutia is the
      // base branch and every worker assigned to it names it. Deleting it meant
      // re-creating it by hand after every clear, which is the kind of step that
      // gets skipped once and then debugged for an hour. The workers that
      // pointed at it are gone, which is simply a branch with no staff.

      await tx.user.deleteMany({
        where: {
          id: {
            notIn: [admin.id, DONATION_OWNER_ID],
          },
        },
      });
    });

    const after = await getCounts(prisma);

    console.log('Database cleanup completed.');
    console.log(`Kept admin user: ${admin.email || admin.id} (${admin.role})`);
    console.log('Preserved tables: system_config, gallery_items, branches');
    console.log(`Preserved the donation pool account owned by ${DONATION_OWNER_ID} (reset to 0)`);
    console.log('Counts (before -> after):');

    for (const key of Object.keys(after)) {
      console.log(`  ${key}: ${before[key]} -> ${after[key]}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Cleanup failed:', error.message);
  process.exit(1);
});
