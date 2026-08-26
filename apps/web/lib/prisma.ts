import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Which database this process talks to — and why that is not simply
 * `DATABASE_URL`.
 *
 * `scripts/test-stack.sh --serve` starts `next dev` with `DATABASE_URL` set to
 * the throwaway Postgres on port 55433, and **Next overrides it from
 * `apps/web/.env` before any of our code runs**. `@next/env` re-applies the
 * `.env` files over `process.env` on load, so an inherited value loses to a
 * checked-out file. The process environment was right; what the app read was
 * not.
 *
 * The effect was quiet and bad. The Go API was on the test database and the web
 * app was on the developer's **Neon dev** database, in the same browser run:
 * every assertion about a public page was made against whatever that database
 * happened to contain, and `e2e/public-content.spec.ts` — which PUTs settings
 * through a Next route — was **writing to it**. CI never showed it, because CI
 * has no `.env` (it is gitignored), which is exactly what makes it the kind of
 * trap that survives: a green local run that means less than it looks like.
 *
 * `TEST_DATABASE_URL` wins because no `.env` in this repo defines it, so there
 * is nothing for `@next/env` to override it with. It is the same variable the
 * route harness already keys on, so the browser suite and the route suite are
 * now provably on one database instead of two.
 *
 * Never in production. `next build` and `next start` set `NODE_ENV=production`,
 * and nothing outside a test rig sets this variable — but a stray value in a
 * host's environment must not be able to repoint a live deployment, so the gate
 * is explicit rather than implied.
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
