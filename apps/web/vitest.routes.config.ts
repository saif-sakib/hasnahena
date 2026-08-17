import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// TEST-03/TEST-16. A second vitest project, separate from vitest.config.ts on
// purpose: that one is the fast suite that must never need a database, and this
// one drives the App Router handlers against a real one.
//
// Merging them would make `pnpm test:unit` require Postgres, which is exactly
// the cost that stops a suite from being run on every save.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/routes/**/*.test.ts'],
    // Route handlers share one Prisma client and one database. Running files in
    // parallel would have them seeding and reading the same rows.
    fileParallelism: false,
    // These call a real database and, for the proxy routes, a real socket.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    passWithNoTests: false,
  },
});
