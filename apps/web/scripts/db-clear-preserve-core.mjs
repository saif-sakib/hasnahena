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
const DONATION_ACCOUNT_NUMBER = 'HN-ACC-DONATION';
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
          // Detach direct FK to addresses before removing address rows.
          presentAddressId: null,
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
        where: { accountNumber: { not: DONATION_ACCOUNT_NUMBER } },
      });
      await tx.account.updateMany({
        where: { accountNumber: DONATION_ACCOUNT_NUMBER },
        data: { savingsBalance: BigInt(0), loanBalance: BigInt(0) },
      });
      await tx.document.deleteMany({});
      await tx.nominee.deleteMany({});
      await tx.address.deleteMany({});
      await tx.auditLog.deleteMany({});
      await tx.passwordResetToken.deleteMany({});
      await tx.tokenBlacklist.deleteMany({});
      await tx.rateLimit.deleteMany({});
      await tx.branch.deleteMany({});

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
    console.log('Preserved tables: system_config, gallery_items');
    console.log(`Preserved account: ${DONATION_ACCOUNT_NUMBER} (reset to 0)`);
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
