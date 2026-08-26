import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The browser suite and the API must be on the **same** database.
 *
 * They were not, and the way they came apart is worth keeping.
 * `scripts/test-stack.sh --serve` starts the Go API and `next dev` with
 * `DATABASE_URL` pointing at the throwaway Postgres on 55433. The API obeyed.
 * Next did not: `@next/env` re-applies `apps/web/.env` over `process.env` when
 * it loads, so the inherited value lost to a file on disk, and the web half of
 * every browser run read the developer's **Neon dev** database — including
 * `e2e/public-content.spec.ts`, which PUTs settings through a Next route and was
 * therefore *writing* to it.
 *
 * Nothing could see it. `/proc/<pid>/environ` showed the right URL; the pages
 * rendered; the specs passed. It was found by noticing that a home page served
 * by the test stack showed ten members and four gallery photographs from a
 * database that had one member and none. And CI is immune, because CI has no
 * `.env` — which is exactly what lets a trap like this live for months in the
 * only place it matters, a developer's machine, while every shared signal stays
 * green.
 *
 * The fix is to hand the value over a name no `.env` in this repo defines, so
 * there is nothing for `@next/env` to override it with. Both halves of that are
 * checked here, because either one alone is silently useless.
 */

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..', '..', '..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');

describe('the test stack and the web app agree on which database is under test', () => {
  it('the stack hands the web server TEST_DATABASE_URL, not only DATABASE_URL', () => {
    const script = read('scripts/test-stack.sh');
    const serve = script.slice(script.indexOf('starting Next on'));
    const invocation = serve.slice(0, serve.indexOf('web.pid') + 'web.pid'.length);

    expect(
      invocation,
      'test-stack.sh starts `next dev` without TEST_DATABASE_URL. DATABASE_URL ' +
        'alone is not enough: Next overwrites it from apps/web/.env, so the web ' +
        "app runs against the developer's own database while the Go API runs " +
        'against the test one, and the browser suite proves nothing about either.',
    ).toContain('TEST_DATABASE_URL=');
  });

  it('the Prisma client prefers TEST_DATABASE_URL outside production', () => {
    const source = read('apps/web/lib/prisma.ts');

    expect(
      source,
      'lib/prisma.ts no longer reads TEST_DATABASE_URL, so passing it in the ' +
        'test stack does nothing at all',
    ).toContain('TEST_DATABASE_URL');

    expect(
      source,
      'lib/prisma.ts hands the url to PrismaClient. Reading the variable and ' +
        'not using it is the shape this test exists to refuse.',
    ).toMatch(/datasources:\s*\{\s*db:\s*\{\s*url/);
  });

  it('and never in production, whatever the host environment holds', () => {
    // A stray TEST_DATABASE_URL in Render's or Vercel's environment must not be
    // able to repoint a live deployment at somebody's scratch database. The gate
    // is explicit rather than implied by "nothing sets it in production".
    const source = read('apps/web/lib/prisma.ts');

    expect(source).toMatch(/NODE_ENV\s*===\s*'production'\)\s*return undefined/);
  });
});
