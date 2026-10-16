import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * The database URL. TEST_DATABASE_URL wins outside production because Next's
 * @next/env re-applies apps/web/.env over an inherited DATABASE_URL — which
 * once put the web app on the developer's own database during a test-stack run.
 * Never honoured in production.
 */
function datasourceUrl(): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  return process.env.TEST_DATABASE_URL?.trim() || undefined;
}

const url = datasourceUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
    ...(url ? { datasources: { db: { url } } } : {}),
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
