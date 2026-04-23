#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, UserRole } from '@prisma/client';

function normalizeEnvValue(raw) {
  if (!raw) {
    return raw;
  }

  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  const inlineCommentIndex = raw.indexOf(' #');
  if (inlineCommentIndex >= 0) {
    return raw.slice(0, inlineCommentIndex).trim();
  }

  return raw;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;

    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, eqIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }

    const rawValue = withoutExport.slice(eqIndex + 1).trim();
    process.env[key] = normalizeEnvValue(rawValue);
  }
}

function loadDatabaseEnv() {
  if (process.env.DATABASE_URL) {
    return;
  }

  const cwd = process.cwd();
  const envPaths = [
    path.join(cwd, '.env'),
    path.join(cwd, '.env.local'),
    path.join(cwd, '..', '..', '.env'),
    path.join(cwd, '..', '..', '.env.local'),
  ];

  for (const filePath of envPaths) {
    loadEnvFile(filePath);
    if (process.env.DATABASE_URL) {
      return;
    }
  }
}

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
      await tx.account.deleteMany({});
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
            not: admin.id,
          },
        },
      });
    });

    const after = await getCounts(prisma);

    console.log('Database cleanup completed.');
    console.log(`Kept admin user: ${admin.email || admin.id} (${admin.role})`);
    console.log('Preserved tables: system_config, gallery_items');
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
